import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import {requireAdmin} from '../guards';

const matchSchema=z.object({communicationId:z.string().uuid(),rfqId:z.string().uuid().optional(),supplierId:z.string().uuid().optional(),inquiryId:z.string().uuid().optional(),evidence:z.record(z.string(),z.unknown()).default({})});

export async function matchIncomingEmail(input:unknown){
 const value=matchSchema.parse(input); const {supabase}=await requireAdmin();
 const {data:communication,error}=await supabase.from('communications').select('*').eq('id',value.communicationId).single();
 if(error||!communication) throw new ToolError('NOT_FOUND','Communication not found');
 if(communication.direction!=='incoming') throw new ToolError('VALIDATION','Communication is not incoming');
 if(!value.rfqId&&!value.supplierId&&!value.inquiryId){
  await supabase.from('unmatched_emails').insert({communication_id:value.communicationId,reason:'No reliable match evidence'});
  return {matched:false,status:'unmatched'};
 }
 const patch:any={};
 if(value.inquiryId) patch.inquiry_id=value.inquiryId;
 if(value.supplierId) patch.supplier_id=value.supplierId;
 if(value.rfqId) patch.rfq_id=value.rfqId;
 const {data:updated,error:updateError}=await supabase.from('communications').update(patch).eq('id',value.communicationId).select('*').single();
 if(updateError||!updated) throw new ToolError('CONFLICT','Email match failed');
 return {matched:true,communication:updated,evidence:value.evidence};
}
