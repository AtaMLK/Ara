import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchEmailOnce } from '../src/lib/email/dispatch.ts';

const reservation = { idempotency_key: 'test-email', payload_hash: 'a'.repeat(64), inquiry_id: null,
  subject: 'Test', recipients: ['test@example.invalid'], message_id: '<test@arat.invalid>' };
const receipt = { providerMessageId: '<test@arat.invalid>', sentAt: '2026-11-01T10:00:00Z' };
function memoryStore() {
  let row = null;
  return {
    get row() { return row; },
    async reserve(value) { if (row) return null; row = { ...value, id: '1', status: 'sending', provider_message_id: null, thread_id: null, sent_at: null }; return row; },
    async find() { return row; },
    async sent(id, result) { Object.assign(row, { status: 'sent', provider_message_id: result.providerMessageId, sent_at: result.sentAt }); },
    async uncertain() { row.status = 'delivery_uncertain'; },
  };
}
test('sent emails reuse their receipt instead of sending twice', async () => {
  const store = memoryStore(); let sends = 0;
  const deliver = async () => { sends++; return receipt; };
  await dispatchEmailOnce(reservation, store, deliver);
  assert.deepEqual(await dispatchEmailOnce(reservation, store, deliver), { ...receipt, threadId: undefined });
  assert.equal(sends, 1);
});
test('concurrent workers cannot both enter the email transport', async () => {
  const store = memoryStore(); let finish; let sends = 0;
  const delivery = new Promise(resolve => { finish = resolve; });
  const first = dispatchEmailOnce(reservation, store, async () => { sends++; await delivery; return receipt; });
  await assert.rejects(dispatchEmailOnce(reservation, store, async () => { sends++; return receipt; }), /already sending/);
  finish(); await first; assert.equal(sends, 1);
});
test('Delivery uncertainty blocks all automatic retries', async () => {
  const store = memoryStore(); let sends = 0;
  await assert.rejects(dispatchEmailOnce(reservation, store, async () => { sends++; throw new Error('Connection lost after DATA'); }), /could not be confirmed/);
  await assert.rejects(dispatchEmailOnce(reservation, store, async () => { sends++; return receipt; }), /uncertain/);
  assert.equal(sends, 1); assert.equal(store.row.status, 'delivery_uncertain');
});
test('lost receipt writes and crashed reservations do not resend', async () => {
  const store = memoryStore(); store.sent = async () => { throw new Error('Database unavailable'); };
  await assert.rejects(dispatchEmailOnce(reservation, store, async () => receipt), /could not be confirmed/);
  await assert.rejects(dispatchEmailOnce(reservation, store, async () => assert.fail('Duplicate send')), /uncertain/);
  const crashed = memoryStore(); await crashed.reserve(reservation);
  await assert.rejects(dispatchEmailOnce(reservation, crashed, async () => assert.fail('Duplicate send')), /already sending/);
});
test('a reused key cannot send changed content', async () => {
  const store = memoryStore(); await dispatchEmailOnce(reservation, store, async () => receipt);
  await assert.rejects(dispatchEmailOnce({ ...reservation, payload_hash: 'b'.repeat(64) }, store, async () => assert.fail('Changed payload sent')), /different contents/);
});
