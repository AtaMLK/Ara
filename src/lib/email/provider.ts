import 'server-only';

import nodemailer from 'nodemailer';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import type { EmailAttachment, EmailProvider, SendEmailInput, SendEmailResult } from './types';

async function resolveAttachments(attachments: EmailAttachment[] = []) {
  if (!attachments.length) return [];

  const supabase = createSupabaseAdminClient();
  const resolved: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }> = [];

  for (const attachment of attachments) {
    const { data, error } = await supabase.storage.from('supplier-email-attachments').download(attachment.storagePath);
    if (error || !data) {
      throw new ToolError('NOT_FOUND', `Email attachment could not be loaded: ${attachment.fileName}`);
    }

    resolved.push({
      filename: attachment.fileName,
      content: Buffer.from(await data.arrayBuffer()),
      contentType: attachment.mimeType,
    });
  }

  return resolved;
}

class ResendEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new ToolError('TRANSIENT', 'RESEND_API_KEY is not configured');

    const attachments = await resolveAttachments(input.attachments);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(attachments.length
          ? {
              attachments: attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.content.toString('base64'),
              })),
            }
          : {}),
      }),
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string };

    if (!response.ok || !payload.id) {
      throw new ToolError(
        response.status >= 500 ? 'TRANSIENT' : 'CONFLICT',
        payload.message || payload.error || 'Email provider rejected the message',
      );
    }

    return {
      providerMessageId: payload.id,
      sentAt: new Date().toISOString(),
    };
  }
}

class SmtpEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 465);
    const secure = (process.env.SMTP_SECURE ?? 'true').toLowerCase() === 'true';
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;

    if (!host || !user || !password) {
      throw new ToolError('TRANSIENT', 'SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required');
    }

    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
    });

    const attachments = await resolveAttachments(input.attachments);

    const result = await transport.sendMail({
      from: input.from || process.env.SMTP_FROM || user,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments,
      headers: input.idempotencyKey
        ? { 'X-ARAT-Idempotency-Key': input.idempotencyKey }
        : undefined,
    });

    return {
      providerMessageId: result.messageId,
      threadId: result.messageId,
      sentAt: new Date().toISOString(),
    };
  }
}

export function getEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER ?? 'smtp').toLowerCase();

  if (provider === 'resend') return new ResendEmailProvider();
  if (provider === 'smtp') return new SmtpEmailProvider();

  throw new ToolError('VALIDATION', `Unsupported email provider: ${provider}`);
}
