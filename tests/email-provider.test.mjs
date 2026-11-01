import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=fs.readFileSync(new URL('../src/lib/email/provider.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function selected(provider){
 const smtp={send(){}};const mod={exports:{}};
 vm.runInNewContext(code,{process:{env:{EMAIL_PROVIDER:provider}},exports:mod.exports,module:mod,require:name=>{
  if(name==='node:crypto')return require(name);
  if(name==='./smtp-provider')return {getSmtpEmailProvider:()=>smtp};
  if(name==='@/lib/errors')return {ToolError:class extends Error{constructor(code,message){super(message);}}};
  return {};
 }});
 return {provider:mod.exports.getEmailProvider,smtp};
}
test('configured SMTP uses the SMTP adapter rather than Resend',()=>{
 const result=selected('smtp');assert.equal(result.provider(),result.smtp);
});
test('Resend remains available and unsupported adapters fail explicitly',()=>{
 const result=selected('resend');assert.notEqual(result.provider(),result.smtp);
 assert.equal(typeof result.provider().send,'function');
 assert.throws(selected('unknown').provider,/Unsupported email provider/);
});
