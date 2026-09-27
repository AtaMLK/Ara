import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireAdmin} from '../guards';

const sendSchema=z.object({rfqId:z.string().uuid()});

export async function sendApprovedRFQ(ctx:AIContext,input:unknown){
  const {rfqId}=sendSchema.parse(input);
  const {supabase}=await requireAdmin();
  const {data:rfq,error}=await supabase.from('rfqs').select('*').eq('id',rfqId).single();
  if(error||!rfq) throw new ToolError('NOT_FOUND','RFQ not found');
  if(rfq.status!=='approved') throw new ToolError('APPROVAL_REQUIRED','RFQ has not been approved');
  // Provider integration is intentionally isolated from the AI tool contract.
  // The email provider adapter will perform the actual send and return its provider message id.
  throw new ToolError('TRANSIENT','Email provider adapter is not configured yet');
}
