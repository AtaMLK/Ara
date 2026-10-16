'use server';
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
    const message=renderSupplierOrder(group,company);
    const snapshot={...group,company};
    const payload={customer_quote_id:quote.id,inquiry_id:quote.inquiry_id,supplier_id:group.supplierId,reference:group.reference,
      recipient_email:group.recipient,subject:message.subject,body:message.body,snapshot:{...snapshot,email_html:message.html},fingerprint:orderFingerprint({snapshot,...message})};
    // A fixed quote/supplier key prevents a second order on retries. Only drafts
    // can be refreshed; sending/sent/uncertain messages remain immutable.
    const {error:insertError}=await db.from('supplier_order_confirmations').upsert(payload,{onConflict:'customer_quote_id,supplier_id',ignoreDuplicates:true});
    if(insertError)throw new Error('Supplier order preview could not be saved.');
    const {error:updateError}=await db.from('supplier_order_confirmations').update(payload).eq('customer_quote_id',quote.id).eq('supplier_id',group.supplierId).eq('status','draft');
    if(updateError)throw new Error('Supplier order preview could not be refreshed.');
    const {data:order,error}=await db.from('supplier_order_confirmations').select('id,reference,status,recipient_email,subject,body,fingerprint,sent_at,error_text,snapshot').eq('customer_quote_id',quote.id).eq('supplier_id',group.supplierId).single();
    if(error||!order)throw new Error('Supplier order preview could not be loaded.');
    previews.push({...order,html:typeof order.snapshot?.email_html==='string'?order.snapshot.email_html:undefined,supplier_name:group.supplierName});
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
  const saved=order.snapshot as {instructions?:string};
  const {groups,company}=await loadOrderGroups(order.customer_quote_id,saved.instructions||'');
  const group=groups.find(group=>group.supplierId===order.supplier_id);
  if(!group)throw new Error('Supplier allocation changed. Prepare the previews again.');
  const message=renderSupplierOrder(group,company);
  if(orderFingerprint({snapshot:{...group,company},...message})!==fingerprint)throw new Error('Supplier details changed. Prepare and review the previews again.');
  const from=process.env.EMAIL_FROM||process.env.SMTP_FROM||process.env.SMTP_USER;
  if(!from)throw new Error('Configure the purchasing email sender before sending orders.');
  const {data:claimed,error:claimError}=await db.from('supplier_order_confirmations').update({status:'sending',approved_by:user.id,approved_at:new Date().toISOString()})
    .eq('id',order.id).eq('status','draft').eq('fingerprint',fingerprint).select('id').maybeSingle();
  if(claimError||!claimed)throw new Error('Order is already being sent, or its preview changed. Refresh its status.');
  let result;
  try{
    const html=message.html;
    result=await getEmailProvider().send({from,to:[order.recipient_email],subject:order.subject,text:order.body,html,idempotencyKey:'supplier-order-'+order.id});
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
    metadata:{type:'supplier_order_confirmation',language:group.language,plain_text:order.body,supplier_order_id:order.id,reference:order.reference,recipient_email:order.recipient_email}});
  const {error:timelineError}=await db.from('timeline_events').insert({inquiry_id:order.inquiry_id,event_type:'supplier_order_confirmation_sent',visibility:'admin',actor_type:'admin',actor_user_id:user.id,metadata:{supplier_order_id:order.id,supplier_id:order.supplier_id,quote_id:order.customer_quote_id}});
  revalidatePath('/quotes/'+order.customer_quote_id);revalidatePath('/inquiries/'+order.inquiry_id);revalidatePath('/notifications');
  if(logError||timelineError)throw new Error('Supplier order was sent and recorded. Its activity log needs checking.');
  return {ok:true,alreadySent:false};
}
