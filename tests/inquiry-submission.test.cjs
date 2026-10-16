const test=require('node:test'),assert=require('node:assert/strict');
const createLoader=require('./helpers/load-ts.cjs');
const {prepareInquirySource}=createLoader()('@/lib/inquiry-submission');
test('manual quantities stay required and explicit units are preserved',()=>{
 for(const quantity of ['',0,-1,null])assert.throws(()=>prepareInquirySource({entryMode:'manual',itemsJson:JSON.stringify([{description:'Requested material',quantity}]),originalCustomerText:'',fileCount:0}));
 const result=prepareInquirySource({entryMode:'manual',itemsJson:JSON.stringify([{description:'Requested material',quantity:12.5,unit:'kg'}]),originalCustomerText:'',fileCount:0});assert.match(result.originalText,/Quantity: 12.5 kg/);assert.equal(result.items[0].quantity,12.5);
});
test('pasted lists and files do not create fictitious manual items or quantities',()=>{
 const text='Product A — 150 pcs\nMaterial B — 12.5 kg';
 assert.deepEqual(prepareInquirySource({entryMode:'list',itemsJson:'[{}]',originalCustomerText:text,fileCount:0}),{items:[],originalText:text});
 assert.deepEqual(prepareInquirySource({entryMode:'file',itemsJson:'[]',originalCustomerText:'',fileCount:1}),{items:[],originalText:''});
 assert.throws(()=>prepareInquirySource({entryMode:'list',itemsJson:'[]',originalCustomerText:' ',fileCount:0}),/Paste/);
 assert.throws(()=>prepareInquirySource({entryMode:'file',itemsJson:'[]',originalCustomerText:'',fileCount:0}),/Upload/);
});
function actionFixture(){
 const id='11111111-1111-4111-8111-111111111111',records=[],events=[],uploads=[];
 const db={storage:{from:()=>({upload:async(path,bytes)=>{uploads.push({path,bytes});events.push('upload');return {error:null};},remove:async()=>({error:null})})},from:table=>{
  let value;const q={insert:input=>{value=input;records.push({table,input});return q;},select:()=>q,eq:()=>q,update:()=>q,delete:()=>q,single:async()=>({data:table==='inquiries'?{id,reference:'AO-TEST'}:{id,original_name:value?.original_name},error:null}),then:resolve=>resolve({data:null,error:null})};return q;
 }};
 const mocks={'next/cache':{revalidatePath:()=>{}},'@/lib/ai/guards':{requireCustomerAccess:async()=>({supabase:db,user:{id},customer:{id}}),requireCustomerInquiryAccess:async()=>({supabase:db,user:{id}})},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/ai/workflow':{startInquiryWorkflow:async()=>{events.push('queue');return {execution:{id}};}}};
 for(const name of ['@/lib/quotes/readiness','@/lib/quotes/supplier-orders','@/lib/quotes/load-document','@/lib/quotes/company','@/lib/quotes/document','@/lib/email/provider','@/lib/ai/clarification-replies'])mocks[name]={};
 return {action:createLoader(mocks)('@/app/actions').createCustomerInquiryAction,records,events,uploads};
}
test('server accepts a complete pasted list without a second quantity entry',async()=>{
 const f=actionFixture(),text='Product A 150 pcs\nProduct B 20 kg';await f.action({entryMode:'list',originalCustomerText:text,itemsJson:'[]'});
 const inquiry=f.records.find(r=>r.table==='inquiries').input;assert.equal(inquiry.original_customer_text,text);assert.deepEqual(inquiry.normalized_information.submitted_items,[]);assert.deepEqual(f.events,['queue']);
});
test('server stores PDF and Excel-only requests before queuing automatic processing',async()=>{
 for(const [name,mime]of [['request.pdf','application/pdf'],['request.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]){
  const f=actionFixture();await f.action({entryMode:'file',originalCustomerText:'',itemsJson:'[]',files:[new File(['fixture'],name,{type:mime})]});
  assert.deepEqual(f.events,['upload','queue']);assert.equal(f.uploads.length,1);assert.ok(f.records.some(r=>r.table==='document_processing'));const inquiry=f.records.find(r=>r.table==='inquiries').input;assert.equal(inquiry.original_customer_text,'');assert.deepEqual(inquiry.normalized_information.submitted_items,[]);
 }
});
test('empty requests and unsupported files are rejected before any inquiry is saved',async()=>{
 const f=actionFixture();await assert.rejects(f.action({entryMode:'file',originalCustomerText:'',files:[]}),/Upload/);
 await assert.rejects(f.action({entryMode:'file',originalCustomerText:'',files:[new File(['bad'],'bad.exe',{type:'application/octet-stream'})]}),/Unsupported/);assert.deepEqual(f.records,[]);
});
test('Excel extraction retains separate item quantities and units without inventing missing values',async()=>{
 const XLSX=require('xlsx'),workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Item','Quantity','Unit'],['Office supplies',150,'pcs'],['Packing material',12.5,'kg'],['Another item','','m']]),'Request');
 const parsed=await createLoader()('@/lib/ai/document-processor').parseInquiryFile(new Uint8Array(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','request.xlsx');
 assert.match(parsed.extractedText,/Office supplies \| 150 \| pcs/);assert.match(parsed.extractedText,/Packing material \| 12.5 \| kg/);assert.equal(parsed.extractedData.sheets[0].rows[3][1],'');
});
