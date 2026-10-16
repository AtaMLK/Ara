const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');

test('supplier correspondence keeps its language until a clear unquoted reply changes it',async()=>{
 const f=fixture(),supplierId=randomUUID();f.tables.suppliers=[{id:supplierId,primary_country:'Turkey'}];
 const language=f.load('@/lib/email/supplier-language');
 assert.equal(await language.getSupplierLanguage(supplierId),'tr');
 f.tables.suppliers[0].primary_country='Germany';assert.equal(await language.getSupplierLanguage(supplierId),'tr');
 await language.recordSupplierReplyLanguage(supplierId,'OK\n> Hello please confirm the delivery');assert.equal(await language.getSupplierLanguage(supplierId),'tr');
 await language.recordSupplierReplyLanguage(supplierId,'Hello, please confirm the required quantity.');assert.equal(await language.getSupplierLanguage(supplierId),'en');
 await language.recordSupplierReplyLanguage(supplierId,'Merhaba, teslim süresi ve fiyat bilgisi rica ederiz.\nOn Tuesday wrote:\nHello please confirm.');assert.equal(await language.getSupplierLanguage(supplierId),'tr');
 const {renderSupplierOrder}=f.load('@/lib/quotes/supplier-orders');
 const order=renderSupplierOrder({supplierId,supplierName:'Tedarikçi',recipient:'sales@example.test',reference:'AO-TEST-PO1',language:'tr',instructions:'',lines:[]},{name:'Arya',address:'',phone:'',website:'',email:'',taxDetails:''});assert.match(order.subject,/Satın alma siparişi/);assert.match(order.body,/Sipariş kabulünü/);assert.doesNotMatch(order.body,/Dear|Purchase order|Please supply/);
});

test('missing details are requested privately and a clear new customer specification continues automatically in Turkish',async()=>{
 const {f,supplierId,rfqId}=supplierReplyFixture(),sent=[],customerId=randomUUID(),userId=randomUUID(),requirementId=randomUUID();
 Object.assign(f.tables.inquiries[0],{customers:{id:customerId,user_id:userId,email:'customer@example.test',name:'Customer'},original_customer_text:'Please quote Sensor A'});
 f.tables.suppliers[0].communication_language='tr';
 f.tables.requirements=[{id:requirementId,inquiry_id:f.inquiryId,type:'product',value:'Sensor A',source_ref:'intake:item:0',status:'confirmed'}];
 f.tables.rfq_items=[{rfq_id:rfqId,requirement_id:requirementId}];
 f.mock('@/lib/ai/workflow',{continueInquiryWorkflow:async()=>({outcome:'continued'})});
 f.mock('@/lib/email/provider',{getEmailProvider:()=>({send:async input=>{sent.push(input);return {providerMessageId:'mock-'+sent.length,sentAt:new Date().toISOString()};}})});
 f.mock('@/lib/ai/agent-runner',{runAgent:async(ctx,input,schema)=>({output:schema.parse(input.customer_answer?{decision:'auto_send',answerValid:true,supplierReply:'Gerekli besleme gerilimi 24 V DC olarak belirtilmiştir.',summary:'Customer supplied voltage',reason:'Explicit customer specification',confidence:1}:{hasActionableInformation:false,summary:'Voltage required',supplierIntent:'clarification',customerActionRequired:true,missingFields:['voltage'],customerQuestion:'Supplier Company info@supplier.example requires 24V, EUR 100 confidential discount',confidence:1})})});
 const inbound=f.load('@/lib/email/inbound');
 const email={providerMessageId:'missing-voltage',from:'info@supplier.example',to:['purchase@example.test'],subject:'Re: RFQ-20261014-ABCDEF',text:'Merhaba, teknik bilgi rica ederiz. Çalışma voltajı nedir?',provider:'test'};
 await inbound.processInboundEmail(email);assert.equal(sent.length,1);assert.deepEqual(sent[0].to,['customer@example.test']);
 assert.match(sent[0].text,/operating voltage/);assert.match(sent[0].text,/Sensor A/);assert.doesNotMatch(sent[0].subject+sent[0].html,/Supplier Company|supplier\.example|EUR|100|discount|RFQ-20261014/i);
 await inbound.processInboundEmail(email);assert.equal(sent.length,1);
 f.unmock('@/lib/ai/clarification-replies');
 f.tables.customers=[{id:customerId,user_id:userId,email:'customer@example.test',name:'Customer',status:'active'}];
 f.tables.inquiries[0].customer_id=customerId;
 const otherClarification={id:randomUUID(),inquiry_id:f.inquiryId,status:'sent',question:'Another question'};
 f.tables.clarifications.push(otherClarification);f.tables.communications.push({id:randomUUID(),customer_id:customerId,inquiry_id:f.inquiryId,direction:'outgoing',channel:'email',subject:'Additional requirement details - '+f.tables.inquiries[0].reference+' - C'+otherClarification.id.slice(0,8).toUpperCase(),metadata:{type:'supplier_clarification_to_customer',clarification_id:otherClarification.id}});
 const matched=await f.load('@/lib/ai/clarification-replies').findCustomerClarificationForEmail({sender:'customer@example.test',subject:'Re: Re: '+sent[0].subject});
 assert.equal(matched.matched,true);assert.equal(matched.clarification.id,f.tables.clarifications[0].id,'Email reply must choose its own clarification when several are pending');
 const clarification=f.tables.clarifications[0];
 const db=f.load('@/lib/supabase/admin').createSupabaseAdminClient();
 const customerInbound=require('./helpers/load-ts.cjs')({'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/ai/clarification-replies':f.load('@/lib/ai/clarification-replies'),'@/lib/ai/workflow':{continueInquiryWorkflow:async()=>({})},'@/lib/email/customer-inquiry':{ingestCustomerInquiryEmail:async()=>{throw Error('Reply must not become a new inquiry');}}});
 const answered=await customerInbound('@/lib/email/inbound').processInboundEmail({providerMessageId:'customer-voltage-answer',provider:'test',from:'customer@example.test',to:['purchase@example.test'],subject:'Re: '+sent[0].subject,text:'24 V DC'});
 assert.equal(answered.type,'customer_clarification');assert.equal(answered.answered,true);
 assert.equal(sent.length,2);assert.deepEqual(sent[1].to,['info@supplier.example']);assert.match(sent[1].text,/Merhaba|24 V DC/);assert.doesNotMatch(sent[1].text,/Customer|customer@example/);
 assert.equal(f.tables.clarifications[0].status,'answered');assert.ok(f.tables.requirements.some(r=>r.value==='24 V DC'&&r.source_ref==='intake:item:0'));
 await f.load('@/lib/ai/clarification-replies').applyCustomerClarificationAnswer({inquiryId:f.inquiryId,clarificationId:clarification.id,answer:'24 V DC'});assert.equal(sent.length,2);
});

test('already available requirements are sent to the supplier without questioning the customer',async()=>{
 const {f,supplierId}=supplierReplyFixture(),sent=[];f.tables.suppliers[0].communication_language='en';
 f.tables.requirements=[{inquiry_id:f.inquiryId,type:'specification',value:'24 V DC',status:'confirmed'}];
 f.mock('@/lib/ai/workflow',{continueInquiryWorkflow:async()=>({})});
 f.mock('@/lib/email/provider',{getEmailProvider:()=>({send:async input=>{sent.push(input);return {providerMessageId:'mock-known',sentAt:new Date().toISOString()};}})});
 f.mock('@/lib/ai/agent-runner',{runAgent:async(ctx,input,schema)=>({output:schema.parse({hasActionableInformation:false,summary:'Known voltage',supplierIntent:'clarification',customerActionRequired:false,adminReviewRequired:false,supplierReplyDraft:'The required operating voltage is 24 V DC.',confidence:1})})});
 await f.load('@/lib/email/inbound').processInboundEmail({providerMessageId:'known-voltage',provider:'test',from:'info@supplier.example',to:['purchase@example.test'],subject:'Re: RFQ-20261014-ABCDEF',text:'Hello, please provide technical information about the operating voltage.'});
 assert.equal(sent.length,1);assert.deepEqual(sent[0].to,['info@supplier.example']);assert.match(sent[0].text,/Hello|24 V DC/);assert.equal((f.tables.clarifications??[]).length,0);
});

