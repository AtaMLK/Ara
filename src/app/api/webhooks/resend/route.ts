import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import {
  findCustomerClarificationForEmail,
  applyCustomerClarificationAnswer,
  cleanEmailReply,
  extractEmailAddress,
} from '@/lib/ai/clarification-replies';
import {
  getResendReceivedEmail,
  parseResendReceivedEvent,
  verifyResendWebhook,
} from '@/lib/email/resend-inbound';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    verifyResendWebhook(rawBody, request.headers);

    const event = JSON.parse(rawBody);
    const received = parseResendReceivedEvent(event);
    if (!received) return NextResponse.json({ ok: true });

    const email = await getResendReceivedEmail(received.emailId);
    const supabase = createSupabaseAdminClient();

    const { data: existing } = await supabase
      .from('communications')
      .select('id,inquiry_id,customer_id,metadata')
      .eq('provider_message_id', email.id)
      .maybeSingle();

    if (existing) {
      const clarificationId =
        typeof existing.metadata?.clarification_id === 'string'
          ? existing.metadata.clarification_id
          : null;

      if (existing.inquiry_id && clarificationId) {
        const { data: customer } = await supabase
          .from('customers')
          .select('user_id')
          .eq('id', existing.customer_id)
          .maybeSingle();

        await applyCustomerClarificationAnswer({
          inquiryId: existing.inquiry_id,
          clarificationId,
          answer: cleanEmailReply(email.text, email.html),
          customerUserId: customer?.user_id ?? null,
          communicationId: existing.id,
        });
      }

      return NextResponse.json({ ok: true, duplicate: true });
    }

    const subject = email.subject?.trim() ?? '';
    const senderEmail = extractEmailAddress(email.from);
    const match = await findCustomerClarificationForEmail({
      sender: email.from,
      subject,
    });

    const { data: communication, error: communicationError } = await supabase
      .from('communications')
      .insert({
        inquiry_id: match.matched ? match.inquiryId : null,
        customer_id: match.matched ? match.customer.id : null,
        direction: 'incoming',
        channel: 'email',
        provider_message_id: email.id,
        subject,
        body: email.text ?? cleanEmailReply(undefined, email.html),
        received_at: email.created_at ?? new Date().toISOString(),
        metadata: {
          provider: 'resend',
          inbound_email_id: email.id,
          message_id: email.message_id ?? received.messageId,
          from: senderEmail,
          matched: match.matched,
          match_reason: match.matched ? null : match.reason,
          clarification_id: match.matched ? match.clarification.id : null,
        },
      })
      .select('id')
      .single();

    if (communicationError || !communication) {
      throw new ToolError('CONFLICT', communicationError?.message ?? 'Could not store incoming email');
    }

    if (!match.matched) {
      await supabase.from('unmatched_emails').insert({
        communication_id: communication.id,
        reason: `Customer clarification email could not be matched: ${match.reason}`,
      });
      await supabase.from('ai_alerts').insert({
        agent_id: 'email_response',
        alert_type: 'UNMATCHED_CUSTOMER_EMAIL',
        message: `Incoming customer email from ${senderEmail} could not be safely matched to a pending clarification.`,
        priority: 'normal',
      });
      return NextResponse.json({ ok: true, matched: false });
    }

    const answer = cleanEmailReply(email.text, email.html);
    if (!answer) {
      await supabase.from('ai_alerts').insert({
        inquiry_id: match.inquiryId,
        record_type: 'communication',
        record_id: communication.id,
        agent_id: 'email_response',
        alert_type: 'EMPTY_CUSTOMER_EMAIL_REPLY',
        message: 'Customer email reply contained no usable answer text.',
        priority: 'normal',
      });
      return NextResponse.json({ ok: true, matched: true, answered: false });
    }

    await applyCustomerClarificationAnswer({
      inquiryId: match.inquiryId,
      clarificationId: match.clarification.id,
      answer,
      customerUserId: match.customer.user_id,
      communicationId: communication.id,
    });

    return NextResponse.json({ ok: true, matched: true, answered: true });
  } catch (error) {
    if (error instanceof ToolError) {
      const status = error.code === 'AUTHORIZATION' ? 401 : error.code === 'VALIDATION' ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ error: 'Inbound email processing failed' }, { status: 500 });
  }
}
