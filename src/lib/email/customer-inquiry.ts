import 'server-only';
import {createHash} from 'node:crypto';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {enqueueWorkflow} from '@/lib/ai/orchestrator';
import {ToolError} from '@/lib/errors';
import {extractEmailAddress} from '@/lib/ai/clarification-replies';
import type {InboundEmail} from './inbound';

export function looksLikeNewInquiry(subject:string,body:string,hasAttachments:boolean) {
  const text=subject+'\n'+body;
  if(/^re:/i.test(subject.trim()))return false;
  return /\b(?:rfq|inquiry|enquiry|quotation|quote|fiyat|teklif|talep)\b/i.test(text)
    || /(?:please|kindly).{0,60}(?:price|delivery|supply|send|provide)/is.test(text)
    || /[a-z]{1,8}[-/]?\d{2,}/i.test(text)&&/\d+\s*(?:pcs|pieces|adet|units)\b/i.test(text)
    || hasAttachments&&/attached|attachment|ekte/i.test(text);
}

export async function ingestCustomerInquiryEmail(email:InboundEmail) {
  const body=email.text??'';
  if(!looksLikeNewInquiry(email.subject,body,Boolean(email.attachments?.length)))return null;
  const db=createSupabaseAdminClient(),sender=extractEmailAddress(email.from);
  const {data:customers,error}=await db.from('customers').select('id,user_id,email,name,company_name').eq('status','active')
    .ilike('email',sender.replace(/[\\%_]/g,'\\$&'));
  if(error)throw new ToolError('TRANSIENT',error.message);
  // Ambiguous or unknown sender identity is an exception, never an automatic association.
  if(customers?.length!==1)return null;
  const customer=customers[0];
  if(customer.user_id){const {data:profile}=await db.from('profiles').select('role,status').eq('user_id',customer.user_id).single();if(profile?.role!=='customer'||profile.status!=='active')return null;}
  let {data:communication}=await db.from('communications').select('id,inquiry_id,customer_id,metadata').eq('provider_message_id',email.providerMessageId).maybeSingle();
  if(communication?.customer_id&&communication.customer_id!==customer.id)return null;
  if(communication?.metadata?.ingestion_complete===true)return {ok:true,matched:true,type:'customer_inquiry',inquiryId:communication.inquiry_id,duplicate:true};
  const files=email.attachments??[];
  if(files.some(file=>file.content.byteLength>10*1024*1024)||files.reduce((n,file)=>n+file.content.byteLength,0)>25*1024*1024)throw new ToolError('VALIDATION','Customer inquiry attachment size limit exceeded.');
  const digest=createHash('sha256').update(email.provider+':'+email.providerMessageId).digest('hex');
  const received=new Date(email.receivedAt??Date.now());
  const date=(Number.isNaN(received.getTime())?new Date():received).toISOString().slice(0,10).replaceAll('-','');
  let inquiry:{id:string;reference:string}|null=null;
  if(communication?.inquiry_id){const result=await db.from('inquiries').select('id,reference').eq('id',communication.inquiry_id).eq('customer_id',customer.id).single();inquiry=result.data;}
  for(let offset=0;!inquiry&&offset<24;offset+=6){
    const reference=`AO-${date}-${digest.slice(offset,offset+6).toUpperCase()}`;
    const {data:existing,error:readError}=await db.from('inquiries').select('id,reference,customer_id,normalized_information').eq('reference',reference).maybeSingle();
    if(readError)throw new ToolError('TRANSIENT',readError.message);
    if(existing){if(existing.customer_id===customer.id&&existing.normalized_information?.email_intake?.provider_message_id===email.providerMessageId&&existing.normalized_information?.email_intake?.provider===email.provider)inquiry=existing;continue;}
    const result=await db.from('inquiries').insert({customer_id:customer.id,reference,title:email.subject.trim().slice(0,200)||'Customer email inquiry',
      original_customer_text:body,status:'processing',normalized_information:{email_intake:{provider:email.provider,provider_message_id:email.providerMessageId,sender}}}).select('id,reference').single();
    if(result.error)throw new ToolError('TRANSIENT',result.error.message);inquiry=result.data;
  }
  if(!inquiry)throw new ToolError('CONFLICT','An inquiry reference could not be safely allocated.');
  if(!communication){const result=await db.from('communications').insert({inquiry_id:inquiry.id,customer_id:customer.id,direction:'incoming',channel:'email',
    provider_message_id:email.providerMessageId,thread_id:email.messageId??null,subject:email.subject,body,received_at:email.receivedAt??new Date().toISOString(),
    metadata:{type:'customer_inquiry_email',provider:email.provider,from:sender,ingestion_complete:false}}).select('id,inquiry_id,customer_id,metadata').single();
    if(result.error)throw new ToolError('TRANSIENT',result.error.message);communication=result.data;}
  if(!communication)throw new ToolError('TRANSIENT','Customer email could not be saved.');
  for(const [index,file] of files.entries()){
    const h=createHash('sha256').update(digest+':'+index).digest('hex');const id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
    const {data:existing}=await db.from('inquiry_files').select('id').eq('id',id).maybeSingle();
    if(!existing){
    const storagePath=`${inquiry.id}/${id}/${file.fileName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,180)}`;
    const upload=await db.storage.from('inquiry-files').upload(storagePath,file.content,{contentType:file.mimeType,upsert:true});if(upload.error)throw new ToolError('TRANSIENT',upload.error.message);
    const stored=await db.from('inquiry_files').insert({id,inquiry_id:inquiry.id,storage_path:storagePath,original_name:file.fileName,mime_type:file.mimeType,file_size:file.content.byteLength,status:'uploaded',metadata:{source:'customer_email',communication_id:communication.id}});if(stored.error)throw new ToolError('TRANSIENT',stored.error.message);
    }
    const {data:processed}=await db.from('document_processing').select('id').eq('file_id',id).limit(1).maybeSingle();
    if(processed)continue;
    const processing=await db.from('document_processing').insert({file_id:id,processor:'native_text',status:'uploaded'});if(processing.error)throw new ToolError('TRANSIENT',processing.error.message);
  }
  await enqueueWorkflow(inquiry.id,'document');
  const done=await db.from('communications').update({inquiry_id:inquiry.id,customer_id:customer.id,metadata:{type:'customer_inquiry_email',provider:email.provider,from:sender,ingestion_complete:true,attachment_count:files.length}}).eq('id',communication.id);
  if(done.error)throw new ToolError('TRANSIENT',done.error.message);
  await db.from('unmatched_emails').update({reviewed_at:new Date().toISOString(),reason:'Automatically received as customer inquiry '+inquiry.reference}).eq('communication_id',communication.id);
  await db.from('timeline_events').insert({inquiry_id:inquiry.id,event_type:'customer_inquiry_received_by_email',visibility:'customer',actor_type:'system',metadata:{communication_id:communication.id,attachment_count:files.length}});
  return {ok:true,matched:true,type:'customer_inquiry',inquiryId:inquiry.id,duplicate:false};
}
