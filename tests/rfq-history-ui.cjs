// Isolated real-component browser test. All actions are mocked; no mail or DB writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {webpack}=require('next/dist/compiled/webpack/webpack'),{chromium}=require('@playwright/test');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-results','rfq-history-ui');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'loader.cjs'),`const swc=require(${JSON.stringify(require.resolve('next/dist/build/swc'))});module.exports=function(source){return swc.transformSync(source,{filename:this.resourcePath,jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2020'},module:{type:'es6'}}).code;}`);
fs.writeFileSync(path.join(dir,'actions.js'),`export async function cancelRfqAction(id,reason){window.__cancelled={id,reason};} export async function markNotificationReadAction(){}`);
fs.writeFileSync(path.join(dir,'navigation.js'),`export function useRouter(){return {refresh(){}}}`);
fs.writeFileSync(path.join(dir,'toast.js'),`export const toast={success(){},error(){}};`);
fs.writeFileSync(path.join(dir,'entry.tsx'),`import {createRoot} from 'react-dom/client';import {useState} from 'react';import {RfqActions} from '@/app/rfqs/rfq-actions';
function App(){const [status,setStatus]=useState('sent');window.__setStatus=setStatus;return <RfqActions rfqId="11111111-1111-4111-8111-111111111111" rfqCode="RFQ-TEST" subject="Original RFQ" body="Original request" supplier="Test Supplier" recipient="sales@example.test" status={status} createdAt="2026-10-26T08:00:00Z" sentAt="2026-10-26T08:01:00Z" conversation={[{id:'mail',direction:'outgoing',subject:'Original RFQ',body:'Original supplier request preserved',created_at:'2026-10-26T08:01:00Z',sent_at:'2026-10-26T08:01:00Z'}]}/>;}createRoot(document.getElementById('root')).render(<App/>);`);
(async()=>{
 await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(dir,'entry.tsx'),output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'next/navigation':path.join(dir,'navigation.js'),'./actions':path.join(dir,'actions.js'),'@/app/notifications/actions':path.join(dir,'actions.js'),'sonner':path.join(dir,'toast.js'),'@':path.join(root,'src')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(dir,'loader.cjs')}]}});compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors())reject(err||Error(stats.toString({all:false,errors:true})));else resolve();});});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
   const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
   page.on('pageerror',err=>errors.push(err.message));
   await page.setContent('<!doctype html><html><body><main style="padding:30px"><div id="root"></div></main></body></html>');
   await page.addStyleTag({content:fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8')});
   await page.addScriptTag({path:path.join(dir,'bundle.js')});
   await page.getByRole('button',{name:'Cancel RFQ-TEST',exact:true}).click();
   const dialog=page.getByRole('dialog'),confirm=dialog.getByRole('button',{name:'Cancel RFQ',exact:true});
   assert.match(await dialog.innerText(),/linked email history remain available/);
   assert.match(await dialog.innerText(),/does not recall/);
   assert.equal(await confirm.isDisabled(),true);
   await page.getByLabel('Cancellation reason').fill('Alternative supplier selected');
   await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
   assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   await confirm.click();
   assert.deepEqual(await page.evaluate(()=>window.__cancelled),{id:'11111111-1111-4111-8111-111111111111',reason:'Alternative supplier selected'});
   await page.evaluate(()=>window.__setStatus('cancelled'));
   assert.equal(await page.getByRole('button',{name:'Cancel RFQ-TEST',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Preview RFQ-TEST',exact:true}).click();
   assert.match(await page.getByRole('dialog').innerText(),/Original supplier request preserved/);
   assert.deepEqual(errors,[]);console.log('RFQ history UI passed: reason validation, no-recall wording, mobile layout, cancellation payload, disabled repeat and retained conversation.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
