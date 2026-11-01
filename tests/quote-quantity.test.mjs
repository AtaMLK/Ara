import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const itemId='2b100dbb-601a-4619-99d2-80997f960edb';
function action({affected=true}={}){
 let writes=0;
 const db={from(table){return {select(){return this;},eq(){return this;},update(value){writes++;this.value=value;return this;},async single(){
  if(table==='customer_quotes')return {data:{id:'q1',status:'draft'},error:null};
  if(this.value)return {data:affected?{quantity:this.value.quantity,price_status:this.value.price_status}:null,error:null};
  return {data:{id:itemId,customer_quote_id:'q1',quantity:'5',price_status:'admin_confirmed'},error:null};
 }}}};
 const mod={exports:{}};
 const source=fs.readFileSync(new URL('../src/app/actions.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const load=name=>{
  if(name==='zod')return require('zod');
  if(name==='next/cache')return {revalidatePath(){}};
  if(name==='@/lib/ai/guards')return {requireAdmin:async()=>({supabase:db})};
  if(name==='@/lib/errors')return {ToolError:class extends Error{constructor(code,message){super(message);this.code=code;}}};
  return {};
 };
 vm.runInNewContext(code,{require:load,exports:mod.exports,module:mod});
 return {save:mod.exports.updateCustomerQuoteItemQuantityAction,get writes(){return writes;}};
}
test('saving an unchanged quantity preserves confirmed pricing',async()=>{
 const run=action();const result=await run.save(itemId,5);
 assert.equal(result.quantity,5);assert.equal(result.priceStatus,'admin_confirmed');assert.equal(run.writes,0);
});
test('quantity save returns the persisted value and requires price confirmation again',async()=>{
 const run=action();const result=await run.save(itemId,6);
 assert.equal(result.quantity,6);assert.equal(result.priceStatus,'suggested');assert.equal(run.writes,1);
});
test('a quantity update with no affected row cannot report success',async()=>{
 await assert.rejects(action({affected:false}).save(itemId,6),/could not be updated/);
});