test('late replies from three suppliers consolidate into one draft and preserve Admin prices',async()=>{
 const f=fixture(),customerId=randomUUID();
 Object.assign(f.tables.inquiries[0],{status:'rfq',customer_id:customerId,normalized_information:{intake:{items:[{product:'Sensor',model:'S1',quantity:2},{product:'Motor',model:'M1',quantity:3}]}}});
 f.tables.customers=[{id:customerId,name:'Customer'}];
 const requirements=[0,1].map((i)=>({id:randomUUID(),inquiry_id:f.inquiryId,type:'product',value:i?'Motor':'Sensor',status:'confirmed',source_ref:'intake:item:'+i}));f.tables.requirements=requirements;
 f.tables.supplier_responses=[];f.tables.communications=[];
 f.mock('@/lib/ai/agent-runner',{runAgent:async(ctx,input,schema)=>{
  let output;
  if(ctx.agentId==='quote_extraction'){const index=f.tables.supplier_responses.findIndex(r=>r.id===input.supplier_response_id);output={quotes:[{matchStatus:'match',currency:index===1?'USD':'EUR',quantity:index===1?3:2,netPrice:index===1?80:100,taxRate:20,taxMode:'excluded',taxText:'+20% VAT',leadTimeText:'two weeks'}]};}
  else if(ctx.agentId==='comparison')output={comparisons:f.tables.supplier_responses.map((response,i)=>({supplierResponseId:response.id,findings:f.tables.supplier_quotes.filter(q=>q.supplier_response_id===response.id).map(q=>({requirementId:requirements[i===1?1:0].id,supplierQuoteId:q.id,status:'match',evidence:'Scoped supplier offer'}))}))};
  else if(ctx.agentId==='customer_quote')output={lines:[],warnings:[]};else throw Error(ctx.agentId);
  return {output:schema.parse(output),provider:'test',model:'test'};
 }});
 const queue=f.load('@/lib/ai/orchestrator'),workflow=f.load('@/lib/ai/workflow');
 let first;
 for(let i=0;i<3;i++){
  const supplierId=randomUUID(),communicationId=randomUUID();f.tables.communications.push({id:communicationId,inquiry_id:f.inquiryId,supplier_id:supplierId,body:'Supplier offer'});
  f.tables.supplier_responses.push({id:randomUUID(),communication_id:communicationId,supplier_id:supplierId,inquiry_id:f.inquiryId,status:'received'});
  await queue.enqueueSupplierQuoteExtraction(f.inquiryId);const result=await workflow.processQueuedWorkflow(5,f.inquiryId);
  assert.ok(!result.results.some(row=>row.error),JSON.stringify(result));
  assert.equal(f.tables.customer_quotes.length,1);assert.equal(f.tables.customer_quote_items.length,i+1);
  if(i===0){first=f.tables.customer_quote_items[0];Object.assign(first,{unit_price:222,price_status:'admin_confirmed'});f.tables.customer_quotes[0].status='pending_approval';}
  else {assert.equal(first.unit_price,222);assert.equal(first.price_status,'admin_confirmed');assert.equal(f.tables.customer_quotes[0].status,'draft');}
 }
 assert.deepEqual(f.tables.customer_quote_items.map(line=>line.is_selected),[true,true,false]);
 const db=f.load('@/lib/supabase/admin').createSupabaseAdminClient();
 const load=require('./helpers/load-ts.cjs')({'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}});
 const document=await load('@/lib/quotes/load-document').loadQuoteDocument(f.tables.customer_quotes[0].id);
 assert.equal(document.document.lines.length,2,'Alternative must not appear in customer document');
 assert.equal(f.sendCount(),0);
});

function supplierOrderFixture(){
 const f=fixture(),quoteId=randomUUID(),adminId=randomUUID(),sent=[];
 f.tables.customer_quotes=[{id:quoteId,inquiry_id:f.inquiryId,status:'accepted',reference:'AO-20261016-TEST-Q1'}];
 f.tables.customer_quote_items=[];f.tables.supplier_quotes=[];f.tables.supplier_responses=[];f.tables.suppliers=[];f.tables.rfqs=[];
 for(let i=0;i<3;i++){
  const supplierId=randomUUID(),responseId=randomUUID(),offerId=randomUUID();
  f.tables.suppliers.push({id:supplierId,legal_name:'Supplier '+i,status:'active'});
  f.tables.rfqs.push({id:randomUUID(),supplier_id:supplierId,inquiry_id:f.inquiryId,status:'sent',recipient_email:'sales'+i+'@example.test'});
  f.tables.supplier_responses.push({id:responseId,supplier_id:supplierId,inquiry_id:f.inquiryId});f.tables.supplier_quotes.push({id:offerId,supplier_response_id:responseId});
  f.tables.customer_quote_items.push({id:randomUUID(),customer_quote_id:quoteId,is_selected:true,supplier_quote_id:offerId,description:'Requested item '+i,model:'MODEL-'+i,quantity:i+2,supplier_currency:i===1?'USD':'EUR',supplier_cost:100,unit_price:9999,price_calculation:{commercial:{net:100,gross:120,taxRate:20,taxMode:'excluded',delivery:{original:'two weeks'}},markup_percent:500,payment_terms:'Transfer'}});
 }
 const db=f.load('@/lib/supabase/admin').createSupabaseAdminClient();let denied=false,fail=false;
 const load=require('./helpers/load-ts.cjs')({'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/ai/guards':{requireAdmin:async()=>{if(denied)throw Error('Admin access required');return {supabase:db,user:{id:adminId}};}},'next/cache':{revalidatePath(){}},'@/lib/quotes/company':{getCompanyProfile:async()=>({name:'Arya Automation',address:'Company address',phone:'Phone',website:'Website',taxDetails:'Tax',email:'purchase@example.test'})},'@/lib/email/provider':{getEmailProvider:()=>({send:async input=>{sent.push(input);if(fail)throw Error('SMTP timeout');return {providerMessageId:'mock-'+sent.length,sentAt:new Date().toISOString()};}})}});
 return {f,db,quoteId,sent,load,deny:()=>denied=true,fail:()=>fail=true};
}

test('accepted quote creates separate exact supplier orders with no customer margins; repeated sends are safe',async()=>{
 const x=supplierOrderFixture(),actions=x.load('@/app/quotes/supplier-order-actions'),old=process.env.EMAIL_FROM;process.env.EMAIL_FROM='purchase@example.test';
 try{
  const previews=await actions.prepareSupplierOrdersAction(x.quoteId,'Deliver to our warehouse');assert.equal(previews.length,3);assert.equal(x.sent.length,0);
  for(let i=0;i<3;i++){assert.equal(previews[i].recipient_email,'sales'+i+'@example.test');assert.match(previews[i].body,new RegExp('MODEL-'+i));assert.doesNotMatch(previews[i].body,/9999|markup|500/);for(let j=0;j<3;j++)if(i!==j)assert.doesNotMatch(previews[i].body,new RegExp('MODEL-'+j));}
  await actions.sendSupplierOrderAction(previews[0].id,previews[0].fingerprint);await actions.sendSupplierOrderAction(previews[0].id,previews[0].fingerprint);
  assert.equal(x.sent.length,1);assert.equal(x.sent[0].text,previews[0].body);assert.equal(x.sent[0].html,previews[0].html);assert.equal(x.sent[0].subject,previews[0].subject);assert.equal(x.f.tables.communications.length,1);
  const refreshed=await actions.prepareSupplierOrdersAction(x.quoteId,'Changed instructions');assert.equal(refreshed[0].status,'sent');assert.equal(refreshed[0].body,previews[0].body);
  await assert.rejects(actions.sendSupplierOrderAction(previews[1].id,previews[1].fingerprint),/preview changed/);
  await Promise.allSettled([actions.sendSupplierOrderAction(refreshed[1].id,refreshed[1].fingerprint),actions.sendSupplierOrderAction(refreshed[1].id,refreshed[1].fingerprint)]);assert.equal(x.sent.length,2);
  x.deny();await assert.rejects(actions.prepareSupplierOrdersAction(x.quoteId),/Admin access/);await assert.rejects(actions.sendSupplierOrderAction(refreshed[2].id,refreshed[2].fingerprint),/Admin access/);
 }finally{if(old==null)delete process.env.EMAIL_FROM;else process.env.EMAIL_FROM=old;}
});

test('supplier ordering requires acceptance, valid source and approved contact; SMTP uncertainty cannot resend',async()=>{
 const x=supplierOrderFixture(),actions=x.load('@/app/quotes/supplier-order-actions'),q=x.f.tables.customer_quotes[0],old=process.env.EMAIL_FROM;process.env.EMAIL_FROM='purchase@example.test';
 try{
  q.status='sent';await assert.rejects(actions.prepareSupplierOrdersAction(x.quoteId),/acceptance/);q.status='accepted';
  const source=x.f.tables.customer_quote_items[0].supplier_quote_id;x.f.tables.customer_quote_items[0].supplier_quote_id=null;await assert.rejects(actions.prepareSupplierOrdersAction(x.quoteId),/no supplier source/);x.f.tables.customer_quote_items[0].supplier_quote_id=source;
  x.f.tables.rfqs[0].status='draft';await assert.rejects(actions.prepareSupplierOrdersAction(x.quoteId),/approved RFQ/);x.f.tables.rfqs[0].status='sent';
  const p=await actions.prepareSupplierOrdersAction(x.quoteId);x.fail();await assert.rejects(actions.sendSupplierOrderAction(p[0].id,p[0].fingerprint),/delivery is uncertain/);
  assert.equal(x.f.tables.supplier_order_confirmations[0].status,'delivery_uncertain');await assert.rejects(actions.sendSupplierOrderAction(p[0].id,p[0].fingerprint),/delivery needs checking/);assert.equal(x.sent.length,1);
 }finally{if(old==null)delete process.env.EMAIL_FROM;else process.env.EMAIL_FROM=old;}
});

test('consolidated readiness rejects missing, duplicate or unpriced selected items',()=>{
 const {quoteCoverage}=require('./helpers/load-ts.cjs')()('@/lib/quotes/readiness');
 const requested=[{sourceRef:'a',label:'Sensor',quantity:'2'},{sourceRef:'b',label:'Motor',quantity:'3'}];
 const offer=ref=>({is_selected:true,price_status:'admin_confirmed',unit_price:10,price_calculation:{source_ref:ref}});
 assert.match(quoteCoverage(requested,[offer('a')]).problems.join(' '),/Motor/);
 assert.match(quoteCoverage(requested,[offer('a'),offer('a'),offer('b')]).problems.join(' '),/only one/);
 assert.equal(quoteCoverage(requested,[offer('a'),offer('b'),{...offer('a'),is_selected:false,unit_price:null}]).problems.length,0);
 assert.match(quoteCoverage(requested,[offer('a'),{...offer('b'),unit_price:null}]).problems.join(' '),/Confirm/);
});

test('customer revision reasons use an owned quote and server-only mutation',async()=>{
 for(const reason of ['price','quantity','delivery_time','product_specification','payment_terms','other']) {
  const f=fixture(),customerId=randomUUID(),quoteId=randomUUID(),userId=randomUUID();
  f.tables.customer_quotes=[{id:quoteId,inquiry_id:f.inquiryId,customer_id:customerId,status:'sent',reference:'AO-20261015-QA-Q1'}];
  const db=f.load('@/lib/supabase/admin').createSupabaseAdminClient();
  const session={from:table=>{const q=db.from(table);q.insert=q.update=()=>{throw Error('Customer table mutations must not be used');};return q;}};
  const load=require('./helpers/load-ts.cjs')({'@/lib/ai/guards':{requireCustomerAccess:async()=>({supabase:session,user:{id:userId},customer:{id:customerId}})},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/ai/workflow':{},'@/lib/ai/clarification-replies':{},'next/cache':{revalidatePath(){}}});
  await load('@/app/actions').requestCustomerQuoteRevisionAction({quoteId,reason,freeText:'Please revise'});
  assert.equal(f.tables.customer_quotes[0].status,'revision_requested');
  assert.equal(f.tables.quote_revision_requests.length,1);assert.equal(f.tables.quote_revision_requests[0].requested_by,userId);
  assert.equal(f.tables.quote_revision_requests[0].reason,reason);
  await assert.rejects(load('@/app/actions').requestCustomerQuoteRevisionAction({quoteId,reason}),/Only a sent/);
  assert.equal(f.tables.quote_revision_requests.length,1);
 }
});

test('customer acceptance uses an owned quote and server-only decision update; retries are safe',async()=>{
  const f=fixture(),customerId=randomUUID(),quoteId=randomUUID();
  Object.assign(f.tables.inquiries[0],{customer_id:customerId,status:'quoting'});
  f.tables.customer_quotes=[{id:quoteId,inquiry_id:f.inquiryId,customer_id:customerId,status:'sent',reference:'AO-20261010-73857C-Q1'}];
  const db=f.load('@/lib/supabase/admin').createSupabaseAdminClient();
  let sessionWrites=0,denyAuth=false;
  const session={from:table=>{const q=db.from(table);q.update=()=>{sessionWrites++;throw Error('RLS disallows session updates');};return q;}};
  const load=require('./helpers/load-ts.cjs')({'@/lib/ai/guards':{requireCustomerAccess:async()=>{if(denyAuth)throw Error('Authentication required');return {supabase:session,user:{id:randomUUID()},customer:{id:customerId}};}},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/ai/workflow':{},'@/lib/ai/clarification-replies':{},'next/cache':{revalidatePath(){}}});
  f.tables.profiles=[{user_id:randomUUID(),role:'admin',status:'active'}];
  const actions=load('@/app/actions');
  await actions.acceptCustomerQuoteAction(quoteId);
  assert.equal(f.tables.customer_quotes[0].status,'accepted');assert.equal(sessionWrites,0);assert.equal(f.tables.inquiries[0].status,'converted');
  assert.equal(f.tables.timeline_events.filter(e=>e.event_type==='customer_quote_accepted').length,1);
  await actions.acceptCustomerQuoteAction(quoteId);
  assert.equal(f.tables.timeline_events.filter(e=>e.event_type==='customer_quote_accepted').length,1);
  assert.equal(f.tables.notifications.filter(n=>n.record_type==='supplier_order_confirmation'&&n.record_id===quoteId).length,1);
  f.tables.customer_quotes[0].status='sent';f.tables.customer_quotes[0].customer_id=randomUUID();
  await assert.rejects(actions.acceptCustomerQuoteAction(quoteId),/not found/);assert.equal(f.tables.customer_quotes[0].status,'sent');
  denyAuth=true;await assert.rejects(actions.acceptCustomerQuoteAction(quoteId),/Authentication required/);
});

test('Admin-approved quote send attaches a customer-safe PDF and records it without duplicate greetings', async () => {
  const f=fixture(),quoteId=randomUUID(),customerId=randomUUID(),adminId=randomUUID();
  Object.assign(f.tables.inquiries[0],{customer_id:customerId,reference:'TEST-REF',created_at:'2026-10-10T10:00:00Z',current_version:1,status:'rfq'});
  f.tables.customers=[{id:customerId,name:'Test Customer',email:'customer@example.test',user_id:randomUUID()}];
  f.tables.customer_quotes=[{id:quoteId,inquiry_id:f.inquiryId,customer_id:customerId,reference:'TC-20261010-Q1',revision_number:0,status:'pending_approval',currency:'EUR',created_at:'2026-10-15T10:00:00Z',body:'Dear Test Customer,\n\nPlease find our quotation below.\n\nRegards,\nPurchase Department'}];
  f.tables.customer_quote_items=[{id:randomUUID(),customer_quote_id:quoteId,description:'Temperature sensor',model:'HS-421T',brand:'Customer brand',delivery_text:'2 weeks',quantity:150,unit_price:225,total:33750,price_status:'admin_confirmed',price_calculation:{commercial:{net:175},markup_percent:20}}];
  const db=f.load('@/lib/supabase/admin').createSupabaseAdminClient(),uploads=[],sent=[];
  db.storage={from:()=>({upload:async(...args)=>{uploads.push(args);return {error:null};}})};
  const load=require('./helpers/load-ts.cjs')({'@/lib/ai/guards':{requireAdmin:async()=>({user:{id:adminId},supabase:db})},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/ai/workflow':{},'@/lib/ai/clarification-replies':{},'next/cache':{revalidatePath(){}},'@/lib/email/provider':{getEmailProvider:()=>({send:async value=>{sent.push(value);return {providerMessageId:'test-only-message',sentAt:'2026-10-15T11:00:00Z'};}})}});
  const oldUrl=process.env.NEXT_PUBLIC_APP_URL,oldFrom=process.env.EMAIL_FROM;
  process.env.NEXT_PUBLIC_APP_URL='http://localhost:3000';process.env.EMAIL_FROM='purchase@example.test';
  try{
    await load('@/app/actions').approveCustomerQuoteAction(quoteId);
    assert.equal(sent.length,1);assert.equal(uploads.length,1);
    assert.match(sent[0].subject,/TC-20261010-Q1/);assert.match(sent[0].html,/>Delivery<\/th>/);
    assert.equal((sent[0].text.match(/Dear Test Customer/g)||[]).length,1);
    assert.equal((sent[0].text.match(/Purchase Department/g)||[]).length,1);
    assert.doesNotMatch(sent[0].text,/175|markup|localhost/);
    assert.equal(sent[0].generatedAttachments[0].mimeType,'application/pdf');
    assert.ok(sent[0].generatedAttachments[0].content.byteLength>1000);
    assert.equal(f.tables.customer_quotes[0].status,'sent');assert.equal(f.tables.inquiries[0].status,'quoting');
    assert.ok(f.tables.communications[0].metadata.quotation_pdf_path.startsWith('customer-quotes/'+quoteId+'/'));
    await assert.rejects(load('@/app/actions').approveCustomerQuoteAction(quoteId),/not awaiting approval/);
    assert.equal(sent.length,1);
  }finally{
    if(oldUrl==null)delete process.env.NEXT_PUBLIC_APP_URL;else process.env.NEXT_PUBLIC_APP_URL=oldUrl;
    if(oldFrom==null)delete process.env.EMAIL_FROM;else process.env.EMAIL_FROM=oldFrom;
  }
});

test('delivery normalization preserves ranges and word/number units in English and Turkish', () => {
  const {parseDelivery}=fixture().load('@/lib/quotes/commercial');
  for(const [text,min,max,unit,business] of [
    ['two to three weeks after order',2,3,'weeks',false],
    ['10–15 working days',10,15,'days',true],
    ['iki ila üç iş günü',2,3,'days',true],
    ['twenty-one days',21,21,'days',false],
    ['on beş gün',15,15,'days',false],
    ['one hundred and five days',105,105,'days',false],
    ['in stock',0,0,'stock',false],
  ]) { const actual=parseDelivery(text); assert.deepEqual([actual.min,actual.max,actual.unit,actual.businessDays],[min,max,unit,business],text); assert.equal(actual.original,text); }
  assert.equal(parseDelivery('Delivery to be confirmed').unit,'unknown');
  assert.equal(parseDelivery('Not in stock; lead time two weeks').unit,'weeks');
  assert.equal(parseDelivery('stokta yok; termin 2 hafta').unit,'weeks');
});

test('tax calculations use explicit KDV/VAT rates and never guess missing tax', () => {
  const {supplierCommercial,reviewSupplierTax}=fixture().load('@/lib/quotes/commercial');
  for(const taxText of ['+ %20 KDV','+ 20% VAT','+ KDV %20']) {
    const c=supplierCommercial({netPrice:100,taxText,leadTimeText:'2 weeks'});
    assert.equal(c.taxRate,20,taxText); assert.equal(c.gross,120); assert.equal(c.taxAmount,20);
  }
  const missing=supplierCommercial({netPrice:100,taxText:'+ KDV'});
  assert.equal(missing.taxMode,'excluded'); assert.equal(missing.taxRate,null); assert.equal(missing.gross,null);
  const included=supplierCommercial({grossPrice:120,taxRate:20,taxMode:'included'});
  assert.equal(included.net,100); assert.equal(included.gross,120);
  assert.equal(supplierCommercial({netPrice:100,taxMode:'exempt'}).gross,100);
  assert.ok(supplierCommercial({netPrice:100,grossPrice:150,taxRate:20}).warnings.some(w=>w.includes('conflict')));
  const source=supplierCommercial({netPrice:100,taxRate:20,taxMode:'excluded'});
  assert.equal(reviewSupplierTax(source,'included',20).gross,100);
  assert.equal(reviewSupplierTax(source,'excluded',10).gross,110);
});

test('markup preview allocates delivery, converts with provided rate and applies rounding', () => {
  const {pricePreview,supplierCommercial}=fixture().load('@/lib/quotes/commercial');
  const c=supplierCommercial({netPrice:100,taxRate:20,taxMode:'excluded'});
  const controls={quantity:2,basis:'gross',markupPercent:10,deliveryCost:20,deliveryAllocation:'per_line',markupOn:'goods',rounding:0,exchangeRate:1};
  assert.equal(pricePreview(c,controls).unitPrice,142);
  assert.equal(pricePreview(c,{...controls,markupOn:'landed'}).unitPrice,143);
  assert.equal(pricePreview(c,{...controls,basis:'net',exchangeRate:2,rounding:5}).unitPrice,230);
  assert.equal(pricePreview(c,{...controls,markupPercent:null}),null);
  assert.equal(pricePreview(c,{...controls,exchangeRate:null}),null);
});

test('Admin confirms formula prices on the server and editable saves remove confirmation', async () => {
  const f=fixture(),itemId=randomUUID(),quoteId=randomUUID();
  const {supplierCommercial}=f.load('@/lib/quotes/commercial');
  f.tables.customer_quotes=[{id:quoteId,status:'draft',currency:'EUR'}];
  f.tables.customer_quote_items=[{id:itemId,customer_quote_id:quoteId,quantity:2,unit_price:null,price_status:'suggested',supplier_currency:'EUR',supplier_cost:100,price_calculation:{commercial:supplierCommercial({netPrice:100,taxRate:20,taxMode:'excluded',leadTimeText:'two weeks'})}}];
  const actions=f.load('@/app/quotes/quote-editor-actions');
  await assert.rejects(f.load('@/lib/ai/tools/customer-quotes').requestQuoteApproval(quoteId),/confirmed by Admin/);
  const input={itemId,quantity:2,basis:'gross',markupPercent:10,deliveryCost:20,deliveryAllocation:'per_line',markupOn:'goods',rounding:0,exchangeRateId:null,taxMode:'excluded',taxRate:20,deliveryMin:2,deliveryMax:3,deliveryUnit:'weeks',businessDays:false,deliveryNote:'after order confirmation',priceMode:'formula',manualPrice:null,confirm:true};
  await actions.saveQuoteCommercialAction(input);
  assert.equal(f.tables.customer_quote_items[0].unit_price,142);
  assert.equal(f.tables.customer_quote_items[0].price_status,'admin_confirmed');
  assert.match(f.tables.customer_quote_items[0].price_calculation.customer_delivery,/2–3 weeks/);
  await actions.saveQuoteCommercialAction({...input,confirm:false,markupPercent:null});
  assert.equal(f.tables.customer_quote_items[0].unit_price,null);
  assert.equal(f.tables.customer_quote_items[0].price_status,'suggested');
  await assert.rejects(actions.saveQuoteCommercialAction({...input,markupPercent:null}),/Enter a customer price/);
  f.tables.customer_quote_items[0].supplier_currency='USD';
  await assert.rejects(actions.saveQuoteCommercialAction(input),/approved exchange rate/);
  f.tables.customer_quote_items[0].supplier_currency='EUR';
  await actions.setDraftCurrencyAction(quoteId,'TRY');
  assert.equal(f.tables.customer_quotes[0].currency,'TRY');
  assert.equal(f.tables.customer_quote_items[0].unit_price,null);
  assert.equal(f.tables.customer_quote_items[0].price_calculation.admin_controls,undefined);
  f.tables.customer_quotes[0].status='sent';
  await assert.rejects(actions.saveQuoteCommercialAction(input),/Only editable/);
  assert.equal(f.sendCount(),0);
});

test('duplicate email polling respects terminal failure while explicit recovery reopens extraction', async () => {
  const f = fixture();
  const queue = f.load('@/lib/ai/orchestrator');
  const execution = await queue.enqueueSupplierQuoteExtraction(f.inquiryId);
  Object.assign(f.tables.ai_executions.find(row => row.id === execution.id), { status: 'failed', attempt_count: 3 });
  const duplicate = await queue.enqueueSupplierQuoteExtraction(f.inquiryId, { retryFailed: false });
  assert.equal(duplicate.status, 'failed');
  assert.equal(duplicate.attempt_count, 3);
  const recovered = await queue.enqueueSupplierQuoteExtraction(f.inquiryId);
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.attempt_count, 0);
});

test('AI provider supplies the actual contract and repairs nullable/malformed quote output once', async () => {
  const f = fixture();
  const { quoteExtractionOutputSchema } = f.load('@/lib/ai/agent-schemas');
  const { getAIProvider } = f.load('@/lib/ai/provider');
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const output = requests.length === 1
      ? { quotes: [{ productId: null, matchStatus: 'MATCH', quantity: null, availability: null, discountType: null, conditions: ['Payment on delivery'], originalData: null }] }
      : { quotes: [{ matchStatus: 'unknown', conditions: [{ type: 'payment', text: 'Payment on delivery' }], uncertainties: ['Product identity and quantity not stated'] }] };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
  };
  try {
    const result = await getAIProvider().generate([{ role: 'user', content: 'Payment on delivery; no product or quantity stated.' }], quoteExtractionOutputSchema);
    assert.equal(requests.length, 2);
    const contractMessage = requests[0].messages.find(message => message.content.includes('JSON Schema:'));
    assert.ok(contractMessage.content.includes('partial_match'));
    assert.ok(contractMessage.content.includes('hasActionableInformation') === false);
    assert.ok(contractMessage.content.includes('discountType'));
    assert.ok(requests[1].messages.at(-1).content.includes('validation_errors'));
    assert.equal(result.output.quotes[0].productId, undefined);
    assert.equal(result.output.quotes[0].quantity, undefined);
    assert.equal(result.output.quotes[0].netPrice, undefined);
    assert.equal(result.output.quotes[0].conditions[0].text, 'Payment on delivery');
  } finally { global.fetch = originalFetch; }
});

test('AI provider rejects persistently invalid output after one repair attempt', async () => {
  const f = fixture();
  const { supplierEmailAnalysisOutputSchema } = f.load('@/lib/ai/agent-schemas');
  const { getAIProvider } = f.load('@/lib/ai/provider');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'Reply', customerQuestion: null }) } }] }) };
  };
  try {
    await assert.rejects(getAIProvider().generate([{ role: 'user', content: 'Supplier reply' }], supplierEmailAnalysisOutputSchema), /schema validation/);
    assert.equal(calls, 2);
  } finally { global.fetch = originalFetch; }
});

