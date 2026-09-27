import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ToolError } from '@/lib/errors';

type ResendReceivedEmail = {
  id: string;
  message_id?: string | null;
  from: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  created_at?: string | null;
};

type ResendReceivedEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    message_id?: string | null;
    from?: string;
    to?: string[];
    subject?: string | null;
  };
};

function base64UrlSafeToBuffer(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
}

export function verifyResendWebhook(payload: string, headers: Headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw new ToolError('VALIDATION', 'RESEND_WEBHOOK_SECRET is not configured');

  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signature = headers.get('svix-signature');
  if (!id || !timestamp || !signature) throw new ToolError('AUTHORIZATION', 'Missing Resend webhook signature');

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    throw new ToolError('AUTHORIZATION', 'Expired Resend webhook');
  }

  const signedContent = id + '.' + timestamp + '.' + payload;
  const secretBytes = base64UrlSafeToBuffer(secret.replace(/^whsec_/, ''));
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  const valid = signature
    .split(' ')
    .map((item) => item.split(','))
    .filter(([version, value]) => version === 'v1' && Boolean(value))
    .some(([, value]) => {
      const actual = Buffer.from(value, 'base64');
      const expectedBuffer = Buffer.from(expected, 'base64');
      return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
    });

  if (!valid) throw new ToolError('AUTHORIZATION', 'Invalid Resend webhook signature');
}

export function parseResendReceivedEvent(input: unknown) {
  const event = input as ResendReceivedEvent;
  if (event?.type !== 'email.received' || !event.data?.email_id) return null;
  return {
    emailId: event.data.email_id,
    messageId: event.data.message_id ?? null,
  };
}

export async function getResendReceivedEmail(emailId: string): Promise<ResendReceivedEmail> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new ToolError('TRANSIENT', 'RESEND_API_KEY is not configured');

  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({})) as Partial<ResendReceivedEmail> & { message?: string };
  if (!response.ok || !payload.id || !payload.from) {
    throw new ToolError(response.status >= 500 ? 'TRANSIENT' : 'CONFLICT', payload.message || 'Could not retrieve received email');
  }

  return {
    id: payload.id,
    message_id: payload.message_id ?? null,
    from: payload.from,
    to: payload.to ?? [],
    cc: payload.cc ?? [],
    bcc: payload.bcc ?? [],
    subject: payload.subject ?? null,
    text: payload.text ?? null,
    html: payload.html ?? null,
    created_at: payload.created_at ?? null,
  };
}
