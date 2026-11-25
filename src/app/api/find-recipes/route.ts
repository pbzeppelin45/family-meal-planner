import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const runtime="nodejs";

type SearchSource={title:string;url:string};
const slots=[
  {label:"Weekend breakfast",terms:"creative breakfast brunch"},
  {label:"Sunday supper",terms:"slow cooked Sunday family dinner"},
  {label:"Weeknight 1",terms:"quick chicken vegetable dinner"},
  {label:"Weeknight 2",terms:"quick fish or shrimp dinner"},
  {label:"Weeknight 3",terms:"quick vegetarian or pork dinner"}
];
function safeUrl(value:unknown):string|null {
  if(typeof value!=="string" || value.length>1800)return null;
  try {
    const u=new URL(value);
    if(u.protocol!=="https:" || !u.hostname || u.username || u.password)return null;
    return u.toString();
  }catch{return null;}
}
function searchQueries(maxMinutes:number,avoid:string,notes:string,recent:string[]){
  const excluded=avoid.split(/[,;\n]/).map(x=>x.trim().replace(/[^a-z\d -]/gi,"")).filter(Boolean).slice(0,8);
  const excludedTerms=excluded.map(x=>"-"+x.replace(/\s+/g,"-")).join(" ");
  const brief=notes.replace(/[^a-z\d\s,.:-]/gi," ").slice(0,120);
  const history=recent.slice(-3).map(x=>x.slice(0,40));
  return slots.map((slot,i)=>({
    label:slot.label,
    query:[slot.terms,"recipe","serves 5",i>=2?`${maxMinutes} minutes or less`:"",
      brief,excludedTerms,history.length?"fresh ideas":""].filter(Boolean).join(" ").slice(0,300)
  }));
}
function searchHandoff(queries:{label:string;query:string}[]){
  return {
    sourceType:"Search links (not verified recipe results)",
    summary:"Live search is not connected. These links open targeted Google searches for each meal slot. They are search queries, not independently verified recipes. Review the publisher's recipe before adding it to the menu.",
    sources:queries.map(x=>({
      title:x.label+" — search published recipes",
      url:"https://www.google.com/search?q="+encodeURIComponent(x.query)
    }))
  };
}
export async function POST(req:NextRequest){
  const reply=(message:string,status:number)=>NextResponse.json({message},{status,headers:{"Cache-Control":"no-store"}});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!anon)return reply("Cloud configuration is unavailable.",503);
  const bearer=req.headers.get("authorization")??"";
  if(!bearer.startsWith("Bearer ")||bearer.length>5000)return reply("Sign in to search published recipes.",401);
  const raw=await req.text();
  if(raw.length>4000)return reply("Search request is too large.",413);
  let input:{
    householdId?:string;
    preferences?:{maxWeeknightMinutes?:number;avoid?:string;notes?:string};
    history?:{names?:string[]}[];
    current?:string[];
  };
  try{input=JSON.parse(raw)}catch{return reply("Invalid request.",400)}
  if(!input.householdId||!/^[a-f0-9-]{36}$/i.test(input.householdId))return reply("Missing family workspace.",400);
  const jwt=bearer.slice(7);
  const db=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+jwt}},
    auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await db.auth.getUser(jwt);
  if(authError||!identity.user)return reply("Your sign-in has expired.",401);
  const {data:member,error:memberError}=await db.from("family_members").select("household_id")
    .eq("household_id",input.householdId).eq("user_id",identity.user.id).maybeSingle();
  if(memberError||!member)return reply("Not authorized for this family.",403);
  const pref=input.preferences??{};
  const limit=Number(pref.maxWeeknightMinutes);
  const maxMinutes=[25,30,40,45,60].includes(limit)?limit:40;
  const avoid=typeof pref.avoid==="string"?pref.avoid.slice(0,250):"";
  const notes=typeof pref.notes==="string"?pref.notes.slice(0,250):"";
  const recent=Array.isArray(input.history)?input.history.slice(-3).flatMap(h=>
    Array.isArray(h.names)?h.names.filter(x=>typeof x==="string").slice(0,5):[]):[];
  const queries=searchQueries(maxMinutes,avoid,notes,recent);
  const handoff=searchHandoff(queries);
  // Google Search grounding is not available on Gemini 3 free API projects.
  // Without a dedicated search key, supply useful explicit search links; do not
  // claim that any publisher result was checked or consume any AI-generation quota.
  if(!process.env.TAVILY_API_KEY)
    return NextResponse.json(handoff,{headers:{"Cache-Control":"no-store"}});
  // Search quota is separate from original AI generation quota.
  const {error:quotaError}=await db.rpc("reserve_family_recipe_search",{p_household:input.householdId});
  if(quotaError)return reply(quotaError.message.includes("DAILY_SEARCH_LIMIT")
    ?"Today's six published-recipe searches have been used. Try again tomorrow. Original-recipe generation remains available."
    :"Unable to reserve published-recipe search.",quotaError.message.includes("DAILY_SEARCH_LIMIT")?429:403);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),35000);
  try {
    const results=await Promise.all(queries.map(async ({label,query})=>{
      const res=await fetch("https://api.tavily.com/search",{
        method:"POST",signal:controller.signal,
        headers:{"Authorization":"Bearer "+process.env.TAVILY_API_KEY!,
          "Content-Type":"application/json"},
        body:JSON.stringify({query,search_depth:"basic",max_results:4,
          include_answer:false,include_raw_content:false,include_images:false,topic:"general"})
      });
      if(!res.ok) {
        console.error("Recipe search provider error",{status:res.status,label});
        return {label,results:[] as {title:string;url:string;content:string}[]};
      }
      const parsed=await res.json() as {results?:{title?:string;url?:string;content?:string}[]};
      return {label,results:(parsed.results??[]).flatMap(r=>{
        const u=safeUrl(r.url);
        if(!u)return [];
        return [{title:(r.title??new URL(u).hostname).slice(0,160),url:u,
          content:(r.content??"").slice(0,180)}];
      })};
    }));
    const sources:SearchSource[]=[];
    const lines:string[]=[];
    const seen=new Set<string>();
    for(const group of results){
      const first=group.results.find(r=>!seen.has(r.url));
      if(first)lines.push(group.label+": "+first.title+" (see linked publisher page; time and ingredient exclusions not yet verified)");
      else lines.push(group.label+": no independent recipe result returned; use the search link below.");
      for(const result of group.results){
        if(seen.has(result.url))continue;
        seen.add(result.url);
        sources.push({title:group.label+" — "+result.title,url:result.url});
      }
    }
    if(!sources.length)return NextResponse.json(handoff,{headers:{"Cache-Control":"no-store"}});
    return NextResponse.json({
      sourceType:"Tavily web search — publisher links",
      summary:lines.join("\n"),
      sources:sources.slice(0,20)
    },{headers:{"Cache-Control":"no-store"}});
  }catch{
    console.error("Recipe search provider failed or timed out");
    return NextResponse.json(handoff,{headers:{"Cache-Control":"no-store"}});
  }finally{clearTimeout(timer);}
}