test('received supplier quote advances to an unpriced admin draft without pricing rules', async () => {
  const f = fixture();
  const supplierId = randomUUID(), responseId = randomUUID(), communicationId = randomUUID();
  const customerId = randomUUID(), requirementId = randomUUID();
  Object.assign(f.tables.inquiries[0], { status: 'rfq', customer_id: customerId, reference: 'TEST-1' });
  f.tables.customers = [{ id: customerId, name: 'Test Customer', country: 'France' }];
  f.tables.profiles = [{user_id:randomUUID(),role:'admin',status:'active'}];
  f.tables.requirements = [{ id: requirementId, inquiry_id: f.inquiryId, type: 'product', value: 'Sensor 2 pcs', status: 'confirmed' }];
  f.tables.communications = [{ id: communicationId, inquiry_id: f.inquiryId, supplier_id: supplierId, body: 'Sensor 2 pcs EUR 100 each' }];
  f.tables.supplier_responses = [{ id: responseId, communication_id: communicationId, inquiry_id: f.inquiryId, supplier_id: supplierId, status: 'received' }];
  f.tables.suppliers = [{ id: supplierId, legal_name: 'Test Supplier' }];
  f.mock('@/lib/ai/agent-runner', { runAgent: async (ctx, input, schema) => {
    let output;
    if (ctx.agentId === 'quote_extraction') output = { quotes: [{ matchStatus: 'match', currency: 'EUR', quantity: 2, netPrice: 100, taxRate:20, taxMode:'excluded', taxText:'+ 20% VAT', leadTimeText:'two to three weeks' }] };
    else if (ctx.agentId === 'comparison') output = { comparisons: [{ supplierResponseId: responseId, findings: [{ requirementId, supplierQuoteId: f.tables.supplier_quotes[0].id, status: 'match', evidence: 'Sensor 2 pcs' }] }] };
    else if (ctx.agentId === 'customer_quote') output = { lines: [], warnings:['Offered model identity is unconfirmed; Admin review needed.'] };
    else throw new Error('Unexpected agent: ' + ctx.agentId);
    return { output: schema.parse(output), provider: 'test', model: 'test' };
  } });
  const queue = f.load('@/lib/ai/orchestrator');
  const workflow = f.load('@/lib/ai/workflow');
  await queue.enqueueSupplierQuoteExtraction(f.inquiryId);
  const result = await workflow.processQueuedWorkflow(5, f.inquiryId);
  assert.equal(result.results.some(row => row.error), false, JSON.stringify(result.results));
  assert.deepEqual(result.results.map(row => row.stage), ['quote_extraction', 'comparison', 'customer_quote']);
  assert.equal(f.tables.supplier_responses[0].status, 'processed');
  assert.equal(f.tables.customer_quotes[0].status, 'draft');
  assert.equal(f.tables.customer_quote_items[0].unit_price, null);
  assert.equal(f.tables.customer_quote_items[0].pricing_rule_id, null);
  assert.equal(f.tables.customer_quote_items[0].price_calculation.commercial.gross, 120);
  assert.equal(f.tables.customer_quote_items[0].price_calculation.commercial.delivery.max, 3);
  assert.equal(f.tables.customer_quote_items[0].price_status, 'suggested');
  assert.ok(f.tables.ai_alerts.some(row => row.alert_type === 'CUSTOMER_QUOTE_REVIEW_REQUIRED'));
  assert.equal(f.tables.notifications.length,1);
  assert.equal(f.tables.notifications[0].action_url,'/quotes/'+f.tables.customer_quotes[0].id);
  assert.equal(f.sendCount(), 0);
  await workflow.processQueuedWorkflow(5, f.inquiryId);
  assert.equal(f.tables.customer_quotes.length, 1);
  assert.equal(f.tables.notifications.length,1);
});

