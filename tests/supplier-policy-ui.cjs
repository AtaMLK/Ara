// Render the real supplier panel with isolated actions. Never connects to production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {webpack}=require('next/dist/compiled/webpack/webpack');
const {chromium}=require('@playwright/test');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-results','supplier-policy-ui');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'loader.cjs'),`const swc=require(${JSON.stringify(require.resolve('next/dist/build/swc'))});module.exports=function(source){return swc.transformSync(source,{filename:this.resourcePath,jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2020'},module:{type:'es6'}}).code;}`);
fs.writeFileSync(path.join(dir,'language.tsx'),`export function T({children}){return <>{children}</>} export function Localized({as:Tag='div',children,...props}){return <Tag {...props}>{children}</Tag>} export function useI18n(){return {t:value=>value}}`);
fs.writeFileSync(path.join(dir,'actions.ts'),`export async function verifySupplierCandidateAction(){} export async function sendSupplierRfqAction(){throw Error('Must not send an email')} export async function getSupplierRfqPreviewAction(input){window.__selection=input.candidateIds;return {previews:[{candidateId:input.candidateIds[0],candidateIds:input.candidateIds,recipient:'sales@shared.example',subject:'Combined RFQ',html:'<p>Sensor A</p><p>Motor B</p>'}]}} export async function loadMoreSupplierCandidatesAction(){window.__more=(window.__more||0)+1;window.__append();return {limit:15,hasMore:false}}`);
fs.writeFileSync(path.join(dir,'navigation.js'),`export function useRouter(){return {refresh(){}}}`);
fs.writeFileSync(path.join(dir,'toast.js'),`export const toast={success(){},error(){}};`);
fs.writeFileSync(path.join(dir,'entry.tsx'),`import {createRoot} from 'react-dom/client';import {useState} from 'react';import {CandidatePanel} from '@/app/inquiries/[id]/candidate-panel';
const req=[{id:'a',type:'product',value:'Sensor A',status:'confirmed',source_ref:'a'},{id:'b',type:'product',value:'Motor B',status:'confirmed',source_ref:'b'}];
function candidate(id,item,supplier){return {id,requirement_id:item,supplier_id:supplier,proposed_name:supplier,proposed_country:'Turkey',proposed_website:'https://'+supplier+'.example',status:'finalized',created_at:'2026-10-19',match_evidence:{},verification_evidence:{verification_status:'verified'},suppliers:{id:supplier,legal_name:supplier,primary_country:'Turkey',supplier_type:'distributor',verification_status:id==='a2'?'pending':'verified',supplier_contacts:[],supplier_emails:[{email:'sales@'+supplier+'.example',is_primary:true,status:'active'}],supplier_phones:[],supplier_addresses:[],supplier_websites:[]}}}
function App(){const [rows,setRows]=useState([...Array.from({length:6},(_,i)=>{const row=candidate('a'+i,'a',i===0?'shared':'company'+i);if(i===5){row.proposed_country='Germany';row.suppliers.primary_country='Germany';}return row;}),candidate('alias','a','shared'),candidate('b0','b','shared')]);window.__append=()=>setRows(old=>[...old,...Array.from({length:5},(_,i)=>candidate('new'+i,'a','new'+i))]);return <CandidatePanel inquiryId="demo" requirements={req} candidates={rows} reviewProgress={{a:{limit:5,hasMore:true}}}/>}
createRoot(document.getElementById('root')).render(<App/>);`);
(async()=>{
 await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(dir,'entry.tsx'),output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'next/navigation':path.join(dir,'navigation.js'),'@/components/language':path.join(dir,'language.tsx'),'./supplier-rfq-actions':path.join(dir,'actions.ts'),'./supplier-discovery-actions':path.join(dir,'actions.ts'),'sonner':path.join(dir,'toast.js'),'@':path.join(root,'src')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(dir,'loader.cjs')}]}});compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack)});
  await page.setContent('<html><body><main style="padding:30px"><div id="root"></div></main></body></html>');
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8')});await page.addScriptTag({path:path.join(dir,'bundle.js')});
  await page.locator('.supplier-count-button').first().click();
  const rows=page.locator('.supplier-candidate-row');await rows.first().waitFor();assert.equal(await rows.count(),5);assert.equal(await rows.filter({hasText:'company5'}).count(),0,'Domestic companies precede the stored foreign option');
  await rows.filter({hasText:'shared'}).locator('input').check();
  await page.getByRole('button',{name:'Show 5 more suppliers',exact:true}).click();assert.equal(await rows.count(),6);assert.equal(await page.evaluate(()=>window.__more||0),0,'Stored rows need no backend AI review');
  assert.equal(await rows.filter({hasText:'company2'}).locator('input').isDisabled(),true,'Stale evidence cannot override a pending supplier status');
  await page.getByRole('button',{name:'Show 5 more suppliers',exact:true}).click();await page.waitForFunction(()=>window.__more===1);assert.equal(await rows.count(),11);
  assert.equal(await page.getByRole('button',{name:'Show 5 more suppliers',exact:true}).count(),0);
  await page.screenshot({path:path.join(dir,'suppliers-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Review 1 supplier email(s) for 2 selected items',exact:true}).click();
  await page.getByText('Review 1 supplier message',{exact:true}).waitFor();assert.deepEqual(new Set(await page.evaluate(()=>window.__selection)),new Set(['a0','b0']));
  assert.equal(await page.locator('iframe').count(),1);assert.match(await page.locator('iframe').getAttribute('srcdoc'),/Sensor A.*Motor B/);
  await page.screenshot({path:path.join(dir,'combined-email.png'),fullPage:true});assert.deepEqual(errors,[]);
  console.log('Supplier panel passed: first five, local/remote next five, exhaustion, Admin downgrade, cross-item selection, one combined preview.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
