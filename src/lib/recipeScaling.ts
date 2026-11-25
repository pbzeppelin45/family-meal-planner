import type { Ingredient, Recipe } from "./recipes";

/** Ingredient scaling always starts from the publisher/original quantities. */
export type ScaleResult = { recipe:Recipe; warnings:string[] };
type Parsed = {value:number;end:number};
const glyphs:Record<string,number>={"½":.5,"¼":.25,"¾":.75,"⅓":1/3,"⅔":2/3,"⅛":.125,"⅜":.375,"⅝":.625,"⅞":.875};
const unitAliases:Record<string,string>={
  c:"cup",cup:"cup",cups:"cup",
  tsp:"tsp",teaspoon:"tsp",teaspoons:"tsp",t:"tbsp",tbsp:"tbsp",tablespoon:"tbsp",tablespoons:"tbsp",
  lb:"lb",lbs:"lb",pound:"lb",pounds:"lb",oz:"oz",ounce:"oz",ounces:"oz",
  g:"g",gram:"g",grams:"g",kg:"kg",ml:"ml",l:"l",
  clove:"clove",cloves:"clove",head:"head",heads:"head",bunch:"bunch",bunches:"bunch",
  can:"can",cans:"can",package:"package",packages:"package",pack:"pack",packs:"pack",
  slice:"slice",slices:"slice",piece:"piece",pieces:"piece",fillet:"fillet",fillets:"fillet",
  stalk:"stalk",stalks:"stalk",sprig:"sprig",sprigs:"sprig",egg:"egg",eggs:"egg",
  pint:"pint",pints:"pint",quart:"quart",quarts:"quart",
  inch:"inch",inches:"inch",fl:"fl"
};
const discrete=new Set(["clove","head","bunch","can","package","pack","slice","piece","fillet","stalk","sprig","egg"]);
const plural=new Set(["cup","clove","head","bunch","can","package","pack","slice","piece","fillet","stalk","sprig","egg","pint","quart","inch"]);
const roundCeil=(value:number,step:number)=>Math.ceil((value-1e-9)/step)*step;
function numericPrefix(text:string):Parsed|null{
  // Accept decimals, common fractions, unicode fractions and mixed numbers.
  const trimmed=text.trimStart();
  const mixed=trimmed.match(/^(\d+)\s*[- ]\s*(\d+)\/(\d+)/);
  const fraction=trimmed.match(/^(\d+)\/(\d+)/);
  const unicode=trimmed.match(/^(\d+)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])/);
  const decimal=trimmed.match(/^\d+(?:\.\d+)?/);
  const match=mixed??fraction??unicode??decimal;
  if(!match)return null;
  let n=0;
  if(mixed)n=Number(mixed[1])+Number(mixed[2])/Number(mixed[3]);
  else if(fraction)n=Number(fraction[1])/Number(fraction[2]);
  else if(unicode)n=Number(unicode[1]??0)+glyphs[unicode[2]];
  else n=Number(match[0]);
  if(!Number.isFinite(n)||n<=0)return null;
  return {value:n,end:text.length-trimmed.length+match[0].length};
}
function fraction(value:number):string{
  const quarters=Math.round(value*4);
  const whole=Math.floor(quarters/4),rest=quarters%4;
  const f=["","¼","½","¾"][rest];
  return [whole?String(whole):"",f].filter(Boolean).join(" ")||"0";
}
function compactNumber(n:number):string{
  return String(Math.round(n*100)/100);
}
function render(n:number,unit:string,detail:string,originalHasUnit:boolean):string{
  const useFraction=unit==="cup"||unit==="tbsp"||unit==="tsp"||unit==="pint"||unit==="quart";
  const number=useFraction?fraction(n):compactNumber(n);
  const word=unit==="count"?"":unit==="fl oz"?"fl oz":unit+(plural.has(unit)&&n!==1?"s":"");
  return [number,originalHasUnit?word:"",detail].filter(Boolean).join(" ");
}
function wholeCount(name:string,unit:string):boolean{
  if(discrete.has(unit))return true;
  if(unit!=="count")return false;
  return /(?:^|[^a-z])(?:eggs?|bananas?|apples?|lemons?|limes?|oranges?|onions?|shallots?|tomatoes?|potatoes?|peppers?|carrots?|cucumbers?|avocados?|zucchini|chickens?|garlic|heads?|tortillas?|rolls?|buns?)(?:$|[^a-z])/i.test(name);
}
/** Scales a single ingredient amount. Unsupported free text is preserved and flagged. */
export function scaleAmount(amount:string,ingredientName:string,ratio:number):{
 amount:string;warning?:string
}{
 if(!Number.isFinite(ratio)||ratio<=0)return {amount,warning:"Invalid serving ratio"};
 if(Math.abs(ratio-1)<1e-9)return {amount};
 const trimmed=amount.trim();
 // Avoid ambiguous "1-2", "2 to 3", "1 or 2" ranges; they require judgment.
 if(/^\s*\d+(?:\.\d+)?\s*(?:to|or|–|—)\s*\d/i.test(trimmed)||
    /^\s*\d+(?:\.\d+)?-\d+(?:\.\d+)?\b/.test(trimmed))
   return {amount,warning:"Quantity range needs manual adjustment"};
 const parsed=numericPrefix(trimmed);
 if(!parsed)return {amount,warning:"Non-numeric amount; review for new serving size"};
 let tail=trimmed.slice(parsed.end).trim();
 const match=tail.match(/^([a-z]+)\b/i);
 let unit=match?unitAliases[match[1].toLowerCase()]??"count":"count";
 if(match&&unit!=="count")tail=tail.slice(match[0].length).trim();
 else if(match && unit==="count"){
   // e.g. "2 large eggs" means 2 whole eggs, not a mysterious new unit.
   tail=tail;
 }
 if(unit==="fl"&&/^oz\b/i.test(tail)){unit="fl oz";tail=tail.replace(/^oz\b/i,"").trim();}
 if(unit==="count"&&match && /^(?:dozen|dozens)$/i.test(match[1])){
   const count=roundCeil(parsed.value*12*ratio,1);
   return {amount:render(count,"count","",false),warning:"Converted dozens to individual items"};
 }
 // "15 oz can" is a package size, not a request to buy a 19 oz can.
 if((unit==="oz"||unit==="fl oz"||unit==="g") && /^(can|cans|jar|jars|package|packages)\b/i.test(tail)){
   const packageType=tail.match(/^(can|cans|jar|jars|package|packages)\b/i)![1].toLowerCase();
   const singular=packageType.replace(/s$/,"");
   const count=roundCeil(ratio,1);
   return {amount:count+" × "+compactNumber(parsed.value)+" "+unit+" "+singular+(count!==1?"s":"")};
 }
 if(/\s\+\s*\d|\b(?:plus|and)\s+\d/i.test(tail))
   return {amount,warning:"Compound quantity needs manual adjustment"};
 const scaled=parsed.value*ratio;
 // Round UP to avoid coming short. Volume is measured in quarter units;
 // gram/ml use whole units, and countable produce/eggs/packs must stay whole.
 const increment=wholeCount(ingredientName,unit)?1:
   unit==="g"||unit==="ml"?1:
   unit==="kg"||unit==="l"?0.01:unit==="count"?1:0.25;
 const rounded=roundCeil(scaled,increment);
 return {amount:render(rounded,unit,tail,unit!=="count")};
}
export function scaleRecipe(recipe:Recipe,targetServings:number):ScaleResult{
 if(!Number.isInteger(targetServings)||targetServings<1||targetServings>30)
   return {recipe,warnings:["Target servings must be between 1 and 30"]};
 const original=recipe.scalingBase??{servings:recipe.servings,
   ingredients:recipe.ingredients.map(x=>({...x}))};
 if(!Number.isFinite(original.servings)||original.servings<=0)
   return {recipe,warnings:["Original serving count is invalid"]};
 if(targetServings===original.servings){
   const {scalingBase:unused,scaleWarnings:oldWarnings,...rest}=recipe;
   void unused;void oldWarnings;
   return {recipe:{...rest,servings:original.servings,
     ingredients:original.ingredients.map(x=>({...x}))},warnings:[]};
 }
 const ratio=targetServings/original.servings;
 const warnings:string[]=[];
 const ingredients:Ingredient[]=original.ingredients.map(item=>{
   const scaled=scaleAmount(item.amount,item.name,ratio);
   if(scaled.warning)warnings.push(item.name+": "+scaled.warning);
   return {...item,amount:scaled.amount};
 });
 return {recipe:{...recipe,servings:targetServings,ingredients,
   scalingBase:{servings:original.servings,ingredients:original.ingredients.map(x=>({...x}))},
   scaleWarnings:warnings},warnings};
}