// Exercise the real workflow and schemas with an in-memory database and providers.
test('recovery is restricted to failed stages of an active inquiry',async()=>{
 const f=fixture(),id=randomUUID(),other=randomUUID();f.tables.ai_executions=[{id,inquiry_id:f.inquiryId,status:'failed',attempt_count:3,error_message:'Provider down'},{id:other,inquiry_id:f.inquiryId,status:'succeeded'}];
 const action=f.load('@/app/inquiries/[id]/automation-recovery');
 await assert.rejects(action.retryFailedAutomationAction({inquiryId:f.inquiryId,executionId:other}),/Only a failed/);
 await action.retryFailedAutomationAction({inquiryId:f.inquiryId,executionId:id});assert.equal(f.tables.ai_executions[0].status,'queued');assert.equal(f.tables.ai_executions[0].attempt_count,0);assert.equal(f.tables.ai_executions[1].status,'succeeded');
 f.tables.inquiries[0].status='converted';f.tables.ai_executions[0].status='failed';await assert.rejects(action.retryFailedAutomationAction({inquiryId:f.inquiryId,executionId:id}),/not eligible/);
});

test('readable PDF-only requirements advance without inventing customer-text items or requiring OCR',async()=>{
 const f=fixture({unreadable:true});f.tables.inquiries[0].original_customer_text='Please see the attached RFQ.';
 f.mock('@/lib/ai/document-processor',{downloadInquiryFile:async()=>new Uint8Array(),parseInquiryFile:async()=>({extractedText:'Beta BM-200 motor 2 pcs',extractedData:{pages:1},qualityFlags:[]})});
 const baseline=f.load('@/lib/ai/agent-runner');f.mock('@/lib/ai/agent-runner',{runAgent:async(ctx,input,schema)=>{
  if(ctx.agentId==='document')return {output:schema.parse({requirements:[{type:'product',value:'Motor',sourceRef:'item:0'},{type:'model_part_number',value:'BM-200',sourceRef:'item:0'},{type:'quantity',value:'2 pcs',sourceRef:'item:0'}]}),provider:'test',model:'test'};
  if(ctx.agentId==='intake')return {output:schema.parse({items:[]}),provider:'test',model:'test'};
  return baseline.runAgent(ctx,input,schema);
 }});
 await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId,'document');const result=await f.load('@/lib/ai/workflow').processQueuedWorkflow(12,f.inquiryId);
 assert.equal(result.results.some(row=>row.error),false,JSON.stringify(result.results));assert.ok(f.tables.supplier_candidates.length>0,JSON.stringify({stages:result.results,requirements:f.tables.requirements,research:f.tables.research_cases,executions:f.tables.ai_executions.map(x=>({stage:x.task_key,output:x.output_ref}))}));assert.ok(f.tables.requirements.every(row=>row.source==='pdf'));assert.equal(f.sendCount(),0);
});

