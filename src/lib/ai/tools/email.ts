import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import {requireAdmin} from '../guards';
import {getEmailProvider} from '@/lib/email/provider';

const sendSchema=z.object({rfqId:z.string().uuid()});

export async function sendApprovedRFQ(input:unknown){
 const {rfqId}=sendSchema.parse(input); const {supabase}=await requireAdmin();
 const {data:rfq,error}=await supabase.from('rfqs').select('*').eq('id',rfqId).single();
 if(error||!rfq) throw new ToolError('NOT_FOUND','RFQ not found');
 if(rfq.status!=='approved') throw new ToolError('APPROVAL_REQUIRED','RFQ has not been approved');
 const result=await getEmailProvider().send({from:rfq.sender_email,to:[rfq.recipient_email],subject:rfq.subject,html:rfq.body});
 const {data:communication,error:ce}=await supabase.from('communications').insert({inquiry_id:rfq.inquiry_id,supplier_id:rfq.supplier_id,rfq_id:rfq.id,direction:'outgoing',channel:'email',provider_message_id:result.providerMessageId,thread_id:result.threadId,subject:rfq.subject,body:rfq.body,sent_at:result.sentAt}).select('*').single();
 if(ce) throw new ToolError('TRANSIENT',ce.message);
 const {data:updated,error:ue}=await supabase.from('rfqs').update({status:'sent',sent_at:result.sentAt}).eq('id',rfq.id).eq('status','approved').select('*').single();
 if(ue||!updated) throw new ToolError('CONFLICT','RFQ state changed while sending');
 return {rfq:updated,communication};
}
