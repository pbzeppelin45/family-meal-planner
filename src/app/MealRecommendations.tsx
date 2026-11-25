"use client";
import { useMemo, useState } from "react";
import type { Recipe } from "../lib/recipes";
import { groups } from "../lib/recipes";

export type MenuPreferences = {
  maxWeeknightMinutes: number;
  avoid: string;
  notes: string;
};
export type MenuHistory = { at: string; names: string[] };
export type MenuOption = { recipe: Recipe; source: "saved" | "built-in" | "AI" | "published" };
type Props = {
  savedRecipes: Recipe[];
  current: Recipe[];
  history: MenuHistory[];
  have: Record<string, boolean>;
  preferences: MenuPreferences;
  onPreferences: (value: MenuPreferences) => void;
  onApply: (recipes: Recipe[]) => void;
  getToken: () => Promise<string | null>;
  householdId: string;
};
const normalize = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]/g,"");
const protein = (r: Recipe): string => {
  const text = (r.name+" "+r.ingredients.map(i=>i.name).join(" ")).toLowerCase();
  for (const [kind, matcher] of [
    ["fish", /salmon|tuna|cod|fish|shrimp|prawn/],
    ["chicken", /chicken/],
    ["turkey", /turkey/],
    ["pork", /pork|sausage|bacon/],
    ["beef", /beef|steak/]
  ] as const) if(matcher.test(text)) return kind;
  return "vegetarian";
};
const isRecipe = (v: unknown): v is Recipe => {
  if (!v || typeof v !== "object") return false;
  const r = v as Recipe;
  return typeof r.name === "string" && r.name.length > 2 && r.name.length <= 110
    && typeof r.description === "string"
    && Number.isFinite(r.time) && r.time > 0 && r.time < 360
    && Number.isFinite(r.servings) && r.servings >= 1 && r.servings <= 30
    && Array.isArray(r.ingredients) && r.ingredients.length >= 2
    && r.ingredients.length <= 35
    && r.ingredients.every(i => typeof i.name === "string" && typeof i.amount === "string")
    && Array.isArray(r.steps) && r.steps.length >= 2
    && r.steps.every(s => typeof s === "string");
};
function score(recipe: Recipe, recent: Set<string>, pantry: Set<string>, used: string[]) {
  const recentPenalty = recent.has(normalize(recipe.name)) ? -70 : 0;
  const pantryBonus = recipe.ingredients.reduce((sum, x) => sum + (pantry.has(normalize(x.name)) ? 2 : 0), 0);
  const proteinPenalty = used.includes(protein(recipe)) ? -12 : 10;
  return recentPenalty + pantryBonus + proteinPenalty
    - Math.max(0, recipe.time - 40) / 25;
}
function smartMenu(
  saved: Recipe[], history: MenuHistory[], pantryHave: Record<string,boolean>,
  prefs: MenuPreferences, current: Recipe[]
): MenuOption[] {
  const recent = new Set(history.slice(-3).flatMap(h => h.names.map(normalize)));
  const pantry = new Set(Object.entries(pantryHave).filter(([,v])=>v).map(([k])=>normalize(k)));
  const exclusions = prefs.avoid.split(/[,;\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  const used: string[] = [];
  const picked = new Set<string>();
  return groups.map((builtIn, slot) => {
    const inCategory = saved.filter(r => r.category === builtIn[0].category);
    // Saved recipes can also be used for any weeknight slot.
    const inWeeknights = slot >= 2 ? saved.filter(r => /^Weeknight/.test(r.category)) : [];
    const choices = [...inCategory, ...inWeeknights, ...builtIn]
      .filter(r => isRecipe(r))
      .filter(r => slot < 2 || r.time <= prefs.maxWeeknightMinutes)
      .filter(r => !exclusions.some(a=>((r.name+" "+r.ingredients.map(i=>i.name).join(" ")).toLowerCase().includes(a))))
      .filter(r => !picked.has(normalize(r.name)));
    // Prefer different meals from the current week when enough choices exist.
    const candidates = choices.length ? choices : [...inCategory,...inWeeknights,...builtIn]
      .filter(r=>isRecipe(r))
      .filter(r=>!exclusions.some(a=>((r.name+" "+r.ingredients.map(i=>i.name).join(" ")).toLowerCase().includes(a))))
      .filter(r=>!picked.has(normalize(r.name)));
    const ordered = candidates
      .map((r,i) => ({r,i,score:score(r,recent,pantry,used)
        + (saved.some(x=>normalize(x.name)===normalize(r.name)) ? 5:0)
        - (current[slot] && normalize(current[slot].name)===normalize(r.name) ? 4 : 0)}))
      .sort((a,b)=>b.score-a.score || a.i-b.i);
    const recipe = ordered[0]?.r;
    if (!recipe) return null;
    picked.add(normalize(recipe.name)); used.push(protein(recipe));
    return {recipe,source:saved.some(s=>normalize(s.name)===normalize(recipe.name))?"saved":"built-in"};
  }).filter((choice):choice is MenuOption=>choice!==null);
}
const defaultNotes = "Two adults and three kids; adventurous family meals, varied proteins, practical weeknights.";
export default function MealRecommendations({
  savedRecipes,current,history,have,preferences,onPreferences,onApply,getToken,householdId
}: Props) {
  const [options,setOptions] = useState<(MenuOption|null)[]>([]);
  const [busy,setBusy] = useState(false);
  const [replacing,setReplacing] = useState<number|null>(null);
  const [searchVariants,setSearchVariants] = useState<Record<number,number>>({});
  const [message,setMessage] = useState("");
  const [mode,setMode] = useState<"smart" | "search" | "AI">("smart");
  const [found,setFound] = useState<{summary:string;sources:{url:string;title:string}[]}|null>(null);
  const candidates = useMemo(()=>smartMenu(savedRecipes,history,have,preferences,current),[
    savedRecipes,history,have,preferences,current
  ]);
  const update = (part:Partial<MenuPreferences>) => onPreferences({...preferences,...part});
  const generate = async () => {
    setMessage("");
    setOptions([]);
    setFound(null);
    setSearchVariants({});
    if(mode === "smart") {
      if(candidates.length!==5){setOptions([]);setMessage("Not enough recipes match these exclusions. Adjust them or use AI to generate alternatives.");return;}
      setOptions(candidates);
      setMessage("Recommendations ranked using your recipes, recently approved menus, time limit and pantry.");
      return;
    }
    setBusy(true);
    try {
      const token = await getToken();
      if(!token) throw new Error("Please sign in to generate new recipes.");
      const response = await fetch(mode === "search" ? "/api/published-menu" : "/api/ai-menu",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
        body:JSON.stringify({householdId,preferences,history:history.slice(-4),current:current.map(r=>r.name)})
      });
      const data: {
        message?:string;recipes?:unknown[];slots?:{slot:number;recipe:unknown|null}[];
        summary?:string;sources?:{title:string;url:string}[];sourceType?:string
      } = await response.json();
      if(!response.ok) throw new Error(data.message || "Recipe service was not available.");
      if(mode === "search") {
        if(!Array.isArray(data.slots) || data.slots.length!==5)
          throw new Error("Published recipe results were incomplete. Please retry.");
        const imported:(MenuOption|null)[]=groups.map((g,slot)=>{
          const hit=data.slots?.find(x=>x.slot===slot);
          if(!hit || !isRecipe(hit.recipe) || !hit.recipe.sourceUrl) return null;
          return {recipe:{...hit.recipe,category:g[0].category},source:"published"};
        });
        setOptions(imported);
        const successful=imported.filter(Boolean).length;
        setMessage(successful===5
          ? "All five published recipes are ready. Review them or choose Try another for any meal."
          : successful
            ? successful+" published recipes imported. Choose Try another on missing meal slots; successful recipes are preserved."
            : "No complete publisher recipes could be extracted. Try another for an individual meal slot.");
        return;
      }
      if(!Array.isArray(data.recipes) || data.recipes.length !== 5 || !data.recipes.every(isRecipe))
        throw new Error("The generator returned an incomplete recipe set.");
      const recipes = (data.recipes as Recipe[]).map((r,i)=>({...r,category:groups[i][0].category}));
      setOptions(recipes.map(recipe=>({recipe,source:"AI"})));
      setMessage("New recipes generated. Review the full recipes before applying them.");
    } catch(err) {
      setMessage(err instanceof Error ? err.message : "Could not generate recipes.");
    } finally { setBusy(false); }
  };
  const tryAnotherPublished = async (slot:number) => {
    if(slot<0 || slot>4 || replacing!==null || busy)return;
    setReplacing(slot);
    const nextVariant=(searchVariants[slot]??0)+1;
    setSearchVariants(previous=>({...previous,[slot]:nextVariant}));
    setMessage("");
    try {
      const token=await getToken();
      if(!token)throw new Error("Sign in again to find another published recipe.");
      const urls=options.flatMap(x=>x?.recipe.sourceUrl?[x.recipe.sourceUrl]:[]);
      const res=await fetch("/api/published-menu",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
        body:JSON.stringify({householdId,slot,variant:nextVariant,excludeUrls:urls,preferences,
          history:history.slice(-4),current:current.map(r=>r.name)})
      });
      const data:{message?:string;slots?:{slot:number;recipe:unknown|null}[]}=await res.json();
      if(!res.ok)throw new Error(data.message||"Could not find a different recipe.");
      const incoming=data.slots?.find(x=>x.slot===slot)?.recipe;
      if(!isRecipe(incoming))
        throw new Error("No complete recipe was found for this meal. You can try another search.");
      const recipe={...incoming,category:groups[slot][0].category};
      if(!recipe.sourceUrl)throw new Error("Publisher URL missing for this alternative.");
      setOptions(previous=>previous.map((item,i)=>i===slot?{recipe,source:"published"}:item));
      setMessage("Replaced one meal. The other four suggestions are unchanged.");
    }catch(e){
      setMessage(e instanceof Error?e.message:"Unable to replace this meal.");
    }finally{setReplacing(null);}
  };
  return <section className="panel recommendation-panel">
    <div className="section-heading">
      <h2>Weekly menu ideas</h2>
      <p>Suggest five meals: one weekend breakfast, one Sunday supper and three weeknight dinners. Published recipes include source links and imported ingredients; nothing changes until you approve.</p>
    </div>
    <div className="recommendation-settings">
      <label>Weeknight time limit
        <select value={preferences.maxWeeknightMinutes} onChange={e=>update({maxWeeknightMinutes:Number(e.target.value)})}>
          {[25,30,40,45,60].map(v=><option key={v} value={v}>{v} minutes</option>)}
        </select>
      </label>
      <label>Ingredients to avoid (comma-separated)
        <input value={preferences.avoid} placeholder="e.g. peanuts, shellfish" onChange={e=>update({avoid:e.target.value})}/>
      </label>
      <label className="span-all">Family preferences and notes
        <textarea rows={2} maxLength={500} value={preferences.notes||defaultNotes}
          onChange={e=>update({notes:e.target.value})}/>
      </label>
    </div>
    <div className="recommendation-actions">
      <label><input type="radio" checked={mode==="smart"} onChange={()=>setMode("smart")}/> Recommend from our recipes</label>
      <label><input type="radio" checked={mode==="search"} onChange={()=>setMode("search")}/> Find and import published recipes</label>
      <label><input type="radio" checked={mode==="AI"} onChange={()=>setMode("AI")}/> Create original recipes with AI</label>
      <button disabled={busy} onClick={()=>void generate()}>{busy?"Generating…":"Generate weekly ideas"}</button>
    </div>
    {message && <p role="status" className="notice">{message}</p>}
    {found && <div className="source-results">
      <h3>Published recipe search results</h3>
      <p className="source-disclaimer">Published recipes are not imported automatically. Some links may be search queries rather than verified recipe pages; open each publisher’s recipe and check the ingredients, instructions and timing before adding it to your plan.</p>
      <div className="source-summary">{found.summary}</div>
      <h4>Original sources</h4>
      <ul className="source-links">{found.sources.map((source,i)=><li key={i}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>
      </li>)}</ul>
    </div>}
    {options.length > 0 && <>
      <div className="recommendation-grid">
        {options.map((option,i)=>{
          if(!option)return <article className="recommendation-card" key={i}>
            <div className="line"><span className="tag">{groups[i][0].category}</span><small>Needs a recipe</small></div>
            <h3>Find a published recipe</h3>
            <p>No complete recipe could be extracted for this slot. Other completed meals are preserved.</p>
            <button className="secondary" disabled={replacing!==null||busy}
              onClick={()=>void tryAnotherPublished(i)}>{replacing===i?"Searching…":"Try another published recipe"}</button>
          </article>;
          const {recipe,source}=option;
          return <article className="recommendation-card" key={i}>
            <div className="line"><span className="tag">{groups[i][0].category}</span>
              <small>{source==="AI"?"AI-generated":source==="published"?"Published recipe":source==="saved"?"Family library":"Curated recipe"}</small>
            </div>
            <h3>{recipe.name}</h3><p>{recipe.description}</p>
            <p><strong>{recipe.time} min · {recipe.servings} servings</strong></p>
            {recipe.sourceUrl && <p className="published-source"><a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">Original recipe: {recipe.sourceTitle ?? new URL(recipe.sourceUrl).hostname}</a></p>}
            {source==="published" && <button className="secondary" disabled={replacing!==null||busy}
              onClick={()=>void tryAnotherPublished(i)}>{replacing===i?"Finding another…":"Try another published recipe"}</button>}
            <details><summary>Preview ingredients and steps</summary>
              <ul>{recipe.ingredients.map((ing,j)=><li key={j}>{ing.amount} — {ing.name}</li>)}</ul>
              <ol>{recipe.steps.map((step,j)=><li key={j}>{step}</li>)}</ol>
            </details>
          </article>;
        })}
      </div>
      <div className="actions"><button disabled={replacing!==null||busy||options.some(x=>!x)} onClick={()=>{
        if(!window.confirm("Replace all five menu slots with these suggestions? Your pantry Have/Need choices will be reset."))return;
        onApply(options.filter((o):o is MenuOption=>o!==null).map(o=>o.recipe));
        setOptions([]);
        setMessage("Five suggested meals applied. Review the menu before approving it.");
      }}>Use this suggested menu</button></div>
    </>}
  </section>;
}
