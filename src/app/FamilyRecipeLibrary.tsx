"use client";
import { useEffect, useState } from "react";
import { type SupabaseClient } from "@supabase/supabase-js";
import { groups, type Recipe } from "../lib/recipes";
type LibraryRow = { id: string; title: string; recipe: Recipe & { favorite?: boolean } };
const slots = groups.map(g => g[0].category);
export default function FamilyRecipeLibrary({
  client, householdId, selectedRecipes, refreshKey, onUse, onChanged
}: {
  client: SupabaseClient;
  householdId: string;
  selectedRecipes: Recipe[];
  refreshKey: number;
  onUse: (recipe: Recipe, slot: number) => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(slots[2]);
  const [minutes, setMinutes] = useState(30);
  const [servings, setServings] = useState(5);
  const [ingredients, setIngredients] = useState("");
  const [directions, setDirections] = useState("");
  const [slot, setSlot] = useState(2);

  useEffect(() => {
    let live = true;
    void client.from("family_recipes").select("id,title,recipe")
      .eq("household_id", householdId).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setStatus(error.message);
        else setRows((data ?? []) as LibraryRow[]);
      });
    return () => { live = false; };
  }, [client, householdId, refreshKey, reload]);

  useEffect(() => {
    const channel = client.channel("family-recipes-" + householdId)
      .on("postgres_changes", { event: "*", schema: "public", table: "family_recipes", filter: "household_id=eq." + householdId },
        () => setReload(value => value + 1)).subscribe();
    const poll = setInterval(() => setReload(value => value + 1), 30000);
    return () => { clearInterval(poll); void client.removeChannel(channel); };
  }, [client, householdId]);

  const perform = async (task: () => Promise<void>) => {
    setBusy(true);
    setStatus("");
    try {
      await task();
      onChanged();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not save recipe.");
    } finally { setBusy(false); }
  };

  const save = (recipe: Recipe) => void perform(async () => {
    const { error } = await client.from("family_recipes").insert({
      household_id: householdId, title: recipe.name,
      recipe: { ...recipe, favorite: false }
    });
    if (error) throw error;
    setStatus("Recipe added to the shared library.");
  });

  const createCustom = () => void perform(async () => {
    const items = ingredients.split("\n").map(x => x.trim()).filter(Boolean)
      .map(line => {
        const parts = line.split("|").map(x => x.trim());
        return { amount: parts.length > 1 ? parts[0] : "as needed",
          name: parts.length > 1 ? parts.slice(1).join(" | ") : line, pantry: false };
      });
    const steps = directions.split("\n").map(x => x.trim()).filter(Boolean);
    if (!name.trim() || items.length === 0 || steps.length === 0)
      throw new Error("Add a title, at least one ingredient, and at least one instruction.");
    const recipe: Recipe = {
      name: name.trim(), description: description.trim(), category,
      time: Math.max(1, Math.floor(minutes)), servings: Math.max(1, Math.floor(servings)),
      ingredients: items, steps
    };
    const { error } = await client.from("family_recipes").insert({
      household_id: householdId, title: recipe.name, recipe: { ...recipe, favorite: false }
    });
    if (error) throw error;
    setName(""); setDescription(""); setIngredients(""); setDirections("");
    setStatus("Custom recipe created.");
  });

  const toggleFavorite = (row: LibraryRow) => void perform(async () => {
    const { error } = await client.from("family_recipes")
      .update({ recipe: { ...row.recipe, favorite: !row.recipe.favorite } })
      .eq("id", row.id).eq("household_id", householdId);
    if (error) throw error;
    setStatus("Favorite updated.");
  });

  const remove = (row: LibraryRow) => void perform(async () => {
    if (!window.confirm("Remove this recipe from the shared library?")) return;
    const { error } = await client.from("family_recipes").delete()
      .eq("id", row.id).eq("household_id", householdId);
    if (error) throw error;
    setStatus("Recipe removed.");
  });

  return <div className="library">
    <h3>Family recipe library</h3>
    <p>Save favorites and family recipes. Everyone in this household can use them in the weekly menu.</p>
    <details>
      <summary>Save one of this week's meals</summary>
      <div className="library-grid">
        {selectedRecipes.map((r,i) => <div key={i} className="library-row">
          <span>{r.name}</span>
          <button className="secondary" disabled={busy} onClick={() => save(r)}>Save to library</button>
        </div>)}
      </div>
    </details>
    <details>
      <summary>Add a family recipe</summary>
      <div className="library-form">
        <label>Recipe name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sunday pot roast"/></label>
        <label>Category<select value={category} onChange={e => setCategory(e.target.value)}>
          {slots.map((c,i) => <option key={i} value={c}>{c}</option>)}
        </select></label>
        <label>Description<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description"/></label>
        <div className="cloud-inline">
          <label>Minutes<input type="number" min="1" max="999" value={minutes} onChange={e => setMinutes(Number(e.target.value))}/></label>
          <label>Servings<input type="number" min="1" max="100" value={servings} onChange={e => setServings(Number(e.target.value))}/></label>
        </div>
        <label>Ingredients (one per line; amount | ingredient)
          <textarea value={ingredients} onChange={e => setIngredients(e.target.value)}
            rows={5} placeholder={"2 lb | chicken thighs\n1 tbsp | olive oil"} /></label>
        <label>Instructions (one step per line)
          <textarea value={directions} onChange={e => setDirections(e.target.value)}
            rows={5} placeholder={"Season the chicken.\nBake until fully cooked."}/></label>
        <button disabled={busy} onClick={createCustom}>Save family recipe</button>
      </div>
    </details>
    <div className="cloud-inline">
      <label>Use saved recipes in<select value={slot} onChange={e => setSlot(Number(e.target.value))}>
        {slots.map((s,i) => <option value={i} key={i}>{s}</option>)}
      </select></label>
    </div>
    {rows.length ? <div className="library-grid">
      {rows.map(row => <div key={row.id} className="library-row">
        <div><strong>{row.recipe.favorite ? "★ " : ""}{row.title}</strong>
          <small>{row.recipe.time} min · {row.recipe.servings} servings</small></div>
        <div className="library-actions">
          <button disabled={busy} onClick={() => { onUse(row.recipe, slot); setStatus("Recipe added to selected meal slot."); }}>
            Use for {slots[slot]}</button>
          <button className="secondary" disabled={busy} onClick={() => toggleFavorite(row)}>
            {row.recipe.favorite ? "★ Favorite" : "☆ Favorite"}</button>
          <button className="secondary" disabled={busy} onClick={() => remove(row)}>Remove</button>
        </div>
      </div>)}
    </div> : <p>No saved recipes yet. Save a meal above to start your collection.</p>}
    {status && <p className="notice" role="status">{status}</p>}
  </div>;
}
