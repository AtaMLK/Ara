const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-ts.cjs')();
const {inquiryItems,readableRequest}=load('@/lib/ui/inquiry-items');
const {inquiryProgress}=load('@/lib/ui/inquiry-progress');
const {createQuotePdf,renderQuoteEmail,quotationSubject}=load('@/lib/quotes/document');
const {extractText}=require('unpdf');

test('customer acceptance waits for supplier orders before procurement is complete',()=>{
 const facts={status:'converted',aiComplete:true,researchComplete:true,verified:true,rfqSent:true,responseReceived:true,clarificationPending:false,quoteStatuses:['accepted']};
 const pending=inquiryProgress(facts);assert.equal(pending.label,'Supplier Orders');assert.equal(pending.steps.find(step=>step.state==='current').key,'orders');
 assert.equal(pending.steps.find(step=>step.key==='completed').state,'upcoming');
 const completed=inquiryProgress({...facts,supplierOrdersComplete:true});assert.equal(completed.label,'Completed');assert.ok(completed.steps.every(step=>step.state==='completed'));
});
test('AO references preserve date, unique inquiry suffix and revision rules',()=>{
 const {getInquiryDisplayReference,getQuoteReference}=load('@/lib/ui/inquiry-reference');
 const ref=getInquiryDisplayReference('CUS-CEB773DE-20261010-73857C','ATA MOLKARA','2026-10-10T10:00:00Z',2,'2026-10-12T10:00:00Z');
 assert.equal(ref,'AO-20261010-73857C · R1 · +2d');
 assert.equal(getQuoteReference(ref,1,1),'AO-20261010-73857C-Q1-R1');
 assert.equal(getInquiryDisplayReference('AO-20261010-73857C'), 'AO-20261010-73857C');
});
const doc={reference:'AM-20261010-Q1',inquiryReference:'AM-20261010',customerName:'ATA MOLKARA',currency:'EUR',date:'15/10/2026',validUntil:'2026-10-29',
 message:'Dear ATA MOLKARA,\n\nPlease find our quotation regarding inquiry CUS-OLD.\n\nRegards,\nPurchase Department',
 lines:[{description:'Dual-output accelerometer with temperature output',model:'HS-421T',brand:'handsfor',delivery:'1–2 weeks after order confirmation',quantity:150,unitPrice:225,total:33750}]};
const company={name:'Arya Automation',email:'purchase-dep@aryaautomation.com',address:'İKİTELLİ OSB MAH. BAŞAKŞEHİR/İST.',taxDetails:'VAT No: 62527506564'};

test('validated item fields are scoped, explicit quantities and Admin edits take precedence',()=>{
 const result=inquiryItems({submitted_items:[{quantity:150}],intake:{items:[{product:'Dual-output accelerometer with temperature output',model:'HS-421T',quantity:15,brand:'handsfor'}]}},[{type:'quantity',value:'15 pcs',source_ref:'intake:item:0'},{type:'product',value:'Dual-output accelerometer with',source_ref:'intake:item:0'}]);
 assert.equal(result[0].quantity,'150');assert.match(result[0].description,/temperature output/);assert.equal(result[0].brand,'handsfor');
 const edited=inquiryItems({intake:{items:[{product:'Original',quantity:150}]}},[{type:'product',value:'Admin corrected product',source_ref:'intake:item:0',admin_edited:true},{type:'quantity',value:'200 pcs',source_ref:'intake:item:0',admin_edited:true}]);
 assert.equal(edited[0].description,'Admin corrected product');assert.equal(edited[0].quantity,'200 pcs');
 assert.equal(readableRequest('Item 1\\\\nDescription: HS-421T\\nQuantity: 150'),'Item 1\nDescription: HS-421T\nQuantity: 150');
});
test('sent quote overrides stale RFQ status and exposes exactly one current stage',()=>{
 const p=inquiryProgress({status:'rfq',aiComplete:false,researchComplete:false,verified:false,rfqSent:true,responseReceived:true,clarificationPending:false,quoteStatuses:['sent']});
 assert.equal(p.label,'Awaiting Customer Decision');assert.equal(p.steps.filter(s=>s.state==='current').length,1);assert.equal(p.steps.find(s=>s.key==='quotation').state,'completed');assert.equal(p.steps.find(s=>s.key==='decision').state,'current');
});
test('quotation email is a short attachment note without company details or line tables',()=>{
 const {html,text}=renderQuoteEmail(doc,company);
 assert.equal((text.match(/Dear ATA MOLKARA/g)||[]).length,1);assert.equal((text.match(/Purchase Department/g)||[]).length,1);
 assert.match(html,/attached our quotation/);assert.doesNotMatch(html,/<table|HS-421T|Dual-output accelerometer|62527506564|Quoted item|CUS-OLD|localhost/);
 assert.match(quotationSubject(doc.reference,'HS-421T'),/^Quotation AM-20261010-Q1 \| HS-421T$/);
});
test('PDF has readable item/model, delivery, customer prices and no supplier cost',async()=>{
 const bytes=await createQuotePdf(doc,company),text=await extractText(bytes,{mergePages:true});
 assert.match(text.text,/AM-20261010-Q1/);assert.match(text.text,/HS-421T/);assert.match(text.text,/DELIVERY/);assert.match(text.text,/33,750\.00/);assert.doesNotMatch(text.text,/supplier cost|markup|175\.00/i);
 assert.match(text.text,/İKİTELLİ/);assert.match(text.text,/BAŞAKŞEHİR/);assert.match(text.text,/62527506564/);
});
