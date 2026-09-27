import 'server-only';

import type { EmailProvider, SendEmailInput, SendEmailResult } from './types';
import { ToolError } from '@/lib/errors';

class ResendEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new ToolError('TRANSIENT', 'RESEND_API_KEY is not configured');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
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

export function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER ?? 'resend';

  if (provider === 'resend') return new ResendEmailProvider();

  throw new ToolError('VALIDATION', `Unsupported email provider: ${provider}`);
}
