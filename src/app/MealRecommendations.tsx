"use client";
import { useMemo, useState } from "react";
import { groups, type Recipe } from "../lib/recipes";
import {scaleRecipe} from "../lib/recipeScaling";

export type MenuPreferences = {
  maxWeeknightMinutes:number;
  avoid:string;
  notes:string;
};
export type MenuHistory = {at:string;names:string[]};
export type MenuOption = {recipe:Recipe;source:"saved"|"built-in"|"AI"|"published"};
type Mode="stored"|"search"|"AI";
type SlotResult={slot:number;recipe:unknown|null};
type Props={
  savedRecipes:Recipe[];
  current:Recipe[];
  included:boolean[];
  history:MenuHistory[];
  have:Record<string,boolean>;
  preferences:MenuPreferences;
  onPreferences:(next:MenuPreferences)=>void;
  onToggleIncluded:(slot:number)=>void;
  onApprove:(recipes:Recipe[],included:boolean[])=>void;
  getToken:()=>Promise<string|null>;
  householdId:string;
};
function validRecipe(v:unknown):v is Recipe{
  if(!v||typeof v!=="object")return false;
  const r=v as Recipe;
  return typeof r.name==="string"&&r.name.length>2&&r.name.length<=110 &&
    typeof r.description==="string"&&Number.isFinite(r.time)&&r.time>0&&r.time<360 &&
    Number.isFinite(r.servings)&&r.servings>0&&r.servings<=30 &&
    Array.isArray(r.ingredients)&&r.ingredients.length>=2&&r.ingredients.length<=35 &&
    r.ingredients.every(i=>typeof i.name==="string"&&typeof i.amount==="string") &&
    Array.isArray(r.steps)&&r.steps.length>=2&&r.steps.every(x=>typeof x==="string");
}
const norm=(s:string)=>s.trim().toLowerCase().replace(/[^a-z0-9]/g,"");
function recipeProtein(recipe:Recipe){
  const text=(recipe.name+" "+recipe.ingredients.map(x=>x.name).join(" ")).toLowerCase();
  if(/shrimp|salmon|fish|cod|tuna|prawn/.test(text))return "seafood";
  if(/chicken/.test(text))return "chicken";
  if(/turkey/.test(text))return "turkey";
  if(/pork|sausage|bacon/.test(text))return "pork";
  if(/beef|steak/.test(text))return "beef";
  return "vegetarian";
}
function storedCandidates(slot:number,saved:Recipe[],preferences:MenuPreferences){
  const curated=groups[slot];
  const relevant=saved.filter(r=>r.category===curated[0].category ||
    (slot>=2 && /^Weeknight/.test(r.category)));
  const restrictions=preferences.avoid.split(/[,;\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
  const recipes=[...relevant,...curated];
  const unique=new Set<string>();
  return recipes.filter(validRecipe).filter(r=>{
    const k=norm(r.name);
    if(unique.has(k))return false;
    unique.add(k);
    const text=(r.name+" "+r.ingredients.map(x=>x.name).join(" ")).toLowerCase();
    return (slot<2 || r.time<=preferences.maxWeeknightMinutes)
      && !restrictions.some(x=>text.includes(x));
  });
}
function proposeStored(saved:Recipe[],current:Recipe[],history:MenuHistory[],
  have:Record<string,boolean>,preferences:MenuPreferences):MenuOption[]{
  const previous=new Set(history.slice(-3).flatMap(h=>h.names.map(norm)));
  const pantry=new Set(Object.entries(have).filter(([,x])=>x).map(([name])=>norm(name)));
  const used=new Set<string>(),chosen=new Set<string>();
  return groups.flatMap((_,slot)=>{
    const candidates=storedCandidates(slot,saved,preferences)
      .filter(r=>!chosen.has(norm(r.name)));
    const ranked=candidates.map((recipe,i)=>{
      const favorite=saved.some(r=>norm(r.name)===norm(recipe.name))?8:0;
      const pantryBonus=recipe.ingredients.filter(x=>pantry.has(norm(x.name))).length*2;
      const duplicate=used.has(recipeProtein(recipe))?-15:10;
      const recent=previous.has(norm(recipe.name))?-55:0;
      const currentPenalty=norm(current[slot]?.name??"")===norm(recipe.name)?-5:0;
      return {recipe,i,score:favorite+pantryBonus+duplicate+recent+currentPenalty};
    }).sort((a,b)=>b.score-a.score||a.i-b.i);
    const recipe=ranked[0]?.recipe;
    if(!recipe)return [];
    chosen.add(norm(recipe.name));used.add(recipeProtein(recipe));
    return [{recipe,source:saved.some(r=>norm(r.name)===norm(recipe.name))?"saved" as const:"built-in" as const}];
  });
}
const labels=["Weekend breakfast","Sunday supper","Weeknight 1","Weeknight 2","Weeknight 3"];
export default function MealRecommendations({
  savedRecipes,current,included,history,have,preferences,onPreferences,
  onToggleIncluded,onApprove,getToken,householdId
}:Props){
  const [mode,setMode]=useState<Mode>("stored");
  const [draft,setDraft]=useState<(MenuOption|null)[]|null>(null);
  const [draftMode,setDraftMode]=useState<Mode>("stored");
  const [busy,setBusy]=useState(false);
  const [replacing,setReplacing]=useState<number|null>(null);
  const [message,setMessage]=useState("");
  const [variants,setVariants]=useState<Record<number,number>>({});
  const [showSettings,setShowSettings]=useState(false);
  const displayed=draft??current.map(recipe=>({recipe,
    source:recipe.sourceUrl?"published" as const:"built-in" as const}));
  const chosenCount=included.filter(Boolean).length;
  const missing=displayed.some((item,i)=>included[i]&&!item);
  const stored=useMemo(()=>proposeStored(savedRecipes,current,history,have,preferences),
    [savedRecipes,current,history,have,preferences]);
  const update=(part:Partial<MenuPreferences>)=>onPreferences({...preferences,...part});
  const generationPayload=(extra:Record<string,unknown>={})=>({
    householdId,preferences,history:history.slice(-4),
    current:current.map(r=>r.name),...extra
  });
  const auth=async()=>{
    const token=await getToken();
    if(!token || !householdId)throw new Error("Sign in under Family cloud sync to use online recipe modes.");
    return token;
  };
  const getRecipes=async(endpoint:string,extra:Record<string,unknown>={})=>{
    const token=await auth();
    const response=await fetch(endpoint,{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
      body:JSON.stringify(generationPayload(extra))});
    let data:{message?:string;recipes?:unknown[];slots?:SlotResult[]};
    try{data=await response.json()}catch{throw new Error("The recipe service did not return a valid response.");}
    if(!response.ok)throw new Error(data.message||"Recipe service unavailable.");
    return data;
  };
  const generate=async()=>{
    if(busy||replacing!==null)return;
    setMessage("");
    if(mode==="stored"){
      if(stored.length!==5){setMessage("Not enough recipes match the ingredient exclusions. Adjust them in Preferences.");return;}
      setDraft(stored);
      setDraftMode("stored");
      setMessage("Five recommendations are shown below. Review and approve when ready.");
      return;
    }
    setBusy(true);
    try{
      if(mode==="search"){
        const data=await getRecipes("/api/published-menu");
        if(!Array.isArray(data.slots)||data.slots.length!==5)throw new Error("The published-recipe search returned an incomplete response.");
        const rows:(MenuOption|null)[]=labels.map((_,slot)=>{
          const x=data.slots?.find(r=>r.slot===slot)?.recipe;
          if(!validRecipe(x)||!x.sourceUrl)return null;
          return {recipe:{...x,category:groups[slot][0].category},source:"published"};
        });
        setDraft(rows);
        setDraftMode("search");
        setVariants({});
        const count=rows.filter(Boolean).length;
        setMessage(count===5
          ?"Five published recipes imported. You can swap individual meals below."
          :count+" of five published recipes imported. Choose Try another or a saved recipe in the missing slots.");
      }else{
        const data=await getRecipes("/api/ai-menu");
        if(!Array.isArray(data.recipes)||data.recipes.length!==5||
          !data.recipes.every(validRecipe))throw new Error("The generated menu was incomplete.");
        setDraft((data.recipes as Recipe[]).map((recipe,slot)=>({
          recipe:{...recipe,category:groups[slot][0].category},source:"AI"})));
        setDraftMode("AI");
        setMessage("Five original recipes generated. Check the ingredient lists before approval.");
      }
    }catch(err){setMessage(err instanceof Error?err.message:"Could not generate recipes.");}
    finally{setBusy(false);}
  };
  const replaceLocal=(slot:number,picked?:Recipe)=>{
    const choices=storedCandidates(slot,savedRecipes,preferences);
    const actual=displayed[slot]?.recipe;
    const currentIndex=choices.findIndex(x=>norm(x.name)===norm(actual?.name??""));
    const next=picked??choices[(currentIndex+1+choices.length)%choices.length];
    if(!next){setMessage("No other stored recipes match these preferences for this meal.");return;}
    const replacement:MenuOption={recipe:{...next,category:groups[slot][0].category},
      source:savedRecipes.some(x=>norm(x.name)===norm(next.name))?"saved":"built-in"};
    setDraft(displayed.map((x,i)=>i===slot?replacement:x));
    setDraftMode("stored");
    setMessage("Updated "+labels[slot]+". The other four meals are unchanged.");
  };
  const replaceRemote=async(slot:number)=>{
    if(busy||replacing!==null)return;
    setReplacing(slot);
    setMessage("");
    try{
      let updated:MenuOption;
      if(draftMode==="search"){
        const variant=(variants[slot]??0)+1;
        const data=await getRecipes("/api/published-menu",{
          slot,variant,excludeUrls:displayed.flatMap(x=>x?.recipe.sourceUrl?[x.recipe.sourceUrl]:[])
        });
        setVariants(previous=>({...previous,[slot]:variant}));
        const recipe=data.slots?.find(x=>x.slot===slot)?.recipe;
        if(!validRecipe(recipe)||!recipe.sourceUrl)throw new Error("No complete published alternative was found. Try another or select a stored recipe.");
        updated={recipe:{...recipe,category:groups[slot][0].category},source:"published"};
      }else{
        const data=await getRecipes("/api/ai-menu");
        const recipe=data.recipes?.[slot];
        if(!validRecipe(recipe))throw new Error("AI did not return a complete replacement recipe.");
        updated={recipe:{...recipe,category:groups[slot][0].category},source:"AI"};
      }
      setDraft(displayed.map((x,i)=>i===slot?updated:x));
      setMessage("Updated "+labels[slot]+". All other meals were preserved.");
    }catch(err){setMessage(err instanceof Error?err.message:"Unable to replace this meal.");}
    finally{setReplacing(null);}
  };
  const changeServings=(slot:number,target:number)=>{
    const option=displayed[slot];
    if(!option)return;
    const result=scaleRecipe(option.recipe,target);
    if(result.recipe===option.recipe&&result.warnings.length){
      setMessage(result.warnings.join("; "));return;
    }
    setDraft(displayed.map((item,i)=>i===slot?{...option,recipe:result.recipe}:item));
    setMessage(result.warnings.length
      ?labels[slot]+" scaled to "+target+" servings. Review unscaled quantities listed in its card."
      :labels[slot]+" scaled to "+target+" servings. Ingredient amounts and shopping quantities have been updated.");
  };
  const approve=()=>{
    if(missing||chosenCount===0||busy||replacing!==null)return;
    const recipes=displayed.map((option,i)=>option?.recipe??current[i]);
    if(!recipes.every(validRecipe)){setMessage("A meal is missing required ingredients or instructions.");return;}
    onApprove(recipes,included);
    setDraft(null);
    setMessage("");
  };
  return <section className="panel unified-menu">
    <div className="section-heading">
      <h2>Choose your meals</h2>
      <p>One weekly menu, however you find the recipes. Choose a source, swap meals, then approve.</p>
    </div>
    <div className="menu-source-panel">
      <label className="menu-source-title">Choose how to fill your menu</label>
      <div className="menu-source-options" role="radiogroup" aria-label="Recipe source">
        <label className={mode==="stored"?"menu-source-option active":"menu-source-option"}>
          <input type="radio" checked={mode==="stored"} onChange={()=>setMode("stored")}/>
          <span><strong>Stored recipes</strong><small>Our library and curated favorites</small></span>
        </label>
        <label className={mode==="search"?"menu-source-option active":"menu-source-option"}>
          <input type="radio" checked={mode==="search"} onChange={()=>setMode("search")}/>
          <span><strong>Find published recipes</strong><small>Search and import real recipes</small></span>
        </label>
        <label className={mode==="AI"?"menu-source-option active":"menu-source-option"}>
          <input type="radio" checked={mode==="AI"} onChange={()=>setMode("AI")}/>
          <span><strong>Create with AI</strong><small>Generate original family meals</small></span>
        </label>
      </div>
      <div className="menu-source-bottom">
        <button className="secondary" onClick={()=>setShowSettings(x=>!x)}
          aria-expanded={showSettings}>{showSettings?"Hide preferences":"Adjust preferences"}</button>
        <span className="menu-source-hint">{mode==="stored"?"No AI credits required":
          mode==="search"?"Uses published-recipe search allowance":"Uses original-recipe generation allowance"}</span>
        <button disabled={busy||replacing!==null} onClick={()=>void generate()}>
          {busy?"Finding recipes…":mode==="stored"?"Suggest stored meals":mode==="search"?"Find five published recipes":"Generate five recipes"}
        </button>
      </div>
      {showSettings&&<div className="recommendation-settings">
        <label>Weeknight preparation time
          <select value={preferences.maxWeeknightMinutes} onChange={e=>update({maxWeeknightMinutes:Number(e.target.value)})}>
            {[25,30,40,45,60].map(x=><option key={x} value={x}>{x} minutes</option>)}
          </select>
        </label>
        <label>Ingredients to avoid
          <input value={preferences.avoid} placeholder="e.g. peanuts, shellfish"
            onChange={e=>update({avoid:e.target.value})}/>
        </label>
        <label className="span-all">Family preferences and notes
          <textarea rows={2} value={preferences.notes} maxLength={500}
            onChange={e=>update({notes:e.target.value})}/>
        </label>
      </div>}
    </div>
    {message&&<p className="notice" role="status">{message}</p>}
    {draft&&<div className="draft-notice">
      <span>Reviewing new suggestions — not yet approved</span>
      <button className="secondary" disabled={busy||replacing!==null}
        onClick={()=>{setDraft(null);setMessage("");}}>Discard suggestions</button>
    </div>}
    <div className="mealgrid">{displayed.map((option,slot)=>{
      const category=groups[slot][0].category;
      const recipe=option?.recipe;
      const isMissing=!option;
      const alternatives=storedCandidates(slot,savedRecipes,preferences);
      return <article className={!included[slot]?"card disabled":"card"} key={slot}>
        <div className="line">
          <span className="tag">{category}</span>
          <label className="meal-included">
            <input type="checkbox" checked={included[slot]} onChange={()=>onToggleIncluded(slot)}/> Include
          </label>
        </div>
        {recipe?<div className="meal-card-body">
          <h3>{recipe.name}</h3>
          <p>{recipe.description}</p>
          {recipe.sourceUrl&&<p className="published-source"><a href={recipe.sourceUrl}
            target="_blank" rel="noopener noreferrer">Original published recipe</a></p>}
          <div className="meal-card-meta">
            <small>{recipe.time} minutes · {recipe.servings} servings</small>
            {option?.source==="AI"&&<small>AI original</small>}
            {option?.source==="saved"&&<small>Family library</small>}
          </div>
          <div className="servings-toolbar">
            {recipe.servings!==5?<button type="button" className="secondary" onClick={()=>changeServings(slot,5)}
              disabled={busy||replacing!==null}>Scale to 5 servings</button>:<span className="servings-ready">✓ Sized for five</span>}
            {recipe.scalingBase&&<button type="button" className="servings-reset"
              onClick={()=>changeServings(slot,recipe.scalingBase!.servings)} disabled={busy||replacing!==null}>
              Restore original ({recipe.scalingBase.servings})
            </button>}
          </div>
          {recipe.scaleWarnings&&recipe.scaleWarnings.length>0&&<details className="scale-warnings">
            <summary>Review {recipe.scaleWarnings.length} unscaled ingredient(s)</summary>
            <ul>{recipe.scaleWarnings.map((note,i)=><li key={i}>{note}</li>)}</ul>
          </details>}
          <details className="meal-preview"><summary>Ingredients and directions</summary>
            <ul>{recipe.ingredients.map((item,i)=><li key={i}>{item.amount} — {item.name}</li>)}</ul>
            <ol>{recipe.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>
          </details>
        </div>:<div className="meal-card-body">
          <h3>Recipe needed</h3>
          <p>No complete published recipe was found here. The other suggestions are preserved.</p>
        </div>}
        <div className="meal-card-actions">
          <select aria-label={"Choose saved recipe for "+category} defaultValue=""
            key={slot+"-"+(draft?"draft":"current")+"-"+(recipe?.name??"missing")}
            onChange={e=>{const selected=alternatives[Number(e.target.value)];if(selected)replaceLocal(slot,selected);}}
            >
            <option value="">Choose stored recipe…</option>
            {alternatives.map((r,i)=><option key={i} value={i}>{r.name}</option>)}
          </select>
          <button className="secondary" disabled={busy||replacing!==null}
            onClick={()=>draftMode==="stored"&&!isMissing?replaceLocal(slot):void replaceRemote(slot)}>
            {replacing===slot?"Finding…":isMissing?"Find another":draftMode==="search"?"Try another published":draftMode==="AI"?"Try another with AI":"Try another"}
          </button>
        </div>
      </article>;
    })}</div>
    <div className="actions">
      <span>{chosenCount} meals selected{missing?" · complete the included missing slots":""}</span>
      <button disabled={chosenCount===0||missing||busy||replacing!==null} onClick={approve}>
        Approve menu →
      </button>
    </div>
  </section>;
}
