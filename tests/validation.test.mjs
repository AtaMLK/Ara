import assert from 'node:assert/strict';
import { test } from 'node:test';
import { optionalIsoDate, localRedirectUrl } from '../src/lib/validation.ts';
import { oneRelated } from '../src/lib/data/relations.ts';
import { notificationSchema, timelineEventSchema } from '../src/lib/ai/schemas.ts';
import { customerQuoteItemsSchema } from '../src/lib/data/customer-quote-schema.ts';

test('quote editor accepts valid dates and clearing an expiry', () => {
  assert.equal(optionalIsoDate.parse('2026-11-30'), '2026-11-30');
  assert.equal(optionalIsoDate.parse(''), undefined);
  assert.equal(optionalIsoDate.parse(undefined), undefined);
  for (const invalid of ['2026-02-30', '2026-13-01', '11/30/2026']) {
    assert.equal(optionalIsoDate.safeParse(invalid).success, false);
  }
});

test('callback redirects stay on the application origin', () => {
  const base = 'https://arat.example/auth/callback';
  assert.equal(localRedirectUrl('/reset-password?done=1', base).href, 'https://arat.example/reset-password?done=1');
  for (const unsafe of [null, '//example.org', '/\\example.org', 'https://example.org', 'javascript:alert(1)']) {
    assert.equal(localRedirectUrl(unsafe, base).href, 'https://arat.example/');
  }
});

test('to-one relationships support objects, arrays and missing joins', () => {
  const customer = { name: 'Example' };
  assert.equal(oneRelated(customer), customer);
  assert.equal(oneRelated([customer]), customer);
  assert.equal(oneRelated([]), null);
  assert.equal(oneRelated(null), null);
});

test('notification and timeline contracts validate required fields', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(notificationSchema.parse({ userId: id, category: 'customer', title: 'Quote ready', message: 'Review your quotation' }).priority, 'normal');
  assert.equal(notificationSchema.safeParse({ userId: id, category: 'invalid' }).success, false);
  assert.deepEqual(timelineEventSchema.parse({ inquiryId: id, eventType: 'quote_ready', visibility: 'customer' }).metadata, {});
});

test('customer item contract preserves unpriced values and drops internal data', () => {
  const row = { id: '123e4567-e89b-42d3-a456-426614174000', quantity: 2,
    unit_price: null, total: null, description: 'Sensor', model: null,
    brand: null, delivery_text: null, supplier_cost: 50, price_calculation: { markup: 15 } };
  const [item] = customerQuoteItemsSchema.parse([row]);
  assert.equal(item.unit_price, null);
  assert.equal(item.total, null);
  assert.equal('supplier_cost' in item, false);
  assert.equal('price_calculation' in item, false);
  assert.equal(customerQuoteItemsSchema.safeParse([{ ...row, quantity: -1 }]).success, false);
});
