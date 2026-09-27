'use client';

import { useState } from 'react';
import { confirmCustomerQuoteItemPriceAction } from '@/app/actions';

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
};

export function QuoteItemEditor({ item, currency, editable }: { item: Item; currency: string; editable: boolean }) {
  const [price, setPrice] = useState(String(item.unit_price));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
          <div className="eyebrow">LINE ITEM</div>
          <h3>{item.product_id || 'Product not linked'}</h3>
          <div className="muted">Qty {item.quantity} · Supplier quote {item.supplier_quote_id || '—'}</div>
        </div>
        <span className="badge">{item.price_status === 'admin_confirmed' ? 'Admin confirmed' : 'Suggested'}</span>
      </div>

      <div className="quote-item-grid">
        <div><span className="field-label">Supplier cost</span><strong>{item.supplier_cost ?? '—'} {item.supplier_currency || ''}</strong></div>
        <div><span className="field-label">Exchange rate</span><strong>{rate ?? 'Same currency'}</strong></div>
        <div><span className="field-label">Markup rule</span><strong>{markup == null ? '—' : markup + '%'}</strong></div>
        <div><span className="field-label">Suggested / customer price</span><div className="price-edit"><input type="number" min="0" step="0.01" value={price} disabled={!editable || saving} onChange={(e) => setPrice(e.target.value)} /><span>{currency}</span></div></div>
        <div><span className="field-label">Line total</span><strong>{(Number(item.quantity) * Number(item.unit_price)).toFixed(2)} {currency}</strong></div>
      </div>

      {editable && item.price_status !== 'admin_confirmed' && (
        <div className="quote-item-actions">
          <button className="primary-button" disabled={saving} onClick={confirmPrice}>{saving ? 'Confirming…' : 'Confirm price'}</button>
          {error && <span className="error-inline">{error}</span>}
        </div>
      )}
    </article>
  );
}
