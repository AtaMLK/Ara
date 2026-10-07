import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function normalizeSubject(value: string) {
  return value.trim().replace(/^(re|fw|fwd):\s*/i, '').trim().toLowerCase();
}

export type SupplierEmailMatchInput = {
  sender: string;
  subject: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
};

function normalizeMessageId(value: string | null | undefined) {
  return value?.trim().replace(/^<|>$/g, '').toLowerCase() || null;
}

function extractMessageIds(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(/\s+/)
    .map((item) => normalizeMessageId(item))
    .filter((item): item is string => Boolean(item));
}

export async function findSupplierRFQForEmail(input: SupplierEmailMatchInput) {
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
    .select('id,inquiry_id,supplier_id,rfq_code,subject,status,created_at')
    .eq('supplier_id', supplierId)
    .in('status', ['sent', 'completed'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (!rfqs?.length) {
    return { matched: false as const, reason: 'no_supplier_rfq_found' as const };
  }

  // 1) Match the actual RFQ code used by the current system.
  // Example: RFQ-20261006-4E2C8A.
  const rfqCodeMatches = (input.subject.match(/\bRFQ-\d{8}-[A-Z0-9]{6,12}\b/i)?.[0] ?? '').toLowerCase();
  if (rfqCodeMatches) {
    const matches = rfqs.filter((rfq) => String(rfq.rfq_code ?? '').toLowerCase() === rfqCodeMatches);
    if (matches.length === 1) {
      const rfq = matches[0];
      return { matched: true as const, supplierId, inquiryId: rfq.inquiry_id, rfq };
    }
    if (matches.length > 1) {
      return { matched: false as const, reason: 'multiple_rfq_token_matches' as const };
    }
  }

  // 2) Match standard email threading headers against the original RFQ email.
  const incomingThreadIds = new Set([
    normalizeMessageId(input.messageId),
    normalizeMessageId(input.inReplyTo),
    ...extractMessageIds(input.references),
  ].filter((value): value is string => Boolean(value)));

  if (incomingThreadIds.size) {
    const rfqIds = rfqs.map((rfq) => rfq.id);
    const { data: outgoingCommunications } = await supabase
      .from('communications')
      .select('rfq_id,thread_id,metadata,created_at')
      .in('rfq_id', rfqIds)
      .eq('direction', 'outgoing')
      .eq('channel', 'email')
      .order('created_at', { ascending: false })
      .limit(100);

    const headerMatches = (outgoingCommunications ?? []).filter((communication) => {
      const candidates = new Set<string>();
      const threadId = normalizeMessageId(communication.thread_id);
      if (threadId) candidates.add(threadId);

      const metadata = communication.metadata;
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
        const messageId = normalizeMessageId(
          typeof metadata.message_id === 'string' ? metadata.message_id : null,
        );
        if (messageId) candidates.add(messageId);
      }

      return [...candidates].some((id) => incomingThreadIds.has(id));
    });

    const matchedRfqIds = [...new Set(
      headerMatches.map((communication) => communication.rfq_id).filter(Boolean),
    )];

    if (matchedRfqIds.length === 1) {
      const rfq = rfqs.find((item) => item.id === matchedRfqIds[0]);
      if (rfq) {
        return { matched: true as const, supplierId, inquiryId: rfq.inquiry_id, rfq };
      }
    }

    if (matchedRfqIds.length > 1) {
      return { matched: false as const, reason: 'multiple_rfq_header_matches' as const };
    }
  }

  // 3) Exact normalized subject match.
  const matches = rfqs.filter((rfq) => normalizeSubject(rfq.subject ?? '') === subject);

  if (matches.length === 1) {
    const rfq = matches[0];
    return { matched: true as const, supplierId, inquiryId: rfq.inquiry_id, rfq };
  }

  if (matches.length > 1) {
    return { matched: false as const, reason: 'multiple_rfq_subject_matches' as const };
  }

  // 4) If the supplier has exactly one recent sent RFQ, safely use it as a fallback.
  // This covers suppliers who reply with a completely rewritten subject while avoiding
  // guessing when several active RFQs exist.
  const recentRfqs = rfqs.filter((rfq) => {
    const createdAt = new Date(rfq.created_at).getTime();
    return Number.isFinite(createdAt) && Date.now() - createdAt <= 30 * 24 * 60 * 60 * 1000;
  });

  if (recentRfqs.length === 1) {
    const rfq = recentRfqs[0];
    return { matched: true as const, supplierId, inquiryId: rfq.inquiry_id, rfq };
  }

  return { matched: false as const, reason: 'no_unique_rfq_match' as const };
}

export { extractEmailAddress };
