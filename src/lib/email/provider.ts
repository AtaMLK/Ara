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
    const { data, error } = await supabase.storage
      .from('supplier-email-attachments')
      .download(attachment.storagePath);

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

class SmtpEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 465);
    const secure = (process.env.SMTP_SECURE ?? 'true').toLowerCase() === 'true';
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;

    if (!host || !user || !password) {
      throw new ToolError(
        'TRANSIENT',
        'SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required',
      );
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
  return new SmtpEmailProvider();
}
