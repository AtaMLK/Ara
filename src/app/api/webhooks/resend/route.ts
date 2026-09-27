import { NextRequest, NextResponse } from 'next/server';
import { ToolError } from '@/lib/errors';
import {
  getResendReceivedAttachments,
  getResendReceivedEmail,
  parseResendReceivedEvent,
  verifyResendWebhook,
} from '@/lib/email/resend-inbound';
import { processInboundEmail } from '@/lib/email/inbound';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    verifyResendWebhook(rawBody, request.headers);

    const event = JSON.parse(rawBody) as { type?: string; data?: { email_id?: string; message_id?: string | null } };
    const received = parseResendReceivedEvent(event);
    if (!received) return NextResponse.json({ ok: true });

    const email = await getResendReceivedEmail(received.emailId);
    const attachments = await getResendReceivedAttachments(received.emailId);
    const result = await processInboundEmail({
      providerMessageId: email.id,
      messageId: email.message_id ?? received.messageId ?? null,
      from: email.from,
      to: email.to ?? [],
      cc: email.cc ?? [],
      bcc: email.bcc ?? [],
      subject: email.subject ?? '',
      text: email.text ?? null,
      html: email.html ?? null,
      receivedAt: email.created_at ?? new Date().toISOString(),
      provider: 'resend',
      attachments,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ToolError) {
      const status =
        error.code === 'AUTHORIZATION' ? 401 :
        error.code === 'VALIDATION' ? 400 :
        500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ error: 'Inbound email processing failed' }, { status: 500 });
  }
}
