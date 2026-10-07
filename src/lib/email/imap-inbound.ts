import 'server-only';

import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { processInboundEmail, type InboundEmailAttachment } from './inbound';
import { ToolError } from '@/lib/errors';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_SIZE = 25 * 1024 * 1024;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new ToolError('VALIDATION', `${name} is not configured`);
  return value;
}

function toAddressList(value: ParsedMail['to']) {
  if (!value) return [];
  return value.value.map((item) => item.address || item.name || '').filter(Boolean);
}

function toSingleAddress(value: ParsedMail['from']) {
  const first = value?.value?.[0];
  return first?.address || first?.name || '';
}

function attachmentMimeType(contentType: string | undefined, fileName: string) {
  if (contentType) return contentType.split(';')[0].trim();
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  return 'application/octet-stream';
}

function normalizeAttachmentName(value: string) {
  return value.replace(/[\\/\0]/g, '_').slice(0, 180) || 'attachment';
}

export async function pollImapInbox() {
  const host = required('IMAP_HOST');
  const user = required('IMAP_USER');
  const password = required('IMAP_PASSWORD');
  const port = Number(process.env.IMAP_PORT ?? 993);
  const secure = (process.env.IMAP_SECURE ?? 'true').toLowerCase() === 'true';
  const mailbox = process.env.IMAP_MAILBOX ?? 'INBOX';

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass: password },
    logger: false,
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  await client.connect();

  try {
    const lock = await client.getMailboxLock(mailbox);

    try {
      for await (const message of client.fetch(
        { seen: false },
        { uid: true, source: true, internalDate: true },
      )) {
        try {
          if (!message.source) {
            failed += 1;
            continue;
          }

          const parsed = await simpleParser(message.source);
          const messageId =
            parsed.messageId?.trim() ||
            `imap:${mailbox}:${message.uid}:${message.internalDate?.toISOString() ?? 'unknown'}`;

          const attachments: InboundEmailAttachment[] = [];
          let totalAttachmentSize = 0;

          for (const attachment of parsed.attachments) {
            const content = Buffer.isBuffer(attachment.content)
              ? attachment.content
              : Buffer.from(attachment.content);
            const size = content.byteLength;
            const fileName = normalizeAttachmentName(attachment.filename || 'attachment');

            if (size <= 0 || size > MAX_ATTACHMENT_SIZE) {
              throw new ToolError('VALIDATION', `Inbound attachment must be between 1 byte and 10 MB: ${fileName}`);
            }

            totalAttachmentSize += size;
            if (totalAttachmentSize > MAX_TOTAL_ATTACHMENT_SIZE) {
              throw new ToolError('VALIDATION', 'Total inbound email attachment size must not exceed 25 MB');
            }

            attachments.push({
              fileName,
              mimeType: attachmentMimeType(attachment.contentType, fileName),
              size,
              content,
              contentId: attachment.cid || null,
            });
          }

          const result = await processInboundEmail({
            providerMessageId: messageId,
            messageId,
            from: toSingleAddress(parsed.from),
            to: toAddressList(parsed.to),
            cc: toAddressList(parsed.cc),
            bcc: toAddressList(parsed.bcc),
            subject: parsed.subject || '',
            inReplyTo: parsed.inReplyTo || null,
            references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
            text: parsed.text || null,
            html: parsed.html || null,
            receivedAt: parsed.date?.toISOString() || message.internalDate?.toISOString() || new Date().toISOString(),
            provider: 'imap',
            attachments,
          });

          await client.messageFlagsAdd(message.uid, ['\\Seen']);
          if (result.duplicate) skipped += 1;
          else processed += 1;
        } catch (error) {
          failed += 1;
          console.error('IMAP message processing failed', {
            uid: message.uid,
            error: error instanceof Error ? error.message : String(error),
          });
          // Failed messages remain unseen so the next poll can retry them.
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return { ok: true, processed, skipped, failed };
}
