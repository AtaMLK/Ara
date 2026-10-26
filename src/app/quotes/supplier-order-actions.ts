'use server';
import {createHash} from 'node:crypto';
import {getQuoteCompany} from '@/lib/quotes/company';
import {createCommercialPdf} from '@/lib/quotes/commercial-pdf';
import {purchaseOrderDocument} from '@/lib/quotes/purchase-order-document';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/ai/guards';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {getEmailProvider} from '@/lib/email/provider';
import {loadOrderGroups,renderSupplierOrder,orderFingerprint} from '@/lib/quotes/supplier-orders';

export async function prepareSupplierOrdersAction(quoteId:string,instructions='') {
  await requireAdmin();
  z.string().uuid().parse(quoteId);
  instructions=z.string().trim().max(4000).parse(instructions);
  const db=createSupabaseAdminClient();
  const {quote,groups,company}=await loadOrderGroups(quoteId,instructions);
  const previews=[];
  for(const group of groups){
    const {data:previous,error:previousError}=await db.from('supplier_order_confirmations').select('*').eq('customer_quote_id',quote.id).eq('supplier_id',group.supplierId).maybeSingle();
    if(previousError)throw new Error('Supplier order could not be checked.');
    if(previous&&previous.status!=='draft'){previews.push({...previous,html:previous.snapshot?.email_html,pdf_url:previous.snapshot?.pdf_path?'/api/supplier-orders/'+previous.id+'/pdf?v='+previous.snapshot.pdf_sha256:previous.status==='sent'?'/api/supplier-orders/'+previous.id+'/pdf?copy=current':undefined,pdf_is_copy:!previous.snapshot?.pdf_path&&previous.status==='sent',supplier_name:group.supplierName});continue;}
    const documentDate=previous?.snapshot?.document_date||new Date().toLocaleDateString('en-GB',{timeZone:'Europe/Istanbul'});
    const message=renderSupplierOrder(group,company);
    const snapshot={...group,company,document_date:documentDate,template_version:'commercial-v1'};
    const pdf=await createCommercialPdf(purchaseOrderDocument(group,documentDate),await getQuoteCompany());
    const sha256=createHash('sha256').update(pdf).digest('hex');
    const pdfPath='supplier-orders/'+quote.id+'/'+group.supplierId+'/'+sha256+'.pdf';
    const {error:uploadError}=await db.storage.from('supplier-email-attachments').upload(pdfPath,pdf,{contentType:'application/pdf',upsert:false});
    if(uploadError&&!/already exists|duplicate/i.test(uploadError.message))throw new Error('Purchase order PDF could not be stored.');
    const payload={customer_quote_id:quote.id,inquiry_id:quote.inquiry_id,supplier_id:group.supplierId,reference:group.reference,
      recipient_email:group.recipient,subject:message.subject,body:message.body,snapshot:{...snapshot,email_html:message.html,pdf_path:pdfPath,pdf_sha256:sha256},fingerprint:orderFingerprint({snapshot,...message})};
    // A fixed quote/supplier key prevents a second order on retries. Only drafts
    // can be refreshed; sending/sent/uncertain messages remain immutable.
    const {error:insertError}=await db.from('supplier_order_confirmations').upsert(payload,{onConflict:'customer_quote_id,supplier_id',ignoreDuplicates:true});
    if(insertError)throw new Error('Supplier order preview could not be saved.');
    const {error:updateError}=await db.from('supplier_order_confirmations').update(payload).eq('customer_quote_id',quote.id).eq('supplier_id',group.supplierId).eq('status','draft');
    if(updateError)throw new Error('Supplier order preview could not be refreshed.');
    const {data:order,error}=await db.from('supplier_order_confirmations').select('id,reference,status,recipient_email,subject,body,fingerprint,sent_at,error_text,snapshot').eq('customer_quote_id',quote.id).eq('supplier_id',group.supplierId).single();
    if(error||!order)throw new Error('Supplier order preview could not be loaded.');
    previews.push({...order,html:typeof order.snapshot?.email_html==='string'?order.snapshot.email_html:undefined,pdf_url:order.snapshot?.pdf_path?'/api/supplier-orders/'+order.id+'/pdf?v='+order.snapshot.pdf_sha256:undefined,supplier_name:group.supplierName});
  }
  revalidatePath('/quotes/'+quoteId);
  return previews;
}

