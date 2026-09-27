import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import { findCustomerClarificationForEmail, applyCustomerClarificationAnswer, cleanEmailReply, extractEmailAddress as extractCustomerEmail } from '@/lib/ai/clarification-replies';
import { findSupplierRFQForEmail } from '@/lib/ai/supplier-email-matching';
import { getResendReceivedEmail, parseResendReceivedEvent, verifyResendWebhook } from '@/lib/email/resend-inbound';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    verifyResendWebhook(rawBody, request.headers);
    const event = JSON.parse(rawBody) as { type?: string; data?: { attachments?: unknown[] } };
    const received = parseResendReceivedEvent(event);
    if (!received) return NextResponse.json({ ok: true });

    const email = await getResendReceivedEmail(received.emailId);
    const supabase = createSupabaseAdminClient();
    const { data: existing } = await supabase.from('communications').select('id').eq('provider_message_id', email.id).maybeSingle();
    if (existing) return NextResponse.json({ ok: true, duplicate: true });

    const subject = email.subject?.trim() ?? '';
    const customerMatch = await findCustomerClarificationForEmail({ sender: email.from, subject });
    if (customerMatch.matched) {
      const { data: communication, error } = await supabase.from('communications').insert({
        inquiry_id: customerMatch.inquiryId, customer_id: customerMatch.customer.id, direction: 'incoming', channel: 'email',
        provider_message_id: email.id, subject, body: email.text ?? cleanEmailReply(undefined, email.html),
        received_at: email.created_at ?? new Date().toISOString(),
        metadata: { provider: 'resend', inbound_email_id: email.id, message_id: email.message_id ?? received.messageId, from: extractCustomerEmail(email.from), type: 'customer_clarification_reply', clarification_id: customerMatch.clarification.id },
      }).select('id').single();
      if (error || !communication) throw new ToolError('CONFLICT', error?.message ?? 'Could not store customer email');
      const answer = cleanEmailReply(email.text, email.html);
      if (!answer) {
        await supabase.from('ai_alerts').insert({ inquiry_id: customerMatch.inquiryId, record_type: 'communication', record_id: communication.id, agent_id: 'email_response', alert_type: 'EMPTY_CUSTOMER_EMAIL_REPLY', message: 'Customer email reply contained no usable answer text.', priority: 'normal' });
        return NextResponse.json({ ok: true, matched: true, answered: false });
      }
      await applyCustomerClarificationAnswer({ inquiryId: customerMatch.inquiryId, clarificationId: customerMatch.clarification.id, answer, customerUserId: customerMatch.customer.user_id, communicationId: communication.id });
      return NextResponse.json({ ok: true, matched: true, type: 'customer_clarification', answered: true });
    }

    const supplierMatch = await findSupplierRFQForEmail({ sender: email.from, subject });
    if (!supplierMatch.matched) {
      const { data: communication, error } = await supabase.from('communications').insert({
        direction: 'incoming', channel: 'email', provider_message_id: email.id, subject,
        body: email.text ?? cleanEmailReply(undefined, email.html), received_at: email.created_at ?? new Date().toISOString(),
        metadata: { provider: 'resend', inbound_email_id: email.id, message_id: email.message_id ?? received.messageId, from: extractCustomerEmail(email.from), type: 'unmatched_incoming_email' },
      }).select('id').single();
      if (error || !communication) throw new ToolError('CONFLICT', error?.message ?? 'Could not store incoming email');
      await supabase.from('unmatched_emails').insert({ communication_id: communication.id, reason: 'Incoming email could not be safely matched to a customer clarification or supplier RFQ: ' + supplierMatch.reason });
      await supabase.from('ai_alerts').insert({ agent_id: 'email_response', alert_type: 'UNMATCHED_INCOMING_EMAIL', message: 'Incoming email from ' + extractCustomerEmail(email.from) + ' could not be uniquely matched to a customer clarification or supplier RFQ.', priority: 'normal' });
      return NextResponse.json({ ok: true, matched: false, reason: supplierMatch.reason });
    }

    const body = email.text ?? cleanEmailReply(undefined, email.html);
    const attachments = event.data?.attachments ?? [];
    const { data: communication, error: communicationError } = await supabase.from('communications').insert({
      inquiry_id: supplierMatch.inquiryId, supplier_id: supplierMatch.supplierId, rfq_id: supplierMatch.rfq.id,
      direction: 'incoming', channel: 'email', provider_message_id: email.id, subject, body,
      received_at: email.created_at ?? new Date().toISOString(),
      metadata: { provider: 'resend', inbound_email_id: email.id, message_id: email.message_id ?? received.messageId, from: extractCustomerEmail(email.from), type: 'supplier_rfq_reply', attachment_count: attachments.length },
    }).select('id').single();
    if (communicationError || !communication) throw new ToolError('CONFLICT', communicationError?.message ?? 'Could not store supplier email');

    const { error: responseError } = await supabase.from('supplier_responses').insert({
      communication_id: communication.id, supplier_id: supplierMatch.supplierId, inquiry_id: supplierMatch.inquiryId, status: 'received',
      raw_extraction: { source: 'supplier_email', subject, body, metadata: { inbound_email_id: email.id, message_id: email.message_id ?? received.messageId }, extraction_policy: 'explicit_values_only' },
      attachments,
    });
    if (responseError) throw new ToolError('CONFLICT', responseError.message);
    await supabase.from('timeline_events').insert({ inquiry_id: supplierMatch.inquiryId, event_type: 'supplier_email_received', visibility: 'admin', actor_type: 'system', metadata: { communication_id: communication.id, supplier_id: supplierMatch.supplierId, rfq_id: supplierMatch.rfq.id } });
    return NextResponse.json({ ok: true, matched: true, type: 'supplier_rfq_reply', inquiryId: supplierMatch.inquiryId, rfqId: supplierMatch.rfq.id, communicationId: communication.id });
  } catch (error) {
    if (error instanceof ToolError) { const status = error.code === 'AUTHORIZATION' ? 401 : error.code === 'VALIDATION' ? 400 : 500; return NextResponse.json({ error: error.message }, { status }); }
    return NextResponse.json({ error: 'Inbound email processing failed' }, { status: 500 });
  }
}