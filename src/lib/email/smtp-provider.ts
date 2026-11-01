import 'server-only';

import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { dispatchEmailOnce, type DispatchStore, type EmailDispatch } from './dispatch';
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
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });

    const attachments = await resolveAttachments(input.attachments);

    if (!input.idempotencyKey?.trim()) throw new ToolError('VALIDATION', 'A durable email key is required');
    const db = createSupabaseAdminClient();
    const from = input.from || process.env.SMTP_FROM || user;
    const payloadHash = createHash('sha256').update(JSON.stringify({
      from, to: input.to, subject: input.subject, html: input.html, text: input.text ?? null,
      attachments: attachments.map(attachment => ({
        filename: attachment.filename, contentType: attachment.contentType,
        hash: createHash('sha256').update(attachment.content).digest('hex'),
      })),
    })).digest('hex');
    const senderDomain = from.match(/@([a-z0-9.-]+)(?:>|$)/i)?.[1] ?? 'arat.invalid';
    const messageId = `<arat-${createHash('sha256').update(input.idempotencyKey).digest('hex')}@${senderDomain}>`;
    const store: DispatchStore = {
      async reserve(reservation) {
        const { data, error } = await db.from('email_dispatches').insert(reservation).select('*').single();
        if (error?.code === '23505') return null;
        if (error || !data) throw new Error('Could not reserve email delivery');
        return data as EmailDispatch;
      },
      async find(key) {
        const { data, error } = await db.from('email_dispatches').select('*').eq('idempotency_key', key).maybeSingle();
        if (error) throw new Error('Could not check email delivery');
        return data as EmailDispatch | null;
      },
      async sent(id, result) {
        const { data, error } = await db.from('email_dispatches').update({
          status: 'sent', provider_message_id: result.providerMessageId,
          thread_id: result.threadId ?? null, sent_at: result.sentAt, error_text: null,
        }).eq('id', id).eq('status', 'sending').select('id').single();
        if (error || !data) throw new Error('Could not record email receipt');
      },
      async uncertain(id) {
        const { data, error } = await db.from('email_dispatches').update({
          status: 'delivery_uncertain', error_text: 'Delivery was interrupted or its receipt could not be stored. Check the sent mailbox before any resend.',
        }).eq('id', id).eq('status', 'sending').select('id,inquiry_id,subject').maybeSingle();
        if (error) throw new Error('Could not record delivery uncertainty');
        if (!data) return;
        const { error: alertError } = await db.from('ai_alerts').insert({
          inquiry_id: input.inquiryId ?? null, record_type: 'email_dispatch', record_id: id,
          agent_id: 'orchestrator', alert_type: 'EMAIL_DELIVERY_UNCERTAIN',
          message: `Email delivery needs mailbox review: ${input.subject}. Do not resend automatically.`, priority: 'urgent',
        });
        if (alertError) throw new Error('Could not record delivery alert');
      },
    };
    try {
      return await dispatchEmailOnce({
        idempotency_key: input.idempotencyKey, payload_hash: payloadHash,
        inquiry_id: input.inquiryId ?? null, subject: input.subject, recipients: input.to, message_id: messageId,
      }, store, async () => {
        const result = await transport.sendMail({
          messageId, from, to: input.to, subject: input.subject,
          html: input.html, text: input.text, attachments,
          headers: { 'X-ARAT-Idempotency-Key': input.idempotencyKey },
        });

        if (result.rejected?.length || !result.accepted?.length) throw new Error('Not all recipients were accepted');
        return {
          providerMessageId: result.messageId,
          threadId: result.messageId,
          sentAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      throw new ToolError('CONFLICT', error instanceof Error ? error.message : 'Email delivery needs review');
    } finally {
      transport.close();
    }
  }
}

export function getSmtpEmailProvider(): EmailProvider {
  return new SmtpEmailProvider();
}
