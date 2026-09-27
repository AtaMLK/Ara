import { NextResponse } from 'next/server';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ToolError } from '@/lib/errors';
import { processInboundEmail, type InboundEmail } from '@/lib/email/inbound';

export const runtime = 'nodejs';

function requireCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new ToolError('VALIDATION', 'CRON_SECRET is not configured');

  const authorization = request.headers.get('authorization');
  if (authorization !== `Bearer ${secret}`) {
    throw new ToolError('AUTHORIZATION', 'Invalid cron authorization');
  }
}

export async function GET(request: Request) {
  try {
    requireCron(request);

    const host = process.env.IMAP_HOST;
    const user = process.env.IMAP_USER;
    const password = process.env.IMAP_PASSWORD;
    const mailbox = process.env.IMAP_MAILBOX ?? 'INBOX';
    const port = Number(process.env.IMAP_PORT ?? 993);
    const secure = (process.env.IMAP_SECURE ?? 'true').toLowerCase() === 'true';

    if (!host || !user || !password) {
      throw new ToolError('VALIDATION', 'IMAP_HOST, IMAP_USER and IMAP_PASSWORD are required');
    }

    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass: password },
      logger: false,
    });

    let processed = 0;
    let duplicates = 0;
    let failed = 0;

    try {
      await client.connect();
      const lock = await client.getMailboxLock(mailbox);

      try {
        const uids = await client.search({ seen: false });
        for (const uid of uids.slice(0, 20)) {
          try {
            const message = await client.fetchOne(uid, { source: true, envelope: true, flags: true });
            if (!message?.source) continue;

            const parsed = await simpleParser(message.source);
            const providerMessageId =
              parsed.messageId?.trim() ||
              `imap-${cryptoHash(message.source)}`;

            const inbound: InboundEmail = {
              providerMessageId,
              messageId: parsed.messageId ?? null,
              from: parsed.from?.text ?? '',
              to: parsed.to ? parsed.to.value.map((item) => item.address ?? item.name ?? '').filter(Boolean) : [],
              cc: parsed.cc ? parsed.cc.value.map((item) => item.address ?? item.name ?? '').filter(Boolean) : [],
              bcc: parsed.bcc ? parsed.bcc.value.map((item) => item.address ?? item.name ?? '').filter(Boolean) : [],
              subject: parsed.subject ?? '',
              text: parsed.text ?? null,
              html: typeof parsed.html === 'string' ? parsed.html : null,
              receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
              provider: 'imap',
              attachments: (parsed.attachments ?? []).map((attachment) => ({
                fileName: attachment.filename ?? 'attachment',
                mimeType: attachment.contentType || 'application/octet-stream',
                size: attachment.size,
                content: attachment.content,
                contentId: attachment.cid ?? null,
              })),
            };

            const result = await processInboundEmail(inbound);
            if (result.duplicate) duplicates++;
            else processed++;

            await client.messageFlagsAdd(uid, ['\\Seen']);
          } catch {
            failed++;
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }

    return NextResponse.json({ ok: true, processed, duplicates, failed });
  } catch (error) {
    const status = error instanceof ToolError && error.code === 'AUTHORIZATION' ? 401 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Email inbox polling failed' },
      { status },
    );
  }
}

function cryptoHash(value: Buffer) {
  return require('node:crypto').createHash('sha256').update(value).digest('hex');
}