test('customer email classification accepts forwarded RFQs and leaves acknowledgements/unknown senders unmatched',async()=>{
 const f=fixture(),module=f.load('@/lib/email/customer-inquiry');
 assert.equal(module.looksLikeNewInquiry('Fwd: RFQ sensor','Please quote attached requirements',true),true);
 assert.equal(module.looksLikeNewInquiry('Re: RFQ sensor','Thanks, received',false),false);
 assert.equal(module.looksLikeNewInquiry('Thank you','Received with thanks',false),false);
 const before=f.tables.inquiries.length;assert.equal(await module.ingestCustomerInquiryEmail({provider:'test',providerMessageId:'unknown-customer',from:'unknown@example.test',subject:'RFQ sensor',text:'Please quote HS-421T 150 pcs'}),null);assert.equal(f.tables.inquiries.length,before);
});

test('OCR remains deferred for a scanned PDF even when an AI key is configured',async()=>{
 const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
 const parsed=await require('./helpers/load-ts.cjs')()('@/lib/ai/document-processor').parseInquiryFile(bytes,'application/pdf','scanned.pdf');
 assert.equal(parsed.extractedText,'');assert.ok(parsed.qualityFlags.includes('OCR_PENDING'));
});

test('semi-automatic text + PDF email flow reaches suppliers, reviewed RFQ send, supplier PDF extraction and unpriced quote',async()=>{
 const f=fixture();f.tables.inquiries=[];
 const userId=randomUUID(),customerId=randomUUID();f.tables.customers=[{id:customerId,user_id:userId,email:'buyer@example.test',status:'active'}];f.tables.profiles=[{user_id:userId,role:'customer',status:'active'}];
 const {PDFDocument,StandardFonts}=require('pdf-lib'),pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 pdf.addPage().drawText('Beta BM-200 motor - 2 pcs',{font});const bytes=await pdf.save();
 const actual=require('./helpers/load-ts.cjs')()('@/lib/ai/document-processor');
 const parsed=await actual.parseInquiryFile(new Uint8Array(bytes),'application/pdf','requirements.pdf');assert.match(parsed.extractedText,/BM-200/);
 f.mock('@/lib/ai/document-processor',{downloadInquiryFile:async()=>new Uint8Array(bytes),parseInquiryFile:actual.parseInquiryFile});
 const baseline=f.load('@/lib/ai/agent-runner');let mergedInput,lateAgent;
 f.mock('@/lib/ai/agent-runner',{runAgent:async(ctx,input,schema)=>{if(lateAgent)return lateAgent(ctx,input,schema);if(ctx.agentId==='document')return {output:schema.parse({requirements:[{type:'product',value:'Motor',sourceRef:'item:0'},{type:'model_part_number',value:'BM-200',sourceRef:'item:0'},{type:'quantity',value:'2 pcs',sourceRef:'item:0'}]}),provider:'test',model:'test'};if(ctx.agentId==='intake'){mergedInput=input;return {output:schema.parse({title:'Text and PDF inquiry',items:[{requestedText:'Alpha TS-100 sensor 2 pcs',product:'Temperature sensor',brand:'Alpha',model:'TS-100',quantity:2,unit:'pcs',confidence:1,evidence:'Alpha TS-100 sensor 2 pcs'}]}),provider:'test',model:'test'};}return baseline.runAgent(ctx,input,schema);}});
 const db=f.load('@/lib/supabase/admin').createSupabaseAdminClient();let uploads=0;db.storage={from:()=>({upload:async()=>{uploads++;return {error:null};}})};
 const email={providerMessageId:'customer-text-pdf',messageId:'<customer-text-pdf@example.test>',provider:'test',from:'buyer@example.test',to:['purchase@example.test'],subject:'RFQ temperature sensor',text:'Alpha TS-100 sensor 2 pcs. Additional motor requirements are attached.',attachments:[{fileName:'requirements.pdf',mimeType:'application/pdf',size:bytes.length,content:Buffer.from(bytes)}]};
 const result=await f.load('@/lib/email/inbound').processInboundEmail(email);
 assert.equal(result.type,'customer_inquiry');assert.match(f.tables.inquiries[0].reference,/^AO-\d{8}-[A-F0-9]{6}$/);assert.equal(uploads,1);
 const workflow=await f.load('@/lib/ai/workflow').processQueuedWorkflow(12,result.inquiryId);
 assert.equal(workflow.results.some(row=>row.error),false,JSON.stringify(workflow.results));
 assert.match(mergedInput.document_text,/BM-200/);assert.match(mergedInput.original_customer_text,/TS-100/);
 assert.ok(f.tables.requirements.some(row=>row.source==='pdf'&&row.value==='BM-200'));assert.ok(f.tables.requirements.some(row=>row.source==='customer_text'&&row.value==='TS-100'));
 assert.ok(f.tables.supplier_candidates.length>0);assert.ok(f.tables.suppliers.every(row=>row.verification_status==='verified'));assert.equal(f.sendCount(),0);

 const sent=[];f.mock('@/lib/email/provider',{getEmailProvider:()=>({send:async message=>{sent.push(message);return {providerMessageId:'<mock-rfq@example.test>',threadId:'<mock-rfq@example.test>',sentAt:new Date().toISOString()};}})});
 const actions=f.load('@/app/inquiries/[id]/supplier-rfq-actions'),candidate=f.tables.supplier_candidates[0],candidateIds=[candidate.id];
 const {previews}=await actions.getSupplierRfqPreviewAction({inquiryId:result.inquiryId,candidateIds});assert.equal(sent.length,0);
 await actions.sendSupplierRfqAction({inquiryId:result.inquiryId,candidateIds,previews});assert.equal(sent.length,1);assert.equal(sent[0].html,previews[0].html);
 let extractedInput;
 lateAgent=async(ctx,input,schema)=>{let output;
  if(ctx.agentId==='quote_extraction'){extractedInput=input;output={quotes:[{matchStatus:'match',currency:'EUR',quantity:2,netPrice:100,taxRate:20,taxMode:'excluded',taxText:'+20% VAT',leadTimeText:'two weeks'}]};}
  else if(ctx.agentId==='comparison')output={comparisons:[{supplierResponseId:f.tables.supplier_responses[0].id,findings:[{requirementId:candidate.requirement_id,supplierQuoteId:f.tables.supplier_quotes[0].id,status:'match',evidence:'Explicit supplier quotation'}]}]};
  else if(ctx.agentId==='customer_quote')output={lines:[],warnings:[]};
  else return baseline.runAgent(ctx,input,schema);
  return {output:schema.parse(output),provider:'test',model:'test'};
 };
 const reply=await f.load('@/lib/email/inbound').processInboundEmail({providerMessageId:'supplier-with-pdf',messageId:'<supplier-pdf@example.test>',provider:'test',from:sent[0].to[0],to:['purchase@example.test'],subject:'Re: '+sent[0].subject,inReplyTo:'<mock-rfq@example.test>',text:'Please find our offer attached. Delivery two weeks, EUR 100 +20% VAT.',attachments:[{fileName:'supplier-offer.pdf',mimeType:'application/pdf',size:bytes.length,content:Buffer.from(bytes)}]});
 assert.equal(reply.matched,true);const completed=await f.load('@/lib/ai/workflow').processQueuedWorkflow(12,result.inquiryId);assert.equal(completed.results.some(row=>row.error),false,JSON.stringify(completed.results));
 assert.match(extractedInput.attachment_text[0].extractedText,/BM-200/);assert.equal(f.tables.customer_quotes[0].status,'draft');assert.equal(f.tables.customer_quote_items[0].unit_price,null);
 assert.equal(f.tables.customer_quote_items[0].price_calculation.commercial.gross,120);assert.equal(sent.length,1,'Customer quote must wait for Admin; no automatic email send');
 await f.load('@/lib/email/inbound').processInboundEmail({...email,receivedAt:'2026-10-16T12:00:00Z'});assert.equal(f.tables.inquiries.length,1);assert.equal(uploads,2);
});