export async function sendSupplierOrderAction(orderId:string,fingerprint:string) {
  const {user}=await requireAdmin();
  z.string().uuid().parse(orderId);z.string().length(64).parse(fingerprint);
  const db=createSupabaseAdminClient();
  const {data:order,error}=await db.from('supplier_order_confirmations').select('*').eq('id',orderId).single();
  if(error||!order)throw new Error('Supplier order not found.');
  if(order.status==='sent')return {ok:true,alreadySent:true};
  if(order.status!=='draft')throw new Error('This order is sending or delivery needs checking. Check the sent mailbox before taking further action.');
  if(order.fingerprint!==fingerprint)throw new Error('Order preview changed. Prepare and review it again.');
  const saved=order.snapshot as {instructions?:string;document_date?:string;template_version?:string;pdf_path?:string;pdf_sha256?:string};
  const {groups,company}=await loadOrderGroups(order.customer_quote_id,saved.instructions||'');
  const group=groups.find(group=>group.supplierId===order.supplier_id);
  if(!group)throw new Error('Supplier allocation changed. Prepare the previews again.');
  const message=renderSupplierOrder(group,company);
  if(orderFingerprint({snapshot:{...group,company,document_date:saved.document_date,template_version:saved.template_version},...message})!==fingerprint)throw new Error('Supplier details changed. Prepare and review the previews again.');
  if(saved.template_version!=='commercial-v1'||!saved.pdf_path?.startsWith('supplier-orders/'+order.customer_quote_id+'/'+order.supplier_id+'/')||!saved.pdf_sha256)throw new Error('Prepare and review the purchase order PDF before sending.');
  const {data:storedPdf,error:pdfError}=await db.storage.from('supplier-email-attachments').download(saved.pdf_path);
  if(pdfError||!storedPdf)throw new Error('The reviewed purchase order PDF could not be loaded.');
  const pdfBytes=new Uint8Array(await storedPdf.arrayBuffer());
  if(createHash('sha256').update(pdfBytes).digest('hex')!==saved.pdf_sha256)throw new Error('Purchase order PDF changed. Prepare the preview again.');
  const from=process.env.EMAIL_FROM||process.env.SMTP_FROM||process.env.SMTP_USER;
  if(!from)throw new Error('Configure the purchasing email sender before sending orders.');
  const {data:claimed,error:claimError}=await db.from('supplier_order_confirmations').update({status:'sending',approved_by:user.id,approved_at:new Date().toISOString()})
    .eq('id',order.id).eq('status','draft').eq('fingerprint',fingerprint).select('id').maybeSingle();
  if(claimError||!claimed)throw new Error('Order is already being sent, or its preview changed. Refresh its status.');
  let result;
  try{
    const html=message.html;
    result=await getEmailProvider().send({from,to:[order.recipient_email],subject:order.subject,text:order.body,html,generatedAttachments:[{fileName:order.reference+'.pdf',mimeType:'application/pdf',content:pdfBytes}],inquiryId:order.inquiry_id,idempotencyKey:'supplier-order-'+order.id});
  }catch{
    // SMTP can fail after accepting a message. Never automatically retry an
    // order, even with the same header: SMTP has no idempotency guarantee.
    await db.from('supplier_order_confirmations').update({status:'delivery_uncertain',error_text:'Delivery could not be confirmed. Check the sent mailbox and contact the supplier before any resend.'}).eq('id',order.id).eq('status','sending');
    revalidatePath('/quotes/'+order.customer_quote_id);
    throw new Error('Supplier order delivery is uncertain. Check the sent mailbox; this order will not be automatically resent.');
  }
  const {error:sentError}=await db.from('supplier_order_confirmations').update({status:'sent',sent_at:result.sentAt,provider_message_id:result.providerMessageId,error_text:null}).eq('id',order.id).eq('status','sending');
  if(sentError)throw new Error('The email was sent but its status could not be saved. Check the sent mailbox before any further action.');
  const {error:logError}=await db.from('communications').insert({inquiry_id:order.inquiry_id,supplier_id:order.supplier_id,quote_id:order.customer_quote_id,direction:'outgoing',channel:'email',subject:order.subject,body:message.html,sent_at:result.sentAt,provider_message_id:result.providerMessageId,thread_id:result.threadId,
    metadata:{type:'supplier_order_confirmation',language:group.language,plain_text:order.body,supplier_order_pdf_path:saved.pdf_path,supplier_order_pdf_sha256:saved.pdf_sha256,supplier_order_id:order.id,reference:order.reference,recipient_email:order.recipient_email}});
  const {error:timelineError}=await db.from('timeline_events').insert({inquiry_id:order.inquiry_id,event_type:'supplier_order_confirmation_sent',visibility:'admin',actor_type:'admin',actor_user_id:user.id,metadata:{supplier_order_id:order.id,supplier_id:order.supplier_id,quote_id:order.customer_quote_id}});
  revalidatePath('/quotes/'+order.customer_quote_id);revalidatePath('/inquiries/'+order.inquiry_id);revalidatePath('/notifications');
  if(logError||timelineError)throw new Error('Supplier order was sent and recorded. Its activity log needs checking.');
  return {ok:true,alreadySent:false};
}
