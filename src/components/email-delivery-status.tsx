import 'server-only';
import {requireAdminPage} from '@/lib/data/admin';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {T} from '@/components/language';

export async function EmailDeliveryStatus({inquiryId,idempotencyKey,keyPrefix}:{inquiryId?:string;idempotencyKey?:string;keyPrefix?:string}){
  await requireAdminPage();
  let query=createSupabaseAdminClient().from('email_dispatches').select('id,subject,recipients,status,provider_message_id,message_id,error_text')
    .order('created_at',{ascending:false}).limit(20);
  if(inquiryId)query=query.eq('inquiry_id',inquiryId);
  if(keyPrefix)query=query.like('idempotency_key',keyPrefix+'%');
  if(idempotencyKey)query=query.eq('idempotency_key',idempotencyKey);
  else query=query.in('status',['sending','delivery_uncertain']);
  const {data,error}=await query;
  if(error)return <div className="error-box"><T>Email delivery status could not be loaded. Check the sent mailbox before resending.</T></div>;
  if(!data?.length)return null;
  return <section className="section"><h3><T>Email delivery status</T></h3>{data.map(row=><div className="list-item" key={row.id}><div>
    <strong>{row.subject}</strong><p>{row.recipients.join(', ')}</p>
    <p><T>{row.status==='sent'?'Accepted by the mail server':row.status==='sending'?'Sending — do not resend':'Delivery uncertain — check the sent mailbox before any resend'}</T></p>
    <small><T>Message ID: </T>{row.provider_message_id||row.message_id}</small>
  </div></div>)}</section>;
}
