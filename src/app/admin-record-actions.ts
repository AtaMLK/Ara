'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/ai/guards';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function softDeleteSupplierAction(supplierId: string) {
  const { user } = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data: supplier, error } = await admin
    .from('suppliers')
    .select('id,legal_name,deleted_at')
    .eq('id', supplierId)
    .single();

  if (error || !supplier) throw new Error('Supplier not found.');
  if (supplier.deleted_at) return { ok: true };

  const { error: updateError } = await admin
    .from('suppliers')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', supplierId);

  if (updateError) throw new Error(updateError.message);

  await admin.from('audit_logs').insert({
    actor_type: 'admin',
    actor_user_id: user.id,
    action: 'supplier_soft_deleted',
    record_type: 'supplier',
    record_id: supplierId,
    before_data: { id: supplier.id, legal_name: supplier.legal_name, deleted_at: null },
    after_data: { id: supplier.id, legal_name: supplier.legal_name, deleted_at: now },
  });

  revalidatePath('/suppliers');
  revalidatePath('/rfqs');
  return { ok: true };
}

export async function softDeleteInquiryAction(inquiryId: string) {
  const { user } = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data: inquiry, error } = await admin
    .from('inquiries')
    .select('id,reference,title,deleted_at')
    .eq('id', inquiryId)
    .single();

  if (error || !inquiry) throw new Error('Inquiry not found.');
  if (inquiry.deleted_at) return { ok: true };

  const { error: updateError } = await admin
    .from('inquiries')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', inquiryId);

  if (updateError) throw new Error(updateError.message);

  await admin.from('audit_logs').insert({
    actor_type: 'admin',
    actor_user_id: user.id,
    action: 'inquiry_soft_deleted',
    record_type: 'inquiry',
    record_id: inquiryId,
    before_data: { id: inquiry.id, reference: inquiry.reference, deleted_at: null },
    after_data: { id: inquiry.id, reference: inquiry.reference, deleted_at: now },
  });

  revalidatePath('/inquiries');
  revalidatePath('/rfqs');
  return { ok: true };
}
