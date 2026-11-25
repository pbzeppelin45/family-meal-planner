import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
type SearchSource={title:string;url:string};
function safeUrl(value:unknown):string|null {
  if(typeof value!=="string" || value.length>2000) return null;
  try{
    const url=new URL(value);
    if(url.protocol!=="https:" || !url.hostname || url.username || url.password) return null;
    return url.toString();
  }catch{return null;}
}
export async function POST(req:NextRequest) {
  const reply=(message:string,status:number)=>NextResponse.json({message},{status,headers:{"Cache-Control":"no-store"}});
  const key=process.env.GEMINI_API_KEY;
  if(!key) return reply("Gemini search requires GEMINI_API_KEY in the Preview environment.",503);
  const sbUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!sbUrl || !sbKey) return reply("Cloud configuration is unavailable.",503);
  const bearer=req.headers.get("authorization")??"";
  if(!bearer.startsWith("Bearer ") || bearer.length>5000) return reply("Sign in to search recipes.",401);
  const raw=await req.text();
  if(raw.length>4000) return reply("Search request is too large.",413);
  let input:{
    householdId?:string;
    preferences?:{maxWeeknightMinutes?:number;avoid?:string;notes?:string};
    history?:{names?:string[]}[];
    current?:string[];
  };
  try{input=JSON.parse(raw)}catch{return reply("Invalid request.",400)}
  if(!input.householdId || !/^[a-f0-9-]{36}$/i.test(input.householdId))
    return reply("Missing family workspace.",400);
  const jwt=bearer.slice(7);
  const db=createClient(sbUrl,sbKey,{global:{headers:{Authorization:"Bearer "+jwt}},
    auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await db.auth.getUser(jwt);
  if(authError || !identity.user) return reply("Your sign-in has expired.",401);
  const {data:member,error:memberError}=await db.from("family_members")
    .select("household_id").eq("household_id",input.householdId)
    .eq("user_id",identity.user.id).maybeSingle();
  if(memberError || !member) return reply("Not authorized for this household.",403);

  const preferences=input.preferences??{};
  const max=Number(preferences.maxWeeknightMinutes);
  const maxMinutes=[25,30,40,45,60].includes(max)?max:40;
  const avoid=typeof preferences.avoid==="string"?preferences.avoid.slice(0,250):"";
  const notes=typeof preferences.notes==="string"?preferences.notes.slice(0,500):"";
  const history=Array.isArray(input.history)?input.history.slice(-4).flatMap(h=>
    Array.isArray(h.names)?h.names.filter(x=>typeof x==="string").slice(0,5):[]):[];
  const current=Array.isArray(input.current)?input.current.filter(x=>typeof x==="string").slice(0,5):[];

  const {error:quotaError}=await db.rpc("reserve_family_ai_generation",{p_household:input.householdId});
  if(quotaError) return reply(quotaError.message.includes("DAILY_AI_LIMIT")
    ?"Today's three AI searches/generations have been used. Try again tomorrow."
    :"Unable to reserve a recipe search.",quotaError.message.includes("DAILY_AI_LIMIT")?429:403);

  const prompt=`Find real, publicly published recipes on the web, DO NOT invent, reconstruct or rewrite a recipe.
Use Google Search actively and cite actual recipe web pages, not generic category pages or search results.
Suggest options for exactly five meal slots:
1. Weekend breakfast for 5
2. Sunday supper for 5-6, comfortable longer cooking
3. Weeknight dinner for 5, approximately ${maxMinutes} minutes or less
4. Weeknight dinner for 5, approximately ${maxMinutes} minutes or less
5. Weeknight dinner for 5, approximately ${maxMinutes} minutes or less
Family: adventurous tastes, two adults and three children.
Ingredient exclusions: ${avoid || "none"}.
Additional preferences: ${notes || "varied proteins, vegetables, well-tested recipes"}.
Recently planned meals to avoid repeating: ${history.join("; ") || "none"}.
Current meals: ${current.join("; ") || "none"}.
Favor established cooking publications and clear recipe directions.
For each slot, write the publisher, recipe title and why it fits, with citation.
Only describe cooking time/servings if stated on the source; don't guess.
Don't claim that ingredients or timing are verified if they haven't been read.
If a slot lacks a trustworthy result, say so explicitly.
Keep the output readable with five numbered slot descriptions and no full recipe text.`;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const model=process.env.GEMINI_MEAL_MODEL||"gemini-3.5-flash-lite";
    const response=await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
        method:"POST",signal:controller.signal,
        headers:{"x-goog-api-key":key,"Content-Type":"application/json"},
        body:JSON.stringify({
          contents:[{role:"user",parts:[{text:prompt}]}],
          tools:[{googleSearch:{}}],
          generationConfig:{maxOutputTokens:3000,temperature:0.35}
        })
      }
    );
    if(!response.ok){
      let code="";
      try {
        const e=await response.json() as {error?:{status?:string}};
        code=e.error?.status??"";
      }catch{}
      console.error("Grounded recipe search failed",{httpStatus:response.status,providerStatus:code,model});
      if(response.status===429)return reply("Google Search grounding is rate-limited for this project.",429);
      if(response.status===400)return reply("The model rejected Google Search grounding. Try a supported model or check AI Studio model access.",502);
      if(response.status===401||response.status===403)return reply("Google Search grounding isn't authorized for this API key or project.",502);
      if(response.status===404)return reply("This Gemini model is unavailable for search grounding in the project.",502);
      return reply("Recipe search provider returned HTTP "+response.status+".",502);
    }
    const value=await response.json() as {
      candidates?:{
        content?:{parts?:{text?:string}[]};
        groundingMetadata?:{
          groundingChunks?:{web?:{uri?:string;title?:string}}[];
          webSearchQueries?:string[];
        }
      }[]
    };
    const candidate=value.candidates?.[0];
    const summary=candidate?.content?.parts?.map(p=>p.text??"").join("").trim().slice(0,10000)??"";
    // The model can suggest links in prose. Only link sources that Google's
    // grounding metadata actually returned, never model-written URLs.
    const unique=new Map<string,SearchSource>();
    for(const chunk of candidate?.groundingMetadata?.groundingChunks??[]){
      const url=safeUrl(chunk.web?.uri);
      if(!url)continue;
      if(!unique.has(url)) unique.set(url,{
        url,title:(chunk.web?.title??new URL(url).hostname).slice(0,180)
      });
    }
    const sources=[...unique.values()].slice(0,18);
    if(!summary || sources.length===0)
      return reply("Google did not return verifiable recipe sources. No links were fabricated. Try refining your preferences.",502);
    return NextResponse.json({summary,sources,sourceType:"Google Search grounding"},
      {headers:{"Cache-Control":"no-store"}});
  }catch{
    return reply("Recipe search timed out; your menu was not changed.",504);
  }finally{clearTimeout(timer)}
}
