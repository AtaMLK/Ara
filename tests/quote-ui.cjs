// Isolated browser verification of the real review component. Server actions are
// mocked; this never signs in, changes production records or sends an email.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {webpack}=require('next/dist/compiled/webpack/webpack');
const {chromium}=require('@playwright/test');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-results','quote-ui');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'loader.cjs'),`const swc=require(${JSON.stringify(require.resolve('next/dist/build/swc'))});module.exports=function(source){return swc.transformSync(source,{filename:this.resourcePath,jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2020'},module:{type:'es6'}}).code;}`);
fs.writeFileSync(path.join(dir,'actions.js'),`export async function saveQuoteCommercialAction(input){window.__saved=input;} export async function setDraftCurrencyAction(){} export async function selectQuoteOfferAction(id){window.__selected=id;}`);
fs.writeFileSync(path.join(dir,'navigation.js'),`export function useRouter(){return {refresh(){}}}`);
fs.writeFileSync(path.join(dir,'entry.tsx'),`import {createRoot} from 'react-dom/client';
import {QuoteWorkbench} from '@/app/quotes/[id]/quote-workbench';
import {supplierCommercial} from '@/lib/quotes/commercial';
const items=[{id:'11111111-1111-4111-8111-111111111111',product_id:null,supplier_quote_id:'22222222-2222-4222-8222-222222222222',quantity:150,unit_price:null,total:null,supplier_cost:175,supplier_currency:'EUR',price_status:'suggested',price_calculation:{product_label:'HS-421T · Dual-output accelerometer',commercial:supplierCommercial({netPrice:175,taxText:'Birim fiyat 175 Eur+Kdv',leadTimeText:'Termin tarihi iki hafta'}),payment_terms:'Bank transfer'}}];
createRoot(document.getElementById('root')).render(<QuoteWorkbench items={items} currency="EUR" editable quoteId="33333333-3333-4333-8333-333333333333" reference="DRAFT-REVIEW-001" rates={[]}/>);`);

(async()=>{
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(dir,'entry.tsx'),output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':path.join(root,'src'),'next/navigation':path.join(dir,'navigation.js'),'../quote-editor-actions':path.join(dir,'actions.js')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(dir,'loader.cjs')}]}});compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<!doctype html><html><body><main style="padding:30px"><div id="root"></div></main></body></html>');
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8')});
    await page.addScriptTag({path:path.join(dir,'bundle.js')});
    await page.getByRole('button',{name:'Review & price pre-quote'}).click();
    await page.getByRole('dialog').waitFor({state:'visible'});
    assert.match(await page.getByRole('dialog').innerText(),/rate is missing/);
    assert.equal(await page.getByRole('button',{name:'Confirm line & price'}).isDisabled(),true);
    assert.equal(await page.getByLabel('Minimum',{exact:true}).inputValue(),'2');
    await page.getByLabel('Tax / KDV %',{exact:true}).fill('20');
    await page.getByLabel('Markup base').selectOption('gross');
    await page.getByLabel('Markup %',{exact:true}).fill('10');
    await page.getByLabel('Delivery charge · EUR',{exact:true}).fill('150');
    assert.match(await page.getByRole('dialog').innerText(),/232\.00 EUR/);
    await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'Confirm line & price'}).click();
    const saved=await page.evaluate(()=>window.__saved);
    assert.equal(saved.taxRate,20);assert.equal(saved.markupPercent,10);assert.equal(saved.deliveryCost,150);assert.equal(saved.confirm,true);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Dialog should not overflow horizontally');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').isVisible(),false);
    assert.deepEqual(errors,[]);console.log('Quote UI passed: modal, tax + markup preview, delivery, confirmation payload, mobile layout, Escape.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
