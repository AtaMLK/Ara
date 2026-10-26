'use server';

import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/ai/guards';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';

export async function cancelRfqAction(rfqId:string,reason:string){
  const value=z.object({rfqId:z.string().uuid(),reason:z.string().trim().min(3).max(1000)}).parse({rfqId,reason});
  const {user}=await requireAdmin();
  const {data,error}=await createSupabaseAdminClient().rpc('cancel_rfq_preserving_history',{
    p_rfq_id:value.rfqId,p_actor_id:user.id,p_reason:value.reason,
  });
  if(error||!data)throw new Error(error?.message??'RFQ cancellation could not be recorded.');
  revalidatePath('/rfqs');revalidatePath('/inquiries/'+data.inquiry_id);
  return {ok:true,alreadyCancelled:!!data.already_cancelled};
}

// Old browser tabs must also preserve history when calling the former action.
export async function deleteRfqAction(rfqId:string){
  return cancelRfqAction(rfqId,'Cancelled by Admin from a legacy RFQ action.');
}
