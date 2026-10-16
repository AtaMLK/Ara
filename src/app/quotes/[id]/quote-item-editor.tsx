'use client';

import {T} from '@/components/language';
import { useState } from 'react';
import { confirmCustomerQuoteItemPriceAction, updateCustomerQuoteItemQuantityAction } from '@/app/actions';

type Item = {
  id: string;
  product_id: string | null;
  supplier_quote_id: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  supplier_cost: number | null;
  supplier_currency: string | null;
  price_status: string;
  pricing_rule_id: string | null;
  price_calculation: Record<string, unknown>;
  supplier_products?: { product_name?: string | null; model_part_number?: string | null } | null;
};

export function QuoteItemEditor({ item, currency, editable }: { item: Item; currency: string; editable: boolean }) {
  const [price, setPrice] = useState(String(item.unit_price));
  const [saving, setSaving] = useState(false);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [error, setError] = useState('');

  async function confirmQuantity() {
    const value = Number(quantity);
    if (!Number.isFinite(value) || value <= 0) { setError('Enter a valid positive quantity.'); return; }
    setSaving(true); setError('');
    try { await updateCustomerQuoteItemQuantityAction(item.id, value); window.location.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save quantity.'); setSaving(false); }
  }

  async function confirmPrice() {
    const value = Number(price);
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a valid non-negative price.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await confirmCustomerQuoteItemPriceAction(item.id, value);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save price.');
      setSaving(false);
    }
  }

  const calc = item.price_calculation || {};
  const rate = typeof calc.exchange_rate === 'number' ? calc.exchange_rate : null;
  const markup = typeof calc.markup_percent === 'number' ? calc.markup_percent : null;

  return (
    <article className="quote-item">
      <div className="quote-item-main">
        <div>
          <div className="eyebrow"><T>LINE ITEM</T></div>
          <h3>{item.supplier_products?.product_name || item.supplier_products?.model_part_number || item.product_id ||<T>{'Product not linked'}</T>}</h3>
          <div className="muted"><T>Qty </T>{item.quantity}<T> · Supplier quote </T>{item.supplier_quote_id || '—'}</div>
        </div>
        <span className="badge"><T>{item.price_status === 'admin_confirmed' ? 'Admin confirmed' : 'Suggested'}</T></span>
      </div>

      <div className="quote-item-grid">
        <div><span className="field-label"><T>Quantity</T></span><div className="price-edit"><input type="number" min="0.0001" step="1" value={quantity} disabled={!editable || saving} onChange={(e) => setQuantity(e.target.value)} /></div></div>
        <div><span className="field-label"><T>Supplier cost</T></span><strong>{item.supplier_cost ?? '—'} {item.supplier_currency || ''}</strong></div>
        <div><span className="field-label"><T>Exchange rate</T></span><strong>{rate ?? 'Same currency'}</strong></div>
        <div><span className="field-label"><T>Markup rule</T></span><strong>{markup == null ? '—' : markup + '%'}</strong></div>
        <div><span className="field-label"><T>Suggested / customer price</T></span><div className="price-edit"><input type="number" min="0" step="0.01" value={price} disabled={!editable || saving} onChange={(e) => setPrice(e.target.value)} /><span>{currency}</span></div></div>
        <div><span className="field-label"><T>Line total</T></span><strong>{(Number(item.quantity) * Number(item.unit_price)).toFixed(2)} {currency}</strong></div>
      </div>

      {editable && (
        <div className="quote-item-actions">
          <button className="secondary-button" disabled={saving} onClick={confirmQuantity}><T>Save quantity</T></button>
          {item.price_status !== 'admin_confirmed' && <button className="primary-button" disabled={saving} onClick={confirmPrice}><T>{saving ? 'Confirming…' : 'Confirm price'}</T></button>}
          {error && <span className="error-inline"><T>{error}</T></span>}
        </div>
      )}
    </article>
  );
}
