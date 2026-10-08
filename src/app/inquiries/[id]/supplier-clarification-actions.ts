'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/ai/guards';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getEmailProvider } from '@/lib/email/provider';

export async function approveSupplierClarificationReplyAction(formData: FormData) {
  const communicationId = String(formData.get('communicationId') ?? '');
  if (!communicationId) throw new Error('Communication ID is required');
  const { user } = await requireAdmin();
  const supabase = createSupabaseAdminClient();

  const { data: communication, error } = await supabase
    .from('communications')
    .select('id,inquiry_id,rfq_id,subject,metadata')
    .eq('id', communicationId)
    .eq('direction', 'incoming')
    .single();

  if (error || !communication?.rfq_id) throw new Error('Supplier communication not found');

  const metadata = communication.metadata && typeof communication.metadata === 'object' && !Array.isArray(communication.metadata)
    ? communication.metadata as Record<string, unknown>
    : {};
  const analysis = metadata.ai_analysis && typeof metadata.ai_analysis === 'object' && !Array.isArray(metadata.ai_analysis)
    ? metadata.ai_analysis as Record<string, unknown>
    : {};
  const draft = typeof analysis.supplier_reply_draft === 'string' ? analysis.supplier_reply_draft.trim() : '';
  const status = typeof analysis.admin_review_status === 'string' ? analysis.admin_review_status : '';

  if (!draft || status === 'sent') throw new Error('No pending supplier reply approval is available');

  const { data: rfq } = await supabase
    .from('rfqs')
    .select('id,rfq_code,subject,supplier_id')
    .eq('id', communication.rfq_id)
    .single();

  if (!rfq) throw new Error('RFQ not found');

  const { data: email } = await supabase
    .from('supplier_emails')
    .select('email,status,is_primary')
    .eq('supplier_id', rfq.supplier_id)
    .eq('status', 'active')
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!email?.email) throw new Error('No active supplier email found');

  const provider = getEmailProvider();
  const subject = rfq.subject?.startsWith('Re:') ? rfq.subject : `Re: ${rfq.subject ?? rfq.rfq_code}`;
  const html = `<p>Merhaba,</p><p>${escapeHtml(draft)}</p><p>İyi çalışmalar,<br/>Arya Automation</p>`;
  const sent = await provider.send({
    to: [email.email],
    subject,
    html,
    text: `Merhaba,\\n\\n${draft}\\n\\nİyi çalışmalar,\\nArya Automation`,
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'purchase-dep@aryaautomation.com',
    idempotencyKey: `admin-approved-clarification:${communication.id}`,
  });

  await supabase.from('communications').insert({
    inquiry_id: communication.inquiry_id,
    supplier_id: rfq.supplier_id,
    rfq_id: rfq.id,
    direction: 'outgoing',
    channel: 'email',
    provider_message_id: sent.providerMessageId ?? null,
    thread_id: sent.threadId ?? null,
    subject,
    body: html,
    sent_at: sent.sentAt ?? new Date().toISOString(),
    metadata: {
      type: 'customer_clarification_reply_to_supplier',
      source_communication_id: communication.id,
      approved_by: user.id,
      agent: 'ARAT Agent',
    },
  });

  await supabase.from('communications').update({
    metadata: {
      ...metadata,
      ai_analysis: {
        ...analysis,
        admin_review_status: 'sent',
      },
    },
  }).eq('id', communication.id);

  await supabase.from('timeline_events').insert({
    inquiry_id: communication.inquiry_id,
    event_type: 'supplier_clarification_reply_approved_and_sent',
    visibility: 'admin',
    actor_type: 'admin',
    actor_user_id: user.id,
    metadata: { source_communication_id: communication.id, rfq_id: rfq.id },
  });

  revalidatePath(`/inquiries/${communication.inquiry_id}`);
  return { ok: true };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char] ?? char));
}
