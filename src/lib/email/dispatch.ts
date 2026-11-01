import type { SendEmailResult } from './types.ts';

export type EmailDispatch = {
  id: string;
  idempotency_key: string;
  payload_hash: string;
  status: 'sending' | 'sent' | 'delivery_uncertain';
  provider_message_id: string | null;
  thread_id: string | null;
  sent_at: string | null;
};
export type DispatchReservation = {
  idempotency_key: string;
  payload_hash: string;
  inquiry_id: string | null;
  subject: string;
  recipients: string[];
  message_id: string;
};
export interface DispatchStore {
  reserve(input: DispatchReservation): Promise<EmailDispatch | null>;
  find(key: string): Promise<EmailDispatch | null>;
  sent(id: string, result: SendEmailResult): Promise<void>;
  uncertain(id: string): Promise<void>;
}

// A durable unique reservation is made BEFORE SMTP. SMTP cannot offer exactly
// once delivery: after a timeout/crash we stop and require mailbox review,
// rather than risking a second send. A successful retry reuses its receipt.
export async function dispatchEmailOnce(
  reservation: DispatchReservation,
  store: DispatchStore,
  deliver: () => Promise<SendEmailResult>,
): Promise<SendEmailResult> {
  const reserved = await store.reserve(reservation);
  if (!reserved) {
    const previous = await store.find(reservation.idempotency_key);
    if (!previous) throw new Error('Email reservation could not be verified. No email was sent.');
    if (previous.payload_hash !== reservation.payload_hash) {
      throw new Error('This email has already been reserved with different contents. Review its delivery before creating another send.');
    }
    if (previous.status === 'sent' && previous.provider_message_id && previous.sent_at) {
      return { providerMessageId: previous.provider_message_id, threadId: previous.thread_id ?? undefined, sentAt: previous.sent_at };
    }
    throw new Error('This email is already sending or its delivery is uncertain. Check the sent mailbox before any resend.');
  }
  try {
    const receipt = await deliver();
    await store.sent(reserved.id, receipt);
    return receipt;
  } catch {
    // Even if recording the uncertainty fails, the original unique reservation
    // remains in place and prevents an automatic second SMTP attempt.
    await store.uncertain(reserved.id).catch(() => undefined);
    throw new Error('Email delivery could not be confirmed. Check the sent mailbox before any resend.');
  }
}
