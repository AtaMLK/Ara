// Synthetic three-item examples for layout QA. No database writes or emails.
const fs=require('node:fs'),path=require('node:path');
const load=require('./helpers/load-ts.cjs')(),{renderPageAsImage,getMeta}=require('unpdf');
const {company,group}=require('./helpers/commercial-fixtures.cjs');
(async()=>{
 const dir=path.resolve('output/pdf');fs.mkdirSync(dir,{recursive:true});
 const profile={...company,address:'İKİTELLİ OSB MAH. ESENLER SAN.SİT. ORTAKLAR İŞ MRK. B BLOK NO:81 BAŞAKŞEHİR/İST.',taxDetails:'VAT BRANCH: IKITELLI | VAT No: 62527506564'};
 const order={...group,supplierName:'Sample Supplier',reference:'AO-20261016-DEMO-Q1-PO1'};
 const po=await load('@/lib/quotes/commercial-pdf').createCommercialPdf(load('@/lib/quotes/purchase-order-document').purchaseOrderDocument(order,'16/10/2026'),profile);
 const quote={reference:'AO-20261016-DEMO-Q1',inquiryReference:'AO-20261016-DEMO',customerName:'Sample Customer',currency:'EUR',date:'16/10/2026',validUntil:'30/10/2026',lines:group.lines.map((line,i)=>({...line,delivery:['2 weeks','3 weeks','In stock'][i],unitPrice:[225,0.2,12][i],total:[33750,500,150][i]}))};
 const q=await load('@/lib/quotes/document').createQuotePdf(quote,profile);
 for(const [name,bytes] of [['Purchase-Order-Template',po],['Quotation-Template',q]]){
  fs.writeFileSync(path.join(dir,name+'.pdf'),bytes);
  const png=await renderPageAsImage(bytes.slice(),1,{scale:1.5,canvasImport:()=>import('@napi-rs/canvas')});fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(png));
  console.log('Created and rendered '+name);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
