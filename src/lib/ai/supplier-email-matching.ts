import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function normalizeSubject(value: string) {
  return value.trim().replace(/^(re|fw|fwd):\s*/i, '').replace(/^(re|fw|fwd):\s*/i, '').trim().toLowerCase();
}

export async function findSupplierRFQForEmail(input: { sender: string; subject: string }) {
  const supabase = createSupabaseAdminClient();
  const senderEmail = extractEmailAddress(input.sender);
  const subject = normalizeSubject(input.subject);

  const { data: emailRows } = await supabase
    .from('supplier_emails')
    .select('supplier_id,email')
    .ilike('email', senderEmail)
    .eq('status', 'active');

  const { data: contactRows } = await supabase
    .from('supplier_contacts')
    .select('supplier_id,email')
    .ilike('email', senderEmail)
    .eq('status', 'active');

  const supplierIds = [...new Set([
    ...(emailRows ?? []).map((row) => row.supplier_id),
    ...(contactRows ?? []).map((row) => row.supplier_id),
  ])];

  if (supplierIds.length !== 1) {
    return {
      matched: false as const,
      reason: supplierIds.length === 0 ? 'supplier_not_found' as const : 'multiple_supplier_identities' as const,
    };
  }

  const supplierId = supplierIds[0];

  const { data: rfqs } = await supabase
    .from('rfqs')
    .select('id,inquiry_id,supplier_id,subject,status')
    .eq('supplier_id', supplierId)
    .in('status', ['sent','completed'])
    .order('created_at', { ascending: false })
    .limit(50);

  const matches = (rfqs ?? []).filter((rfq) => normalizeSubject(rfq.subject ?? '') === subject);

  if (matches.length !== 1) {
    return {
      matched: false as const,
      reason: matches.length === 0 ? 'no_unique_rfq_subject_match' as const : 'multiple_rfq_subject_matches' as const,
    };
  }

  const rfq = matches[0];
  return { matched: true as const, supplierId, inquiryId: rfq.inquiry_id, rfq };
}

export { extractEmailAddress };
