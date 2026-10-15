// Live database/storage integration with a disposable customer; queue is isolated.
// No AI/search calls or email sends. All created records and blobs are removed.
const fs=require('node:fs'),{randomBytes}=require('node:crypto'),assert=require('node:assert/strict');
require('@next/env').loadEnvConfig(process.cwd());
const load=require('./helpers/load-ts.cjs'),db=load()('@/lib/supabase/admin').createSupabaseAdminClient();
const run=randomBytes(6).toString('hex'),paths=[];let customerId;const queued=[];
const from=db.storage.from.bind(db.storage);db.storage.from=bucket=>{const client=from(bucket),upload=client.upload.bind(client);client.upload=async(path,...args)=>{const result=await upload(path,...args);if(!result.error)paths.push({bucket,path});return result;};return client;};
(async()=>{try{
 const {data:customer,error}=await db.from('customers').insert({customer_code:'QA-EMAIL-'+run,customer_type:'company',name:'ARAT QA email intake',company_name:'ARAT QA email intake',email:`arat-qa-${run}@example.invalid`,country:'Turkey',status:'active'}).select('id,email').single();assert.ifError(error);customerId=customer.id;
 const {PDFDocument,StandardFonts}=require('pdf-lib'),pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage().drawText('HS-421T accelerometer - 150 pcs',{font});const bytes=await pdf.save();
 const modules=load({'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/ai/orchestrator':{enqueueWorkflow:async(id,stage)=>queued.push({id,stage})}});
 const intake=modules('@/lib/email/customer-inquiry');const email={provider:'qa-isolated',providerMessageId:'qa-text-pdf-'+run,from:customer.email,to:['qa-inbox@example.invalid'],subject:'RFQ with text and PDF '+run,text:'Please quote the delivery and price for HS-421T, 150 pcs. Details attached.',attachments:[{fileName:'requirements.pdf',mimeType:'application/pdf',size:bytes.length,content:Buffer.from(bytes)}]};
 const result=await intake.ingestCustomerInquiryEmail(email);assert.equal(result.type,'customer_inquiry');assert.deepEqual(queued,[{id:result.inquiryId,stage:'document'}]);
 const {data:inquiry}=await db.from('inquiries').select('reference,original_customer_text').eq('id',result.inquiryId).single();assert.match(inquiry.reference,/^AO-\d{8}-[A-F0-9]{6}$/);assert.match(inquiry.original_customer_text,/150 pcs/);
 const {data:files,fileError}=await db.from('inquiry_files').select('id,storage_path,mime_type').eq('inquiry_id',result.inquiryId);assert.ifError(fileError);assert.equal(files.length,1);
 const {data:stored,error:downloadError}=await db.storage.from('inquiry-files').download(files[0].storage_path);assert.ifError(downloadError);assert.equal(Buffer.compare(Buffer.from(await stored.arrayBuffer()),Buffer.from(bytes)),0);
 const parsed=await modules('@/lib/ai/document-processor').parseInquiryFile(new Uint8Array(bytes),'application/pdf','requirements.pdf');assert.match(parsed.extractedText,/HS-421T/);
 await intake.ingestCustomerInquiryEmail({...email,receivedAt:'2026-10-16T10:00:00Z'});assert.equal(queued.length,1);
 console.log('Live integration passed: text + PDF stored intact, native PDF extraction, document-stage queue handoff, duplicate protection. No email or AI calls.');
 }finally{
 if(customerId){const {data:inquiries}=await db.from('inquiries').select('id').eq('customer_id',customerId);const ids=(inquiries??[]).map(row=>row.id);
  if(ids.length){const {data:files}=await db.from('inquiry_files').select('id').in('inquiry_id',ids);if(files?.length){const r=await db.from('document_processing').delete().in('file_id',files.map(row=>row.id));assert.ifError(r.error);}
   for(const table of ['inquiry_files','communications','timeline_events']){const r=await db.from(table).delete().in('inquiry_id',ids);assert.ifError(r.error);}const r=await db.from('inquiries').delete().in('id',ids);assert.ifError(r.error);}
  for(const entry of paths){const r=await db.storage.from(entry.bucket).remove([entry.path]);assert.ifError(r.error);}const r=await db.from('customers').delete().eq('id',customerId);assert.ifError(r.error);
 }
 console.log('Disposable email intake records and PDF removed.');
 }})().catch(error=>{console.error(error.message);process.exitCode=1;});
