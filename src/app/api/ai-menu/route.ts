import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const categories = ["Weekend breakfast","Sunday supper","Weeknight 1","Weeknight 2","Weeknight 3"];
const recipeSchema = {
  type:"object", additionalProperties:false, required:["recipes"], properties:{
    recipes:{type:"array",items:{type:"object",additionalProperties:false,
      required:["name","category","description","time","servings","ingredients","steps"],
      properties:{
        name:{type:"string"},category:{type:"string",enum:categories},
        description:{type:"string"}, time:{type:"integer"}, servings:{type:"integer"},
        ingredients:{type:"array",items:{type:"object",additionalProperties:false,
          required:["name","amount","pantry"],properties:{
            name:{type:"string"},amount:{type:"string"},pantry:{type:"boolean"}
          }}},
        steps:{type:"array",items:{type:"string"}}
      }}}
  }
};
type GeneratedRecipe={
 name:string;category:string;description:string;time:number;servings:number;
 ingredients:{name:string;amount:string;pantry:boolean}[];steps:string[]
};
function validRecipe(x:unknown):x is GeneratedRecipe{
  if(!x || typeof x!=="object") return false;
  const r=x as GeneratedRecipe;
  return typeof r.name==="string" && r.name.length>3 && r.name.length<120 &&
    typeof r.description==="string" && r.description.length<300 &&
    typeof r.time==="number" && r.time>0 && r.time<=240 &&
    typeof r.servings==="number" && r.servings>=4 && r.servings<=12 &&
    Array.isArray(r.ingredients) && r.ingredients.length>=3 && r.ingredients.length<=25 &&
    r.ingredients.every(i=>typeof i.name==="string"&&i.name.length>0&&i.name.length<100 &&
      typeof i.amount==="string"&&i.amount.length>0&&i.amount.length<100) &&
    Array.isArray(r.steps) && r.steps.length>=2 && r.steps.length<=15 &&
    r.steps.every(s=>typeof s==="string" && s.length>5 && s.length<500);
}
export async function POST(req:NextRequest) {
  const responseHeaders={"Cache-Control":"no-store"};
  const reply=(message:string,status:number)=>NextResponse.json({message},{status,headers:responseHeaders});
  const provider = process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENAI_API_KEY ? "openai" : null;
  if(!provider) return reply("AI generation is not connected yet. Add a Gemini API key (free-tier eligible) or OpenAI API key in Vercel.",503);
  const sbUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!sbUrl||!sbKey) return reply("Cloud configuration is unavailable.",503);
  const bearer=req.headers.get("authorization")??"";
  if(!bearer.startsWith("Bearer ") || bearer.length>5000) return reply("Sign in first.",401);
  const raw=await req.text();
  if(raw.length>4000) return reply("Request is too large.",413);
  let input:{
    householdId?:string;preferences?:{maxWeeknightMinutes?:number;avoid?:string;notes?:string};
    history?:{names?:string[]}[];current?:string[];
  };
  try{input=JSON.parse(raw)}catch{return reply("Invalid request.",400)}
  if(!input.householdId || !/^[a-f0-9-]{36}$/i.test(input.householdId)) return reply("Missing family workspace.",400);
  const jwt=bearer.slice(7);
  const db=createClient(sbUrl,sbKey,{global:{headers:{Authorization:"Bearer "+jwt}},
    auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await db.auth.getUser(jwt);
  if(authError || !identity.user) return reply("Your sign-in has expired.",401);
  const {data:member,error:memberError}=await db.from("family_members")
    .select("household_id").eq("household_id",input.householdId)
    .eq("user_id",identity.user.id).maybeSingle();
  if(memberError||!member) return reply("You cannot generate menus for this family.",403);
  const preferences=input.preferences||{};
  const maxMinutes=Number(preferences.maxWeeknightMinutes);
  const weeknightMax=[25,30,40,45,60].includes(maxMinutes)?maxMinutes:40;
  const avoid=typeof preferences.avoid==="string"?preferences.avoid.slice(0,250):"";
  const notes=typeof preferences.notes==="string"?preferences.notes.slice(0,500):"";
  const history=Array.isArray(input.history)?input.history.slice(-4).flatMap(h=>
    Array.isArray(h.names)?h.names.filter(n=>typeof n==="string").slice(0,5):[]):[];
  const current=Array.isArray(input.current)?input.current.filter(x=>typeof x==="string").slice(0,5):[];
  const {error:quotaError}=await db.rpc("reserve_family_ai_generation",{p_household:input.householdId});
  if(quotaError) return reply(quotaError.message.includes("DAILY_AI_LIMIT")?
    "You've reached today's three AI menu generations. Use curated recommendations or try again tomorrow.":
    "Unable to reserve an AI generation.",quotaError.message.includes("DAILY_AI_LIMIT")?429:403);

  const instructions=`You create practical, coherent, original family meal recipes, never claim external testing or verified nutrition.
Output precisely five COMPLETE recipes ordered as categories: ${categories.join(", ")}.
Two adults and three children with adventurous palates. Breakfast for 5, Sunday supper for 5-6, weeknight dinners for 5.
Provide measured quantities, safe temperatures for poultry and other safety-critical ingredients, clear complete instructions, realistic time estimates.
Keep weeknight meals <= ${weeknightMax} minutes.
Avoid these ingredients without exception: ${avoid || "none specified"}.
Family notes: ${notes || "varied proteins and vegetables; appealing but not bland"}.
Avoid repeating these recently served meals: ${history.join("; ") || "none"}.
Prefer different ideas from the currently proposed menu: ${current.join("; ") || "none"}.
If dietary constraints conflict with creative variety, prioritize safety and constraints.
No raw flour/egg preparation instructions without appropriate cooking. No allergens from the avoid list.`;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),45000);
  try{
    // Prefer Google's free-tier eligible Gemini key; OpenAI remains a low-cost fallback.
    let output: string | undefined;
    if(provider==="gemini") {
      const model=process.env.GEMINI_MEAL_MODEL || "gemini-2.5-flash-lite";
      const result=await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
        method:"POST",signal:controller.signal,
        headers:{"x-goog-api-key":process.env.GEMINI_API_KEY!,"Content-Type":"application/json"},
        body:JSON.stringify({
          systemInstruction:{parts:[{text:instructions}]},
          contents:[{role:"user",parts:[{text:"Generate exactly five fully specified recipes for this family."}]}],
          generationConfig:{
            responseMimeType:"application/json",
            responseJsonSchema:recipeSchema,
            maxOutputTokens:6000,
            temperature:0.8
          }
        })
      });
      if(!result.ok) {
        if(result.status===429) return reply("The free AI tier is rate-limited. Try again later; no menu was changed.",429);
        return reply("Gemini generation is unavailable for this key or model. Check model access and quotas in Google AI Studio.",502);
      }
      const value=await result.json() as {candidates?:{content?:{parts?:{text?:string}[]}}[]};
      output=value.candidates?.[0]?.content?.parts?.map(p=>p.text??"").join("");
    } else {
      const result=await fetch("https://api.openai.com/v1/responses",{
        method:"POST",signal:controller.signal,
        headers:{"Authorization":"Bearer "+process.env.OPENAI_API_KEY!,"Content-Type":"application/json"},
        body:JSON.stringify({
          model:process.env.OPENAI_MEAL_MODEL||"gpt-5-nano",
          store:false, max_output_tokens:6000,
          input:[{role:"system",content:instructions},{role:"user",content:"Generate the five recipes now."}],
          text:{format:{type:"json_schema",name:"family_week_menu",strict:true,schema:recipeSchema}}
        })
      });
      if(!result.ok) return reply("The OpenAI API is unavailable. Check API billing and model access.",502);
      const value=await result.json() as {output?:{content?:{type?:string;text?:string}[]}[]};
      output=value.output?.flatMap(o=>o.content??[]).find(c=>c.type==="output_text")?.text;
    }
    if(!output) return reply("The AI service did not return usable recipes.",502);
    let parsed:unknown;
    try{parsed=JSON.parse(output)}catch{return reply("The AI response was incomplete.",502)}
    const items=(parsed as {recipes?:unknown[]}).recipes;
    if(!Array.isArray(items)||items.length!==5||!items.every(validRecipe)||
      items.some((r,i)=>(r as GeneratedRecipe).category!==categories[i]||
        (i>=2 && (r as GeneratedRecipe).time>weeknightMax))) {
      return reply("Generated recipes did not pass validation. Please try again.",502);
    }
    if(avoid) {
      const exclusions=avoid.toLowerCase().split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
      if(items.some(r=>exclusions.some(word=> {
        const meal=r as GeneratedRecipe;
        return (meal.name+" "+meal.ingredients.map(i=>i.name).join(" ")).toLowerCase().includes(word);
      }))) return reply("Generated recipes did not meet the ingredient exclusions.",502);
    }
    return NextResponse.json({recipes:items},{headers:responseHeaders});
  }catch{
    return reply("The AI recipe service timed out. Your existing menu was not changed.",504);
  }finally{clearTimeout(timeout)}
}
