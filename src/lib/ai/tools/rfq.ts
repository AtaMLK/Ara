import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireAdmin,requireInquiryAccess} from '../guards';

const draftSchema=z.object({inquiryId:z.string().uuid(),supplierId:z.string().uuid(),subject:z.string().min(1),body:z.string().min(1),recipientEmail:z.string().email(),senderEmail:z.string().email(),approvalRequired:z.boolean().default(true)});

export async function createRFQDraft(ctx:AIContext,input:unknown){
  const value=draftSchema.parse(input);
  const {supabase}=await requireInquiryAccess(ctx,value.inquiryId);
  const {data:candidate}=await supabase.from('supplier_candidates').select('status').eq('inquiry_id',value.inquiryId).eq('supplier_id',value.supplierId).single();
  if(candidate?.status!=='finalized') throw new ToolError('APPROVAL_REQUIRED','Supplier candidate list must be finalized before RFQ creation');
  const {data,error}=await supabase.from('rfqs').insert({
    inquiry_id:value.inquiryId,supplier_id:value.supplierId,status:'pending_approval',
    subject:value.subject,body:value.body,recipient_email:value.recipientEmail,sender_email:value.senderEmail,
    approval_required:value.approvalRequired
  }).select('*').single();
  if(error) throw new ToolError('CONFLICT',error.message);
  return data;
}

export async function approveRFQ(rfqId:string){
  const {supabase,user}=await requireAdmin();
  const {data,error}=await supabase.from('rfqs').update({status:'approved',approved_by:user.id,approved_at:new Date().toISOString()}).eq('id',rfqId).eq('status','pending_approval').select('*').single();
  if(error||!data) throw new ToolError('CONFLICT','RFQ is not awaiting approval or does not exist');
  return data;
}
