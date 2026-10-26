import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function normalizeSubject(value: string) {
  return value.trim().replace(/^(?:(?:re|fw|fwd):\s*)+/i, '').trim().toLowerCase();
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

function extractMessageIds(value: string | string[] | null | undefined) {
  if (!value) return [];

  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap((item) => String(item).split(/\s+/))
    .map((item) => normalizeMessageId(item))
    .filter((item): item is string => Boolean(item));
}

type MatchedRfq = {id:string;inquiry_id:string;supplier_id:string;rfq_code:string|null;subject:string|null;status:string;created_at:string;recipient_email?:string|null};
function matchedSupplierReply(rfq:MatchedRfq,senderEmail:string,matchMethod='known_supplier_rfq') {
  const originalRecipientEmail=rfq.recipient_email ? extractEmailAddress(rfq.recipient_email) : null;
  return {matched:true as const,supplierId:rfq.supplier_id,inquiryId:rfq.inquiry_id,rfq,matchMethod,
    senderEmail,originalRecipientEmail,senderChanged:Boolean(originalRecipientEmail && originalRecipientEmail!==senderEmail),
    senderDomainMatch:Boolean(originalRecipientEmail && originalRecipientEmail.split('@')[1]===senderEmail.split('@')[1])};
}

export async function findSupplierRFQForEmail(input: SupplierEmailMatchInput) {
  const supabase = createSupabaseAdminClient();
  const senderEmail = extractEmailAddress(input.sender);
  const subject = normalizeSubject(input.subject);
  const references=new Set((input.subject.match(/\bRFQ-\d{8}-[A-Z0-9]{6,12}\b/gi) ?? []).map(value=>value.toLowerCase()));
  if(references.size>1) return {matched:false as const,reason:'multiple_rfq_references' as const};

  const { data: emailRows, error: emailError } = await supabase
    .from('supplier_emails')
    .select('supplier_id,email')
    .ilike('email', senderEmail.replace(/[%_\\]/g, '\\$&'))
    .eq('status', 'active');

  const { data: contactRows, error: contactError } = await supabase
    .from('supplier_contacts')
    .select('supplier_id,email')
    .ilike('email', senderEmail.replace(/[%_\\]/g, '\\$&'))
    .eq('status', 'active');
  if (emailError || contactError) throw new ToolError('TRANSIENT', emailError?.message ?? contactError!.message);

  const supplierIds = [...new Set([
    ...(emailRows ?? []).map((row) => row.supplier_id),
    ...(contactRows ?? []).map((row) => row.supplier_id),
  ])];

  // A unique RFQ/thread identifies the company even when the reply mailbox is
  // already stored under another supplier record for that same company.
  const alternateMatch = await matchAlternateSupplierMailbox(input, senderEmail);
  if (alternateMatch) return alternateMatch;
  if (supplierIds.length === 0) {
    return {
      matched: false as const,
      reason: 'supplier_not_found' as const,
    };
  }

  const { data: rfqs, error: rfqError } = await supabase
    .from('rfqs')
    .select('id,inquiry_id,supplier_id,rfq_code,subject,status,created_at,recipient_email')
    .in('supplier_id', supplierIds)
    .in('status', ['sent', 'completed'])
    .order('created_at', { ascending: false })
    .limit(50);
  if (rfqError) throw new ToolError('TRANSIENT', rfqError.message);

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
      return matchedSupplierReply(rfq,senderEmail);
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
      .select('rfq_id,provider_message_id,thread_id,metadata,created_at')
      .in('rfq_id', rfqIds)
      .eq('direction', 'outgoing')
      .eq('channel', 'email')
      .order('created_at', { ascending: false })
      .limit(100);

    const headerMatches = (outgoingCommunications ?? []).filter((communication) => {
      const candidates = new Set<string>();
      const threadId = normalizeMessageId(communication.thread_id);
      if (threadId) candidates.add(threadId);
      const providerId = normalizeMessageId(communication.provider_message_id);
      if (providerId) candidates.add(providerId);

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
        return matchedSupplierReply(rfq,senderEmail);
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
    return matchedSupplierReply(rfq,senderEmail);
  }

  if (matches.length > 1) {
    return { matched: false as const, reason: 'multiple_rfq_subject_matches' as const };
  }

  // A shared mailbox needs a unique reference, thread or exact subject.
  if (supplierIds.length > 1) return {matched:false as const,reason:'multiple_supplier_identities' as const};

  // 4) If the supplier has exactly one recent sent RFQ, safely use it as a fallback.
  // This covers suppliers who reply with a completely rewritten subject while avoiding
  // guessing when several active RFQs exist.
  const recentRfqs = rfqs.filter((rfq) => {
    const createdAt = new Date(rfq.created_at).getTime();
    return Number.isFinite(createdAt) && Date.now() - createdAt <= 30 * 24 * 60 * 60 * 1000;
  });

  if (recentRfqs.length === 1) {
    const rfq = recentRfqs[0];
    return matchedSupplierReply(rfq,senderEmail);
  }

  return { matched: false as const, reason: 'no_unique_rfq_match' as const };
}

const sharedEmailDomains = new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','yahoo.co.uk','aol.com','icloud.com','me.com','proton.me','protonmail.com','mail.com','gmx.com','gmx.de','yandex.com','yandex.ru','qq.com','163.com','126.com']);

/** An alternate sender needs both a unique RFQ reference and a known company domain. */
async function matchAlternateSupplierMailbox(input: SupplierEmailMatchInput, senderEmail: string) {
  const supabase = createSupabaseAdminClient();
  const senderDomain = senderEmail.split('@')[1];
  if (!senderDomain || sharedEmailDomains.has(senderDomain)) return null;
  const token = input.subject.match(/\bRFQ-\d{8}-[A-Z0-9]{6,12}\b/i)?.[0]?.toUpperCase();
  const ids = extractMessageIds([input.inReplyTo ?? '', ...(input.references ?? [])]);
  const variants = [...new Set(ids.flatMap(id => [id, `<${id}>`]))];
  const rfqIds = new Set<string>();
  if (variants.length) {
    const threadQueries = await Promise.all(['provider_message_id','thread_id','metadata->>message_id'].map(column =>
      supabase.from('communications').select('rfq_id').eq('direction','outgoing').eq('channel','email').in(column, variants).not('rfq_id','is',null),
    ));
    for (const result of threadQueries) {
      if (result.error) throw new ToolError('TRANSIENT', result.error.message);
      for (const row of result.data ?? []) if (row.rfq_id) rfqIds.add(row.rfq_id);
    }
  }
  const query = supabase.from('rfqs').select('id,inquiry_id,supplier_id,rfq_code,subject,status,created_at,recipient_email').in('status',['sent','completed']);
  if (rfqIds.size) query.in('id',[...rfqIds]);
  else if (token) query.eq('rfq_code',token);
  else return null;
  const { data: rfqs, error } = await query.limit(2);
  if (error) throw new ToolError('TRANSIENT',error.message);
  if (rfqs?.length !== 1) return null;
  const rfq = rfqs[0];
  if (token && String(rfq.rfq_code).toUpperCase() !== token) return null;
  const [emails, contacts] = await Promise.all([
    supabase.from('supplier_emails').select('email').eq('supplier_id',rfq.supplier_id).eq('status','active'),
    supabase.from('supplier_contacts').select('email').eq('supplier_id',rfq.supplier_id).eq('status','active'),
  ]);
  if (emails.error || contacts.error) throw new ToolError('TRANSIENT',emails.error?.message ?? contacts.error!.message);
  const knownAddresses = [rfq.recipient_email,...(emails.data ?? []).map(row => row.email),...(contacts.data ?? []).map(row => row.email)];
  const belongsToCompany = knownAddresses.some(address => typeof address === 'string' && extractEmailAddress(address).split('@')[1] === senderDomain);
  if (!belongsToCompany) return null;
  return matchedSupplierReply(rfq,senderEmail,extractEmailAddress(rfq.recipient_email ?? '')===senderEmail ? 'known_supplier_rfq' : 'alternate_sender_company_domain_and_rfq_reference');
}

export { extractEmailAddress };