test('supplier messages preview every recipient and send exactly the reviewed subject and HTML',async()=>{
 const f=fixture();await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId,'document');await f.load('@/lib/ai/workflow').processQueuedWorkflow(12,f.inquiryId);
 const sent=[];f.mock('@/lib/email/provider',{getEmailProvider:()=>({send:async message=>{sent.push(message);return {providerMessageId:'mock-'+sent.length,sentAt:new Date().toISOString()};}})});
 const actions=f.load('@/app/inquiries/[id]/supplier-rfq-actions'),candidateIds=f.tables.supplier_candidates.map(row=>row.id);
 const {previews}=await actions.getSupplierRfqPreviewAction({inquiryId:f.inquiryId,candidateIds});assert.equal(previews.length,candidateIds.length);assert.equal(sent.length,0);assert.equal((f.tables.rfqs??[]).length,0);
 await actions.sendSupplierRfqAction({inquiryId:f.inquiryId,candidateIds,previews});assert.equal(sent.length,previews.length);
 previews.forEach((preview,index)=>{assert.equal(sent[index].subject,preview.subject);assert.equal(sent[index].html,preview.html);assert.deepEqual(sent[index].to,[preview.recipient]);});
});

test('a changed supplier request cannot be sent using an old preview',async()=>{
 const f=fixture();await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId,'document');await f.load('@/lib/ai/workflow').processQueuedWorkflow(12,f.inquiryId);
 const actions=f.load('@/app/inquiries/[id]/supplier-rfq-actions'),candidateIds=[f.tables.supplier_candidates[0].id];const {previews}=await actions.getSupplierRfqPreviewAction({inquiryId:f.inquiryId,candidateIds});
 f.tables.requirements.find(row=>row.id===f.tables.supplier_candidates[0].requirement_id).value='Changed sensor';
 await assert.rejects(actions.sendSupplierRfqAction({inquiryId:f.inquiryId,candidateIds,previews}),/preview again/);assert.equal(f.sendCount(),0);
});

