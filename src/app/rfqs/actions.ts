'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/ai/guards';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function deleteRfqAction(rfqId: string) {
  const { user } = await requireAdmin();
  const admin = createSupabaseAdminClient();

  const { data: rfq, error: rfqError } = await admin
    .from('rfqs')
    .select('id,rfq_code,status')
    .eq('id', rfqId)
    .single();

  if (rfqError || !rfq) throw new Error('RFQ not found.');

  // Keep the communication history, but detach it from the deleted RFQ.
  const { error: communicationError } = await admin
    .from('communications')
    .update({ rfq_id: null })
    .eq('rfq_id', rfqId);

  if (communicationError) throw new Error(communicationError.message);

  const { error: itemsError } = await admin
    .from('rfq_items')
    .delete()
    .eq('rfq_id', rfqId);

  if (itemsError) throw new Error(itemsError.message);

  const { error: deleteError } = await admin
    .from('rfqs')
    .delete()
    .eq('id', rfqId);

  if (deleteError) throw new Error(deleteError.message);

  await admin.from('audit_logs').insert({
    actor_user_id: user.id,
    action: 'rfq_deleted',
    entity_type: 'rfq',
    entity_id: rfqId,
    metadata: {
      rfq_code: rfq.rfq_code,
      status: rfq.status,
    },
  });

  revalidatePath('/rfqs');
  return { ok: true };
}
