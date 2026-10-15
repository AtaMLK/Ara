// Read-only preparation of a customer-safe PDF for visual QA. Never sends email.
const fs=require('node:fs'),path=require('node:path');
require('@next/env').loadEnvConfig(process.cwd());
const load=require('./helpers/load-ts.cjs')();
(async()=>{
 const {document,unconfirmed}=await load('@/lib/quotes/load-document').loadQuoteDocument('8359c144-ae57-45ee-bcdd-ba020fc58c78');
 if(unconfirmed)throw Error('Customer prices are not confirmed.');
 const company=await load('@/lib/quotes/company').getQuoteCompany();
 const {createQuotePdf,renderQuoteEmail}=load('@/lib/quotes/document');
 const bytes=await createQuotePdf(document,company),dir=path.resolve('output/pdf');fs.mkdirSync(dir,{recursive:true});
 const filename='Quotation-'+document.reference;fs.writeFileSync(path.join(dir,filename+'.pdf'),bytes);
 const {html}=renderQuoteEmail(document,company);fs.writeFileSync(path.join(dir,filename+'.html'),company.logo?html.replace('cid:quote-company-logo','data:'+company.logoType+';base64,'+Buffer.from(company.logo).toString('base64')):html);
 const {renderPageAsImage,getMeta}=require('unpdf');
 const png=await renderPageAsImage(bytes,1,{scale:1.5,canvasImport:()=>import('@napi-rs/canvas')});
 fs.writeFileSync(path.join(dir,filename+'.png'),Buffer.from(png));
 console.log('Generated and rendered '+filename);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
