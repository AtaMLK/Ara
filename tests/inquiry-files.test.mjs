import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {filePreviewKind} from '../src/lib/ui/file-preview.ts';
const require=createRequire(import.meta.url);
const fileId='4389fa06-618a-4be8-9cca-ad6d891dbd86',inquiryId='3fd2d0e5-1fb3-4ed7-b401-03711829a5b6';
function action({admin=true,found=true}={}){
 let signed=0;const filters={};let options;
 const db={from(){return{select(){return this;},eq(key,value){filters[key]=value;return this;},async single(){return{data:found?{id:fileId,storage_path:'private/test.pdf',original_name:'Customer file.pdf',mime_type:'application/pdf'}:null,error:null};}}},storage:{from(bucket){assert.equal(bucket,'inquiry-files');return{async createSignedUrl(path,expiry,opts){signed++;assert.equal(path,'private/test.pdf');assert.equal(expiry,300);options=opts;return{data:{signedUrl:'https://files.example.invalid/temporary'},error:null};}}}}};
 const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(new URL('../src/app/actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{Error,module:mod,exports:mod.exports,require:name=>{
  if(name==='zod')return require(name);
  if(name==='@/lib/ai/guards')return{requireAdmin:async()=>{if(!admin)throw Error('Admin access required');return{supabase:db};}};
  if(name==='@/lib/errors')return{ToolError:class extends Error{constructor(code,message){super(message);}}};
  return{};
 }});
 return{run:mod.exports.getAdminInquiryFileUrlAction,filters,get signed(){return signed;},get options(){return options;}};
}
test('admin file access is scoped to file and inquiry with a temporary download link',async()=>{
 const call=action();const result=await call.run({inquiryId,fileId,download:true});
 assert.equal(result.fileName,'Customer file.pdf');assert.equal(call.filters.id,fileId);assert.equal(call.filters.inquiry_id,inquiryId);assert.equal(call.options.download,'Customer file.pdf');assert.equal(call.signed,1);
});
test('non-admin and missing/mismatched file cannot obtain signed access',async()=>{
 const denied=action({admin:false});await assert.rejects(denied.run({inquiryId,fileId}),/Admin access/);assert.equal(denied.signed,0);
 const absent=action({found:false});await assert.rejects(absent.run({inquiryId,fileId}),/not found/);assert.equal(absent.signed,0);
});
test('preview supports normal document formats without rendering active HTML',()=>{
 assert.equal(filePreviewKind('application/pdf','test.pdf'),'pdf');assert.equal(filePreviewKind('image/png','test.png'),'image');assert.equal(filePreviewKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','test.xlsx'),'sheet');assert.equal(filePreviewKind('text/plain','test.txt'),'text');assert.equal(filePreviewKind('text/html','test.html'),'unsupported');assert.equal(filePreviewKind('text/html','fake.pdf'),'unsupported');assert.equal(filePreviewKind('image/svg+xml','test.svg'),'unsupported');
});
