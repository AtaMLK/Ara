'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/ai/guards';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
export async function retryFailedAutomationAction(input:{inquiryId:string;executionId:string}) {
  const value=z.object({inquiryId:z.string().uuid(),executionId:z.string().uuid()}).parse(input);
  const {user}=await requireAdmin(),db=createSupabaseAdminClient();
  const {data:inquiry}=await db.from('inquiries').select('id,status').eq('id',value.inquiryId).single();
  if(!inquiry||['converted','closed','no_suitable_supplier'].includes(inquiry.status))throw new Error('This request is not eligible for recovery.');
  const {data,error}=await db.from('ai_executions').update({status:'queued',attempt_count:0,error_code:null,error_message:null,started_at:null,completed_at:null})
    .eq('id',value.executionId).eq('inquiry_id',value.inquiryId).eq('status','failed').select('id').maybeSingle();
  if(error||!data)throw new Error('Only a failed automation stage can be retried.');
  await db.from('audit_logs').insert({actor_type:'admin',actor_user_id:user.id,action:'failed_automation_requeued',record_type:'ai_execution',record_id:data.id,after_data:{status:'queued'}});
  revalidatePath('/inquiries/'+value.inquiryId);return {ok:true};
}
