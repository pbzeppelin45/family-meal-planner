/* Test the actual TypeScript scaling utility without a test framework. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const ts=require("typescript");
const filename=path.join(__dirname,"../src/lib/recipeScaling.ts");
const js=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
}).outputText;
const compiled=new Module(filename,module);
compiled.filename=filename;
compiled.paths=Module._nodeModulePaths(path.dirname(filename));
compiled._compile(js,filename);
const {scaleAmount,scaleRecipe}=compiled.exports;
const amount=(text,name="Flour",ratio=1.25)=>scaleAmount(text,name,ratio).amount;
assert.equal(amount("1 cup"),"1 ¼ cups");
assert.equal(amount("1/3 cup"),"½ cup");
assert.equal(amount("1 1/2 cups"),"2 cups");
assert.equal(amount("¾ tsp"),"1 tsp");
assert.equal(amount("2 tsp"),"2 ½ tsp");
assert.equal(amount("2 tbsp"),"2 ½ tbsp");
assert.equal(amount("2","Eggs"),"3");
assert.equal(amount("2 large","Eggs"),"3 large");
assert.equal(amount("3 cloves","Garlic"),"4 cloves");
assert.equal(amount("2","Bell peppers"),"3");
assert.equal(amount("1.5 lb","Ground turkey"),"2 lb");
assert.equal(amount("15 oz can","Beans"),"2 × 15 oz cans");
assert.equal(amount("13.5 fl oz","Coconut milk"),"17 fl oz");
assert.equal(amount("to taste","Salt"),"to taste");
assert.ok(scaleAmount("to taste","Salt",1.25).warning);
assert.ok(scaleAmount("1-2 cups","Flour",1.25).warning);
assert.equal(amount("2 cups", "Flour", 1),"2 cups");
const input={
  name:"Baked Eggs",category:"Weekend breakfast",time:30,servings:4,description:"Eggs and milk",
  ingredients:[
    {name:"Eggs",amount:"3"},
    {name:"Milk",amount:"1 cup"},
    {name:"Salt",amount:"to taste"}
  ],steps:["Mix ingredients.","Bake until cooked."]
};
const five=scaleRecipe(input,5);
assert.equal(five.recipe.servings,5);
assert.equal(five.recipe.ingredients[0].amount,"4");
assert.equal(five.recipe.ingredients[1].amount,"1 ¼ cups");
assert.equal(five.recipe.ingredients[2].amount,"to taste");
assert.equal(five.warnings.length,1);
assert.equal(input.ingredients[0].amount,"3");
const original=scaleRecipe(five.recipe,4);
assert.equal(original.recipe.ingredients[0].amount,"3");
assert.equal(original.recipe.ingredients[1].amount,"1 cup");
assert.equal(original.recipe.scalingBase,undefined);
const ten=scaleRecipe(five.recipe,10);
assert.equal(ten.recipe.ingredients[0].amount,"8");
assert.equal(ten.recipe.ingredients[1].amount,"2 ½ cups");
console.log("Recipe scaling tests passed");
