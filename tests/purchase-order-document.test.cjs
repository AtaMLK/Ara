const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=require('./helpers/load-ts.cjs')(),{extractText}=require('unpdf');
const {renderSupplierOrder}=load('@/lib/quotes/supplier-orders'),{purchaseOrderDocument}=load('@/lib/quotes/purchase-order-document'),{createCommercialPdf}=load('@/lib/quotes/commercial-pdf'),{createQuotePdf,renderQuoteEmail}=load('@/lib/quotes/document');
const {company,group}=require('./helpers/commercial-fixtures.cjs');
test('emails are brief attachment notes and keep full company and order details inside the PDF',()=>{
 const email=renderSupplierOrder(group,company);assert.match(email.body,/ekte/);assert.match(email.body,/teyit/);assert.doesNotMatch(email.body+email.html,/62527506564|552|www\.|HS-421T|175|<table|Teslimat adresi/);
 const q=renderQuoteEmail({reference:'AO-Q1',inquiryReference:'AO',customerName:'Customer',currency:'EUR',date:'16/10/2026',lines:[]},company);assert.match(q.text,/attached/);assert.doesNotMatch(q.text+q.html,/62527506564|552|www\.|<table/);
});
test('purchase order PDF has distinct item rows, source units, KDV, correct totals and dates below its table',async()=>{
 const doc=purchaseOrderDocument(group,'16/10/2026');assert.equal(doc.taxLabel,'KDV');const bytes=await createCommercialPdf(doc,company),{text}=await extractText(bytes.slice(),{mergePages:true});
 for(const expected of ['SATIN ALMA SİPARİŞİ','HS-421T','STRIP-02','ADH-03','150 pcs','2.500 mm','12,5 kg','26.650,00','5.330,00','31.980,00','23/10/2026','30/10/2026','62527506564'])assert.ok(text.includes(expected),expected+' missing');
 assert.ok(text.indexOf('TESLİM KOŞULLARI')>text.indexOf('31.980,00'));assert.doesNotMatch(text,/customer price|markup|9999/i);
 const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPages()[0].node.Resources().get(require('pdf-lib').PDFName.of('XObject')),'Company logo must be embedded');
});
test('tax label follows supplier country rather than email language; foreign tax is TA',async()=>{
 const foreign=purchaseOrderDocument({...group,country:'Germany',language:'tr'},'16/10/2026');assert.equal(foreign.taxLabel,'TA');const {text}=await extractText(await createCommercialPdf(foreign,company),{mergePages:true});assert.match(text,/TA/);assert.doesNotMatch(text,/KDV/);
 assert.equal(purchaseOrderDocument({...group,language:'en'},'16/10/2026').taxLabel,'KDV');
 const noTax=purchaseOrderDocument({...group,country:'Germany',lines:group.lines.map(line=>({...line,taxRate:0,taxMode:'exempt',gross:line.net,taxText:'Exempt'}))},'16/10/2026');assert.equal(noTax.taxLabel,undefined);
 const unknown=purchaseOrderDocument({...group,country:'Germany',lines:[{...group.lines[0],gross:null,taxRate:null,taxMode:'unknown',taxText:''}]},'16/10/2026');assert.equal(unknown.lines[0].total,null,'Never assume missing tax is zero');
});
test('quotation shares the company template while showing customer prices only',async()=>{
 const q={reference:'AO-Q1',inquiryReference:'AO',customerName:'Customer',currency:'EUR',date:'16/10/2026',lines:[{description:'Temperature accelerometer',model:'HS-421T',quantity:150,unit:'pcs',unitPrice:225,total:33750,delivery:'2 weeks'}]};
 const {text}=await extractText(await createQuotePdf(q,company),{mergePages:true});assert.match(text,/QUOTATION/);assert.match(text,/150 pcs/);assert.match(text,/33,750\.00/);assert.match(text,/DELIVERY TERMS/);assert.match(text,/62527506564/);assert.doesNotMatch(text,/175\.00|210\.00|26,250|markup|Test Supplier/);
});
test('long multi-item documents paginate without dropping item rows or dates',async()=>{
 const lines=Array.from({length:28},(_,i)=>({...group.lines[i%3],model:'MODEL-'+String(i).padStart(3,'0'),description:'Detailed product description '.repeat(12)}));
 const bytes=await createCommercialPdf(purchaseOrderDocument({...group,lines},'16/10/2026'),company),result=await extractText(bytes,{mergePages:true});assert.ok(result.totalPages>1);for(let i=0;i<28;i++)assert.ok(result.text.includes('MODEL-'+String(i).padStart(3,'0')));
});
module.exports={company,group};