// No search credits, database writes, email sends, or production credentials are used.
function fixture({ unreadable = false, protectedQuantity = false, noContacts = false, researchFailure = false } = {}) {
  const inquiryId = randomUUID();
  const tables = { inquiries: [{ id: inquiryId, status: 'processing', reference:'AO-20261015-ABCDEF',created_at:'2026-10-15T10:00:00Z',current_version: 1, original_customer_text: 'Alpha TS-100 sensor 2 pcs; Beta BM-200 motor 2 pcs' }] };
  if (unreadable) tables.inquiry_files = [{ id: randomUUID(), inquiry_id: inquiryId, status: 'uploaded', mime_type: 'application/pdf', original_name: 'request.pdf', storage_path: 'test.pdf' }];
  if (protectedQuantity) tables.requirements = [{ id: randomUUID(), inquiry_id: inquiryId, type: 'quantity', value: '9 pcs', source: 'customer_text', source_ref: 'intake:item:0', status: 'confirmed', admin_edited: true }];
  let searches = 0;
  let sends = 0;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = 'read'; }
    select(columns, options) { this.selectOptions = options; return this; }
    eq(key, value) { this.filters.push(row => (key==='is_selected'?(row[key]??true):row[key]) === value); return this; }
    is(key,value){this.filters.push(row=>{const [column,field]=key.split('->>');return (field?row[column]?.[field]??null:row[column]??null)===value;});return this;}
    ilike(key, value) { const literal = value.replace(/\\([%_\\])/g, '$1').toLowerCase(); this.filters.push(row => String(row[key] ?? '').toLowerCase() === literal); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    not(key, operator, value) { this.filters.push(row => operator === 'is' ? row[key] != null : row[key] !== value); return this; }
    contains(key, value) { this.filters.push(row => Object.entries(value).every(([k, v]) => row[key]?.[k] === v)); return this; }
    order() { return this; }
    limit(value) { this.count = value; return this; }
    insert(value) { this.op = 'insert'; this.value = value; return this; }
    upsert(value, options) { this.op = 'upsert'; this.value = value; this.conflict = options.onConflict.split(','); this.ignoreDuplicates=options.ignoreDuplicates; return this; }
    update(value) { this.op = 'update'; this.value = value; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
    execute() {
      const rows = tables[this.table] ??= [];
      let matches = rows.filter(row => this.filters.every(filter => filter(row)));
      if (this.op === 'update') matches.forEach(row => Object.assign(row, this.value));
      if (this.op === 'insert' || this.op === 'upsert') {
        matches = (Array.isArray(this.value) ? this.value : [this.value]).map(value => {
          let row = this.op === 'upsert' ? rows.find(row => this.conflict.every(key => row[key] === value[key])) : null;
          if (row) {if(!this.ignoreDuplicates)Object.assign(row, value);}
          else { row = { id: randomUUID(), created_at: new Date().toISOString(), attempt_count: 0, status: this.table==='supplier_order_confirmations'?'draft':'open', ...(this.table==='customer_quote_items'?{is_selected:true}:{}), ...value }; rows.push(row); }
          return row;
        });
      }
      if (this.count) matches = matches.slice(0, this.count);
      const result = matches.map(row => {
        const copy = structuredClone(row);
        if (this.table === 'supplier_candidates') copy.suppliers = tables.suppliers?.find(supplier => supplier.id === copy.supplier_id) ?? null;
        return copy;
      });
      return { data: this.selectOptions?.head ? null : this.one ? result[0] ?? null : result, count: this.selectOptions?.count ? matches.length : undefined, error: null };
    }
  }
  const database = { from: table => new Query(table) };
  const provider = { search: async ({ query }) => {
    searches++;
    if (researchFailure) throw new Error('Provider temporarily unavailable');
    const beta = /beta|bm-200/i.test(query);
    const domain = beta ? 'beta.example.com' : 'alpha.example.com';
    const company = beta ? 'Beta Motors Ltd' : 'Alpha Sensors Ltd';
    return [{ sourceType: 'web', sourceName: company, sourceUrl: `https://${domain}/products`, finding: `${company} manufacturer ${beta ? 'BM-200 Beta motor' : 'TS-100 Alpha temperature sensor'} ${noContacts ? '' : `sales contact sales@${domain} 123 Industrial Road +90 212 555 1234 Turkey`}`, structuredData: { title: company }, evidence: {} }];
  } };
  const cache = new Map();
  const mocks = {
    'server-only': {},
    'next/cache': { revalidatePath: () => {} },
    '@/lib/ai/guards': { requireAdmin: async () => ({ user: { id: randomUUID() }, supabase: database }) },
    '@/lib/ai/clarification-replies': { findCustomerClarificationForEmail: async () => ({ matched: false }), cleanEmailReply: (text, html) => text || html || '', extractEmailAddress: value => value.trim().toLowerCase(), applyCustomerClarificationAnswer: async () => {} },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => database },
    '@/lib/ai/document-processor': { downloadInquiryFile: async () => new Uint8Array(), parseInquiryFile: async () => ({ extractedText: '', extractedData: {}, qualityFlags: ['OCR_REQUIRED'] }) },
    '@/lib/ai/research/provider': { getResearchProvider: () => provider },
    '@/lib/ai/supplier-page': { readSupplierHtml: async url => {
      const domain = new URL(url).hostname;
      if (noContacts) return '<html><body>Company product catalog</body></html>';
      return `<html><body>${domain.startsWith('beta') ? 'Beta Motors Ltd BM-200 motor' : 'Alpha Sensors Ltd TS-100 temperature sensor'} manufacturer sales@${domain} 123 Industrial Road +90 212 555 1234 Turkey</body></html>`;
    } },
    '@/lib/email/provider': { getEmailProvider: () => ({ send: async () => { sends++; throw new Error('Unexpected outbound email'); } }) },
    '@/lib/ai/agent-runner': { runAgent: async (ctx, input, schema) => {
      let output;
      if (ctx.agentId === 'intake') output = { title: 'Two products', description: 'Sensor and motor', items: [
        { requestedText: 'Alpha TS-100 sensor 2 pcs', product: 'Temperature sensor', brand: 'Alpha', model: 'TS-100', quantity: 2, unit: 'pcs', confidence: 1, evidence: 'Alpha TS-100 sensor 2 pcs' },
        { requestedText: 'Beta BM-200 motor 2 pcs', product: 'Motor', brand: 'Beta', model: 'BM-200', quantity: 2, unit: 'pcs', confidence: 1, evidence: 'Beta BM-200 motor 2 pcs' },
      ] };
      else if (ctx.agentId === 'clarification') output = { needsClarification: false, questions: [] };
      else if (ctx.agentId === 'email_response') output = { hasActionableInformation: true, summary: 'Supplier provided a quote', supplierIntent: 'quote', customerActionRequired: false, adminReviewRequired: false, confidence: 1 };
      else if (ctx.agentId === 'supplier_discovery') {
        const source = input.research_results[0];
        output = { candidates: [{ name: source.source_name, website: new URL(source.source_url).origin, country: 'Turkey', sourceUrl: source.source_url, requirementId: input.target_product.id, matchType: 'exact_product', matchScore: 95, evidence: [source.finding] }] };
      } else if (ctx.agentId === 'contact_research') {
        if (noContacts) return { output: schema.parse({}), provider: 'test', model: 'test', executionId: ctx.executionId };
        const domain = new URL(input.supplier.website).hostname;
        output = { emails: [{ email: `sales@${domain}`, evidence: 'Published on official page' }, { email: 'invented@unknown.example', evidence: 'Unsupported' }], addresses: [{ address: '123 Industrial Road', country: 'Turkey', evidence: 'Published address' }], phones: [{ phone: '+90 212 555 1234', evidence: 'Published phone' }], contacts: [{ name: 'Invented Person', email: 'guess@unknown.example', evidence: ['Unsupported'] }] };
      } else if (ctx.agentId === 'supplier_verification') output = { status: 'verified', explanation: 'Official company identity, business activity and published contact details agree.', evidence: [input.candidate.website] };
      else throw new Error(`Unexpected agent ${ctx.agentId}`);
      return { output: schema.parse(output), provider: 'test', model: 'test', executionId: ctx.executionId };
    } },
  };
  function load(spec, parent = root) {
    let canonical = spec;
    if (spec.startsWith('.')) canonical = '@/'+path.relative(path.join(root, 'src'), path.resolve(parent, spec)).replaceAll('\\', '/');
    if (mocks[canonical]) return mocks[canonical];
    if (!canonical.startsWith('@/')) return require(canonical);
    const file = path.join(root, 'src', canonical.slice(2)) + '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    let js = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'transform' });
    const exports = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(match => match[1]);
    for (const match of js.matchAll(/export\s*\{([^}]+)\}/g)) exports.push(...match[1].split(',').map(name => name.trim()).filter(Boolean));
    js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_match, names, source) => `const {${names.replace(/\bas\b/g, ':')}} = require('${source}');`)
      .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (_match, name, source) => `const ${name} = require('${source}');`)
      .replace(/import\s*['"]([^'"]+)['"];?/g, (_match, source) => `require('${source}');`)
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '')
      .replace(/export\s*\{[^}]+\};?/g, '')
      + `\nObject.assign(module.exports, {${exports.join(',')}});`;
    new Function('require', 'module', 'exports', 'process', js)(child => load(child, path.dirname(file)), module, module.exports, { env: { OPENAI_API_KEY: 'test', SERPAPI_API_KEY: 'test' } });
    return module.exports;
  }
  return { inquiryId, tables, load, mock: (spec, value) => mocks[spec] = value, unmock: spec => delete mocks[spec], searchCount: () => searches, sendCount: () => sends };
}

test('two-product workflow preserves equal quantities and delivers evidence-backed contacts without sending email', async () => {
  const f = fixture();
  const workflow = f.load('@/lib/ai/workflow');
  const queue = f.load('@/lib/ai/orchestrator');
  await queue.enqueueWorkflow(f.inquiryId, 'document');
  const result = await workflow.processQueuedWorkflow(6, f.inquiryId);
  assert.equal(result.results.some(row => row.error), false, JSON.stringify(result.results));
  assert.equal(f.tables.requirements.filter(row => row.type === 'product').length, 2);
  assert.equal(f.tables.requirements.filter(row => row.type === 'quantity' && row.value === '2 pcs').length, 2);
  assert.equal(f.tables.supplier_candidates.length, 2);
  assert.equal(f.tables.suppliers.filter(row => row.verification_status === 'verified').length, 2);
  assert.ok(f.tables.suppliers.every(row => row.primary_email_id && row.primary_address_id && row.primary_phone_id));
  assert.ok(f.tables.supplier_emails.every(row => row.email.startsWith('sales@')));
  assert.equal(f.tables.supplier_contacts?.length ?? 0, 0);
  assert.ok(f.tables.supplier_candidates.every(row => row.verification_evidence.contact_sources.length && row.verification_evidence.assessment));
  assert.equal(f.sendCount(), 0);
  // Successful jobs remain successful and do not consume search credits on enqueue.
  const searches = f.searchCount();
  assert.equal((await queue.enqueueWorkflow(f.inquiryId, 'research')).status, 'succeeded');
  assert.equal(f.searchCount(), searches);
  // Explicit research recovery must reuse existing evidence and queue discovery.
  f.tables.ai_executions.find(row => row.task_key.endsWith(':research')).status = 'queued';
  await workflow.processQueuedWorkflow(1, f.inquiryId);
  assert.equal(f.searchCount(), searches);
  assert.equal(f.tables.ai_alerts.some(row => row.alert_type === 'RESEARCH_PROVIDER_NOT_CONNECTED'), false);
  const oldCaseCount = f.tables.research_cases.length;
  f.tables.requirements.find(row => row.type === 'model_part_number').value = 'TS-101';
  f.tables.ai_executions.find(row => row.task_key.endsWith(':research')).status = 'queued';
  await workflow.processQueuedWorkflow(1, f.inquiryId);
  assert.equal(f.tables.research_cases.length, oldCaseCount + 1);
  assert.ok(f.searchCount() > searches);
  assert.ok(f.tables.supplier_candidates.every(row => row.status === 'proposed'));
  assert.equal(f.tables.ai_executions.find(row => row.task_key.endsWith(':supplier_discovery')).status, 'queued');
});

test('OCR-deferred attachment preserves the original and does not block readable customer text', async () => {
  const f=fixture({unreadable:true});
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId,'document');
  const result=await f.load('@/lib/ai/workflow').processQueuedWorkflow(6,f.inquiryId);
  assert.equal(result.results.some(row=>row.error),false,JSON.stringify(result.results));
  assert.ok(f.searchCount()>0);assert.equal(f.tables.inquiry_files[0].status,'processed');
  assert.ok(f.tables.ai_alerts.some(row=>row.alert_type==='ATTACHMENT_REQUIRES_OCR'));
  assert.equal(f.tables.inquiry_files[0].storage_path,'test.pdf');
});

test('an unreadable attachment with no customer text stops as a genuine source issue',async()=>{
 const f=fixture({unreadable:true});f.tables.inquiries[0].original_customer_text='';
 await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId,'document');
 const result=await f.load('@/lib/ai/workflow').processQueuedWorkflow(1,f.inquiryId);
 assert.match(result.results[0].error,/no readable source/);assert.equal(f.searchCount(),0);
});

test('intake retry preserves admin quantity edits within the item group', async () => {
  const f = fixture({ protectedQuantity: true });
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'intake');
  await f.load('@/lib/ai/workflow').processQueuedWorkflow(1, f.inquiryId);
  const quantities = f.tables.requirements.filter(row => row.type === 'quantity');
  assert.deepEqual(quantities.map(row => row.value).sort(), ['2 pcs', '9 pcs']);
});

