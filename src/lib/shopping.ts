import type { Recipe } from "./recipes";

export type GrocerySection =
  | "Produce" | "Meat & seafood" | "Dairy & eggs" | "Bakery & bread"
  | "Frozen" | "Canned & jarred" | "Dry goods & grains"
  | "Spices, oils & condiments" | "Other";

export type GroceryItem = {
  key: string;
  name: string;
  amounts: string[];
  quantity: string;
  pantry: boolean;
  section: GrocerySection;
  usedIn: string[];
};

export const sectionOrder: GrocerySection[] = [
  "Produce", "Meat & seafood", "Dairy & eggs", "Bakery & bread",
  "Frozen", "Canned & jarred", "Dry goods & grains",
  "Spices, oils & condiments", "Other"
];

export const ingredientKey = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, " ").trim();

export function grocerySection(name: string): GrocerySection {
  const n = ingredientKey(name);
  if (/frozen|ice cream|frozen berries/.test(n)) return "Frozen";
  if (/chicken|turkey|beef|pork|sausage|bacon|salmon|shrimp|fish|cod|steak/.test(n))
    return "Meat & seafood";
  if (/milk|cream|yogurt|cheese|parmesan|butter|eggs|feta|mozzarella/.test(n))
    return "Dairy & eggs";
  if (/bread|bagel|tortilla|pita|rolls|bun|croissant/.test(n)) return "Bakery & bread";
  if (/canned|crushed tomatoes|tomato paste|coconut milk|beans|broth|stock|jarred/.test(n))
    return "Canned & jarred";
  if (/garlic|onion|ginger|pepper|potato|carrot|cucumber|lettuce|spinach|broccoli|green bean|mushroom|banana|apple|lemon|lime|tomato|berries|avocado|celery|kale|zucchini|shallot|parsley|cilantro|basil|sweet potato/.test(n))
    return "Produce";
  if (/cinnamon|seasoning|vanilla|oil|vinegar|honey|maple syrup|salt|peppercorn|cumin|paprika|turmeric|oregano|thyme|chili|sauce|mustard|mayonnaise|baking powder|baking soda|sugar/.test(n))
    return "Spices, oils & condiments";
  if (/rice|orzo|gnocchi|pasta|noodle|oat|polenta|cornmeal|flour|quinoa|lentil|couscous|barley/.test(n))
    return "Dry goods & grains";
  return "Other";
}

type Quantity = { amount: number; unit: string; detail: string };
const units: Record<string, string> = {
  lb:"lb",lbs:"lb",pound:"lb",pounds:"lb",
  oz:"oz",ounce:"oz",ounces:"oz",
  g:"g",gram:"g",grams:"g",kg:"kg",
  cup:"cup",cups:"cup",tbsp:"tbsp",tablespoon:"tbsp",tablespoons:"tbsp",
  tsp:"tsp",teaspoon:"tsp",teaspoons:"tsp",clove:"clove",cloves:"clove",
  head:"head",heads:"head",can:"can",cans:"can",
  bunch:"bunch",bunches:"bunch",fl:"fl",ml:"ml",l:"l"
};
function decimal(value: string): number | null {
  const mixed = value.trim().match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2])/Number(mixed[3]);
  const frac = value.trim().match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1])/Number(frac[2]);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseQuantity(text: string): Quantity | null {
  const input = text.trim().toLowerCase();
  // Supports '1 1/2 cups', '1.5 cups', '3 cloves', '2' and '13.5 fl oz'.
  const match = input.match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)(?:\s+([a-z]+))?(?:\s+([a-z]+))?(.*)$/);
  if (!match) return null;
  const amount = decimal(match[1]);
  if (amount===null || amount<=0) return null;
  let unit = units[match[2]??""] ?? match[2] ?? "count";
  let detail = [match[3]??"",match[4]??""].join(" ").trim();
  if (unit === "fl" && match[3] === "oz") {unit="fl oz";detail=match[4].trim();}
  else if (unit === "count") detail="";
  else if (match[3] && !match[4] && !units[match[3]]) detail=match[3];
  return {amount,unit,detail};
}
function tidy(value:number): string {
  return String(Math.round(value*100)/100);
}
const displayUnit:Record<string,string> = {
  cup:"cup",tbsp:"tbsp",tsp:"tsp",lb:"lb",oz:"oz",
  clove:"clove",head:"head",can:"can",bunch:"bunch"
};
function formatUnit(amount:number,unit:string,detail:string):string {
  const base=displayUnit[unit]??unit;
  const plural = amount!==1 && ["cup","clove","head","can","bunch"].includes(unit) ? "s":"";
  return [tidy(amount), unit==="count"?"":base+plural, detail].filter(Boolean).join(" ");
}
export function combineQuantities(amounts: string[]): string {
  const totals=new Map<string,{amount:number;unit:string;detail:string}>();
  const raw:string[]=[];
  for (const text of amounts) {
    const parsed=parseQuantity(text);
    if (!parsed) {raw.push(text);continue;}
    const key=parsed.unit+"|"+parsed.detail;
    const prev=totals.get(key);
    if(prev) prev.amount+=parsed.amount;
    else totals.set(key,{...parsed});
  }
  return [...totals.values()].map(q=>formatUnit(q.amount,q.unit,q.detail))
    .concat(raw).join(" + ");
}
export function consolidateGroceries(recipes:Recipe[]):GroceryItem[] {
  const items=new Map<string,GroceryItem>();
  for(const recipe of recipes) {
    for(const ingredient of recipe.ingredients){
      const key=ingredientKey(ingredient.name);
      if(!key)continue;
      let item=items.get(key);
      if(!item){
        item={key,name:ingredient.name,amounts:[],quantity:"",pantry:!!ingredient.pantry,
          section:grocerySection(ingredient.name),usedIn:[]};
        items.set(key,item);
      }
      item.amounts.push(ingredient.amount);
      item.pantry=item.pantry && !!ingredient.pantry;
      if(!item.usedIn.includes(recipe.name))item.usedIn.push(recipe.name);
    }
  }
  return [...items.values()].map(item=>({...item,quantity:combineQuantities(item.amounts)}))
    .sort((a,b)=>sectionOrder.indexOf(a.section)-sectionOrder.indexOf(b.section)||a.name.localeCompare(b.name));
}
export function formatShoppingList(items:GroceryItem[]):string {
  return sectionOrder.flatMap(section=>{
    const rows=items.filter(i=>i.section===section);
    if(!rows.length)return [];
    return [section.toUpperCase(),...rows.map(i=>"- "+i.name+" — "+i.quantity),""];
  }).join("\n").trim();
}
