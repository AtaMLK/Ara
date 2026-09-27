import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import {requireAdmin} from '../guards';

const matchSchema=z.object({
  communicationId:z.string().uuid(),
  rfqId:z.string().uuid().optional(),
  supplierId:z.string().uuid().optional(),
  inquiryId:z.string().uuid().optional(),
  evidence:z.record(z.string(),z.unknown()).default({})
});

export async function matchIncomingEmail(input:unknown){
  const value=matchSchema.parse(input);
  const {supabase}=await requireAdmin();

  const {data:communication,error}=await supabase.from('communications').select('*').eq('id',value.communicationId).single();
  if(error||!communication) throw new ToolError('NOT_FOUND','Communication not found');
  if(communication.direction!=='incoming') throw new ToolError('VALIDATION','Communication is not incoming');

  if(value.rfqId){
    const {data:rfq}=await supabase.from('rfqs').select('id,inquiry_id,supplier_id,subject').eq('id',value.rfqId).single();
    if(!rfq) throw new ToolError('NOT_FOUND','RFQ not found');

    if(value.supplierId && value.supplierId!==rfq.supplier_id) {
      throw new ToolError('CONFLICT','Supplier does not match RFQ');
    }
    if(value.inquiryId && value.inquiryId!==rfq.inquiry_id) {
      throw new ToolError('CONFLICT','Inquiry does not match RFQ');
    }

    const patch={rfq_id:rfq.id,inquiry_id:rfq.inquiry_id,supplier_id:rfq.supplier_id};
    const {data:updated,error:updateError}=await supabase.from('communications').update(patch).eq('id',value.communicationId).select('*').single();
    if(updateError||!updated) throw new ToolError('CONFLICT','Email match failed');
    return {matched:true,match_type:'rfq_reference',communication:updated,evidence:value.evidence};
  }

  if(value.supplierId && value.inquiryId){
    const {data:rfqs}=await supabase.from('rfqs').select('id,inquiry_id,supplier_id,subject').eq('inquiry_id',value.inquiryId).eq('supplier_id',value.supplierId);
    const normalizedSubject=(communication.subject??'').trim().toLowerCase();
    const subjectMatch=(rfqs??[]).filter((r)=>r.subject?.trim().toLowerCase()===normalizedSubject);
    if(subjectMatch.length===1){
      const rfq=subjectMatch[0];
      const {data:updated,error:updateError}=await supabase.from('communications').update({rfq_id:rfq.id,inquiry_id:rfq.inquiry_id,supplier_id:rfq.supplier_id}).eq('id',value.communicationId).select('*').single();
      if(updateError||!updated) throw new ToolError('CONFLICT','Email match failed');
      return {matched:true,match_type:'supplier_subject',communication:updated,evidence:value.evidence};
    }
  }

  await supabase.from('unmatched_emails').insert({
    communication_id:value.communicationId,
    reason:'No unique RFQ reference or reliable supplier + subject match'
  });
  return {matched:false,status:'unmatched'};
}
