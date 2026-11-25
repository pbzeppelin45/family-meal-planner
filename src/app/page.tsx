"use client";
import { useEffect, useMemo, useState } from "react";
import { groups, type Recipe, type Ingredient } from "../lib/recipes";
import FamilyCloudSync from "./FamilyCloudSync";
import { consolidateGroceries, formatShoppingList, sectionOrder } from "../lib/shopping";
import type { MenuPreferences, MenuHistory } from "./MealRecommendations";
type Saved={step:number;choices:number[];included:boolean[];have:Record<string,boolean>;recipients:string;customRecipes?:Record<string,Recipe>;preferences?:MenuPreferences;mealHistory?:MenuHistory[]};
const initial:Saved={step:0,choices:[0,0,0,0,0],included:[true,true,true,true,true],have:{},recipients:"liam.philip.brett@gmail.com, zetzerk@gmail.com"};
const storageKey="family-meal-planner-v1";
const steps=["Choose meals","Check pantry","Shopping list","Share recipes"];
export default function Home(){
 const [state,setState]=useState<Saved>(initial);
 const [ready,setReady]=useState(false);
 const [notice,setNotice]=useState("");
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(storageKey)||"null");if(saved&&Array.isArray(saved.choices)&&saved.choices.length===5)setState({...initial,...saved});}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready)localStorage.setItem(storageKey,JSON.stringify(state));},[state,ready]);
 const patch=(p:Partial<Saved>)=>setState(s=>({...s,...p}));
 const approveMenu=()=>setState(s=>{
   const names=groups.flatMap((g,i)=>s.included[i]?[s.customRecipes?.[i]?.name ?? g[s.choices[i]]?.name ?? g[0].name]:[]);
   const last=s.mealHistory?.[s.mealHistory.length-1]?.names ?? [];
   const duplicate=JSON.stringify(names)===JSON.stringify(last);
   return {...s,step:1,mealHistory:duplicate?(s.mealHistory??[]):[...(s.mealHistory??[]),{at:new Date().toISOString(),names}].slice(-16)};
 });
 const applyMenu=(recipes:Recipe[])=>{
   if(recipes.length!==5)return;
   setState(s=>({...s,step:0,choices:[0,0,0,0,0],included:[true,true,true,true,true],
      have:{},customRecipes:Object.fromEntries(recipes.map((recipe,i)=>[String(i),
        {...recipe,category:groups[i][0].category}]))}));
 };

 const selected=useMemo(()=>groups.flatMap((g,i)=>state.included[i]?[state.customRecipes?.[i] ?? g[state.choices[i]]]:[]),[state.choices,state.included,state.customRecipes]);
 const ingredients=useMemo(()=>consolidateGroceries(selected),[selected]);
 const have=(ing:{name:string;pantry:boolean})=>state.have[ing.name]??ing.pantry;
 const need=ingredients.filter(x=>!have(x));
 const groupedNeed=sectionOrder.map(section=>({section,items:need.filter(item=>item.section===section)})).filter(group=>group.items.length);
 const packet=()=>{let t="FAMILY MEAL PLAN\n\n";for(const r of selected){t+=r.category.toUpperCase()+" — "+r.name+" ("+r.time+" min; "+r.servings+" servings)\n\nINGREDIENTS\n"+r.ingredients.map(x=>"• "+x.name+" — "+x.amount).join("\n")+"\n\nDIRECTIONS\n"+r.steps.map((x,i)=>(i+1)+". "+x).join("\n")+"\n\n";}t+="GROCERIES TO BUY\n"+need.map(x=>"• "+x.name+" — "+x.quantity).join("\n")+"\n\nALREADY HAVE\n"+ingredients.filter(have).map(x=>"• "+x.name+" — "+x.quantity).join("\n");return t};
 const copy=async(t:string)=>{try{await navigator.clipboard.writeText(t);setNotice("Copied to clipboard.");}catch{setNotice("Clipboard unavailable in this browser.");}};
 const download=()=>{const b=new Blob([packet()],{type:"text/plain"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="weekly-recipes.txt";a.click();URL.revokeObjectURL(u)};
 const email=()=>{const addresses=state.recipients.split(",").map(x=>x.trim()).filter(Boolean);if(!addresses.length||addresses.some(x=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))){setNotice("Enter valid comma-separated email addresses.");return;}const url="mailto:"+addresses.join(",")+"?subject="+encodeURIComponent("Family meal plan — recipes and shopping list")+"&body="+encodeURIComponent(packet());if(url.length>18000){setNotice("Email too long for a draft link; download the packet instead.");return;}window.location.href=url;};
 return <main className="shell"><header className="hero"><div className="eyebrow">YOUR FAMILY KITCHEN</div><h1>Family Meal Planner</h1><p>Plan meals, check your pantry, build a grocery list, and share the week's recipes.</p><span className="hint">Family plan · Browser backup + optional shared cloud sync</span></header>
 <nav className="progress" aria-label="Planning stages">{steps.map((name,i)=><button key={name} className={state.step===i?"active":""} onClick={()=>patch({step:i})}>{i+1}. {name}</button>)}</nav>
 {state.step===0&&<section className="panel"><div className="section-heading"><h2>Choose your meals</h2><p>Swap options or skip a meal before approving the menu.</p></div><div className="mealgrid">{groups.map((g,i)=>{const r=state.customRecipes?.[i] ?? g[state.choices[i]];return <article className={!state.included[i]?"card disabled":"card"} key={i}><div className="line"><span className="tag">{r.category}</span><label><input type="checkbox" checked={state.included[i]} onChange={()=>patch({included:state.included.map((v,j)=>j===i?!v:v)})}/> Include</label></div><h3>{r.name}</h3><p>{r.description}</p><div className="line"><small>{r.time} minutes · {r.servings} servings</small><button className="secondary" onClick={()=>patch({choices:state.choices.map((x,j)=>j===i?(x+1)%g.length:x),customRecipes:Object.fromEntries(Object.entries(state.customRecipes ?? {}).filter(([key])=>key!==String(i))),have:{}})}>Try another</button></div></article>})}</div><div className="actions"><span>{selected.length} meals selected</span><button disabled={!selected.length} onClick={approveMenu}>Approve menu →</button></div></section>}
 {state.step===1&&<section className="panel"><h2>Check your pantry</h2><p>Mark what you already have. Fresh ingredients start at Need; pantry staples start at Have.</p><div className="inventory">{ingredients.map(ing=><div className="item" key={ing.name}><div><strong>{ing.name}</strong><small>{ing.quantity}</small></div><div className="toggle"><button className={have(ing)?"chosen":""} onClick={()=>patch({have:{...state.have,[ing.name]:true}})}>Have</button><button className={!have(ing)?"chosen":""} onClick={()=>patch({have:{...state.have,[ing.name]:false}})}>Need</button></div></div>)}</div><div className="actions"><button className="secondary" onClick={()=>patch({step:0})}>← Meals</button><button onClick={()=>patch({step:2})}>Review {need.length} needed ingredients →</button></div></section>}
 {state.step===2&&<section className="panel">
   <h2>Safeway-ready shopping list</h2>
   <p>Organized by grocery department for Safeway #1477, NW Market Street, Seattle. Ingredients are combined when quantities have matching units. This release does not change your Safeway cart.</p>
   <div className="shopping-summary"><strong>{need.length} items needed</strong><span>{ingredients.length-need.length} already have</span></div>
   {groupedNeed.length ? groupedNeed.map(group=><section key={group.section} className="shopping-department">
     <h3>{group.section} <span>({group.items.length})</span></h3>
     {group.items.map(item=><div className="shopping-row" key={item.key}>
       <div><strong>{item.name}</strong><small>{item.quantity}</small>
         <small className="shopping-used">For: {item.usedIn.join(", ")}</small></div>
       <button className="secondary" title="Move this ingredient to Have" onClick={()=>patch({have:{...state.have,[item.name]:true}})}>Mark have</button>
     </div>)}
   </section>):<p>Everything is marked Have.</p>}
   <div className="actions"><button className="secondary" onClick={()=>patch({step:1})}>← Pantry</button>
   <button className="secondary" onClick={()=>copy(formatShoppingList(need))}>Copy by department</button>
   <button onClick={()=>patch({step:3})}>Share recipes →</button></div>
 </section>}
 {state.step===3&&<section className="panel"><h2>Review and share recipes</h2><p>Review the complete packet. Email opens a draft in your mail program; nothing is sent automatically.</p><label className="label" htmlFor="recipients">Recipients</label><input id="recipients" className="wide" value={state.recipients} onChange={e=>patch({recipients:e.target.value})}/>{selected.map((r:Recipe)=><article className="recipe" key={r.category}><span className="tag">{r.category}</span><h3>{r.name}</h3><p>{r.time} minutes · {r.servings} servings</p><h4>Ingredients</h4><ul>{r.ingredients.map((x:Ingredient,i)=><li key={i}>{x.name} — {x.amount}</li>)}</ul><h4>Instructions</h4><ol>{r.steps.map((x,i)=><li key={i}>{x}</li>)}</ol></article>)}<div className="actions"><button className="secondary" onClick={()=>patch({step:2})}>← Shopping list</button><button className="secondary" onClick={download}>Download packet</button><button onClick={email}>Open email draft →</button></div></section>}
 {notice&&<p className="notice" role="status">{notice}</p>}
 <FamilyCloudSync snapshot={state} onLoad={(next)=>setState(next)} selected={selected} onApplyMenu={applyMenu} onUseRecipe={(recipe,slot)=>setState(prev=>({...prev,customRecipes:{...prev.customRecipes,[slot]:{...recipe,category:groups[slot][0].category}},included:prev.included.map((value,i)=>i===slot?true:value),step:0,have:{}}))} />
 <footer>Family cloud sync is optional; purchases, checkout, and automatic email sending are not enabled.</footer></main>;
}