test('only one competing worker can claim a queued execution', async () => {
  const f = fixture();
  const queue = f.load('@/lib/ai/orchestrator');
  const execution = await queue.enqueueWorkflow(f.inquiryId, 'intake');
  const claims = await Promise.all([queue.markExecutionRunning(execution.id), queue.markExecutionRunning(execution.id)]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test('schemas preserve published emails and do not equate manufacturers with exact model matches', () => {
  const f = fixture();
  const schemas = f.load('@/lib/ai/agent-schemas');
  const contact = schemas.supplierContactResearchOutputSchema.parse({ contacts: [{ name: 'Sales', email: 'sales@example.com' }] });
  assert.equal(contact.contacts[0].email, 'sales@example.com');
  const candidates = schemas.supplierDiscoveryOutputSchema.parse({ candidates: [
    { name: 'Company', sourceUrl: 'https://example.com', matchType: 'official_manufacturer' },
    { name: 'Company', sourceUrl: 'https://example.com', matchType: 'same_brand_similar_product_match' },
  ] }).candidates;
  assert.deepEqual(candidates.map(row => row.matchType), ['same_brand_distributor', 'same_brand_similar']);
});

test('missing contact evidence leaves suppliers pending and identifies gaps to admin', async () => {
  const f = fixture({ noContacts: true });
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'document');
  await f.load('@/lib/ai/workflow').processQueuedWorkflow(6, f.inquiryId);
  assert.ok(f.tables.suppliers.every(row => row.verification_status === 'pending'));
  assert.ok(f.tables.supplier_candidates.every(row => row.verification_evidence.missing_contact_fields.includes('email')));
  assert.equal(f.tables.ai_executions.some(row => row.task_key.endsWith(':rfq')), false);
});

test('supplier page retrieval rejects local addresses and credential-bearing URLs', async () => {
  const f = fixture(); f.unmock('@/lib/ai/supplier-page');
  const page = f.load('@/lib/ai/supplier-page');
  for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1']) assert.equal(page.isPublicAddress(address), false, address);
  assert.equal(page.isPublicAddress('8.8.8.8'), true);
  assert.equal(await page.readSupplierHtml('http://127.0.0.1/admin'), '');
  assert.equal(await page.readSupplierHtml('https://user:password@example.com'), '');
});

test('admin verification preserves provenance and sent flags; mixed inquiry selections are rejected before send', async () => {
  const f = fixture();
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'document');
  await f.load('@/lib/ai/workflow').processQueuedWorkflow(6, f.inquiryId);
  const actions = f.load('@/app/inquiries/[id]/supplier-rfq-actions');
  const candidate = f.tables.supplier_candidates[0];
  candidate.verification_evidence.rfq_sent = true;
  const source = candidate.verification_evidence.source_url;
  await actions.verifySupplierCandidateAction({ inquiryId: f.inquiryId, candidateId: candidate.id });
  assert.equal(candidate.verification_evidence.source_url, source);
  assert.equal(candidate.verification_evidence.rfq_sent, true);
  await assert.rejects(actions.sendSupplierRfqAction({ inquiryId: f.inquiryId, candidateIds: [f.tables.supplier_candidates[1].id, randomUUID()] }), /do not belong/);
  assert.equal(f.sendCount(), 0);
});

test('provider outage cannot masquerade as successful research with no suppliers', async () => {
  const f = fixture({ researchFailure: true });
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'document');
  const result = await f.load('@/lib/ai/workflow').processQueuedWorkflow(6, f.inquiryId);
  assert.ok(result.results.some(row => row.error?.includes('All supplier research queries failed')));
  assert.equal(f.tables.research_cases[0].status, 'failed');
  assert.equal(f.tables.ai_executions.some(row => row.task_key.endsWith(':supplier_discovery')), false);
});

function supplierReplyFixture() {
  const f = fixture();
  const supplierId = randomUUID();
  const rfqId = randomUUID();
  f.tables.suppliers = [{ id: supplierId, legal_name: 'Supplier Company' }];
  f.tables.supplier_emails = [{ supplier_id: supplierId, email: 'info@supplier.example', status: 'active' }];
  f.tables.rfqs = [{ id: rfqId, inquiry_id: f.inquiryId, supplier_id: supplierId, recipient_email: 'info@supplier.example', rfq_code: 'RFQ-20261014-ABCDEF', subject: 'RFQ | RFQ-20261014-ABCDEF', status: 'sent', created_at: new Date().toISOString() }];
  f.tables.communications = [{ id: randomUUID(), rfq_id: rfqId, direction: 'outgoing', channel: 'email', provider_message_id: '<original-rfq@supplier-thread.example>', thread_id: null, metadata: {} }];
  f.tables.inquiries[0].status = 'rfq';
  return { f, supplierId, rfqId };
}

test('new sales sender on the supplier company domain matches a unique RFQ code', async () => {
  const { f, supplierId, rfqId } = supplierReplyFixture();
  const match = await f.load('@/lib/ai/supplier-email-matching').findSupplierRFQForEmail({ sender: 'Sales <sales@supplier.example>', subject: 'Re: Re: RFQ | RFQ-20261014-ABCDEF' });
  assert.equal(match.matched, true);
  assert.equal(match.supplierId, supplierId);
  assert.equal(match.rfq.id, rfqId);
});

test('new sales sender with a rewritten subject matches the actual SMTP message ID', async () => {
  const { f, rfqId } = supplierReplyFixture();
  const match = await f.load('@/lib/ai/supplier-email-matching').findSupplierRFQForEmail({ sender: 'sales@supplier.example', subject: 'Our quotation', inReplyTo: '<original-rfq@supplier-thread.example>' });
  assert.equal(match.matched, true);
  assert.equal(match.rfq.id, rfqId);
});

test('known sender threading also checks provider_message_id when thread_id is absent', async () => {
  const { f, rfqId } = supplierReplyFixture();
  f.tables.rfqs.push({ ...f.tables.rfqs[0], id: randomUUID(), rfq_code: 'RFQ-20261014-OTHER1', subject: 'Another request' });
  const match = await f.load('@/lib/ai/supplier-email-matching').findSupplierRFQForEmail({ sender: 'info@supplier.example', subject: 'Our quotation', inReplyTo: '<original-rfq@supplier-thread.example>' });
  assert.equal(match.matched, true);
  assert.equal(match.rfq.id, rfqId);
});

test('company domain alone or a reference from an unrelated sender cannot attach a quote', async () => {
  const { f } = supplierReplyFixture();
  const matcher = f.load('@/lib/ai/supplier-email-matching');
  assert.equal((await matcher.findSupplierRFQForEmail({ sender: 'sales@supplier.example', subject: 'Quote with no reference' })).matched, false);
  assert.equal((await matcher.findSupplierRFQForEmail({ sender: 'sales@unrelated.example', subject: 'RFQ-20261014-ABCDEF' })).matched, false);
  f.tables.rfqs[0].recipient_email = 'first@gmail.com';
  f.tables.supplier_emails[0].email = 'first@gmail.com';
  assert.equal((await matcher.findSupplierRFQForEmail({ sender: 'different@gmail.com', subject: 'RFQ-20261014-ABCDEF' })).matched, false);
});

test('a previously unmatched sales reply is recovered, saved once and queued for quote extraction', async () => {
  const { f, rfqId } = supplierReplyFixture();
  f.mock('@/lib/ai/workflow', { continueInquiryWorkflow: async () => ({ outcome: 'queued' }) });
  const communicationId = randomUUID();
  f.tables.communications.push({ id: communicationId, provider_message_id: 'reply-001', direction: 'incoming', metadata: { type: 'unmatched_incoming_email' } });
  f.tables.unmatched_emails = [{ id: randomUUID(), communication_id: communicationId, reason: 'supplier_not_found' }];
  const email = { providerMessageId: 'reply-001', from: 'sales@supplier.example', to: ['purchase-dep@aryaautomation.com'], subject: 'Re: RFQ-20261014-ABCDEF', text: 'Price USD 100 per unit, delivery 2 weeks.', provider: 'test' };
  const inbound = f.load('@/lib/email/inbound');
  const result = await inbound.processInboundEmail(email);
  assert.equal(result.matched, true);
  assert.equal(result.rfqId, rfqId);
  assert.equal(f.tables.supplier_responses.length, 1);
  assert.equal(f.tables.communications.find(row => row.id === communicationId).metadata.type, 'supplier_rfq_reply');
  assert.ok(f.tables.unmatched_emails[0].reviewed_at);
  assert.equal(f.tables.ai_executions.find(row => row.task_key.endsWith(':quote_extraction')).status, 'queued');
  await inbound.processInboundEmail(email);
  assert.equal(f.tables.supplier_responses.length, 1);
  assert.equal(f.sendCount(), 0);
});

test('new replies reopen completed extraction; RFQ state processes pending responses', async () => {
  const { f } = supplierReplyFixture();
  const queue = f.load('@/lib/ai/orchestrator');
  const execution = await queue.enqueueWorkflow(f.inquiryId,'quote_extraction');
  await queue.markExecutionRunning(execution.id);
  await queue.markExecutionSuccess(execution.id);
  assert.equal((await queue.enqueueSupplierQuoteExtraction(f.inquiryId)).status,'queued');
  f.tables.supplier_responses = [{ id: randomUUID(), inquiry_id: f.inquiryId, supplier_id: f.tables.suppliers[0].id, communication_id: 'missing-communication', status: 'received' }];
  const result = await f.load('@/lib/ai/workflow').continueInquiryWorkflow(f.inquiryId);
  assert.notEqual(result.outcome,'rfq_waiting_for_supplier_response');
  assert.ok(result.execution.task_key.endsWith(':quote_extraction'));
  assert.equal(f.tables.ai_executions.find(row => row.id === execution.id).output_ref.skipped_count,1);
});
