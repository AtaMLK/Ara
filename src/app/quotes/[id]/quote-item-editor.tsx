'use client';
import {displayText} from '@/lib/ui/display-text';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmCustomerQuoteItemPriceAction, updateCustomerQuoteItemQuantityAction } from '@/app/actions';

type Item = {
  id: string;
  description?:string|null;
  model?:string|null;
  delivery_text?:string|null;
  product_id: string | null;
  supplier_quote_id: string | null;
  quantity: number;
  unit_price: number | null;
  total: number | null;
  supplier_cost: number | null;
  supplier_currency: string | null;
  price_status: string;
  pricing_rule_id: string | null;
  price_calculation: Record<string, unknown>;
  supplier_products?: { product_name?: string | null; model_part_number?: string | null } | null;
};

export function QuoteItemEditor({ item, currency, editable }: { item: Item; currency: string; editable: boolean }) {
  const router=useRouter();
  const [savedQuantity,setSavedQuantity]=useState(Number(item.quantity));
  const [savedPrice,setSavedPrice]=useState(item.unit_price);
  const [priceStatus,setPriceStatus]=useState(item.price_status);
  const [success,setSuccess]=useState('');
  const [price, setPrice] = useState(item.unit_price==null?'':String(item.unit_price));
  const [saving, setSaving] = useState<'quantity'|'price'|null>(null);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [error, setError] = useState('');

  async function confirmQuantity() {
    const value = Number(quantity);
    if (!Number.isFinite(value) || value <= 0) { setError('Enter a valid positive quantity.'); return; }
    setSaving('quantity'); setError('');setSuccess('');
    try {const result=await updateCustomerQuoteItemQuantityAction(item.id,value);setSavedQuantity(result.quantity);setQuantity(String(result.quantity));setPriceStatus(result.priceStatus);setSuccess('Quantity saved.');router.refresh();}
    catch(e){setError(e instanceof Error?e.message:'Could not save quantity.');}
    finally{setSaving(null);}
  }

  async function confirmPrice() {
    if(!price.trim()){setError('Enter a customer price.');return;}
    const value = Number(price);
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a valid non-negative price.');
      return;
    }
    setSaving('price');setSuccess('');
    setError('');
    try {
      await confirmCustomerQuoteItemPriceAction(item.id, value);
      setSavedPrice(value);setPriceStatus('admin_confirmed');setSuccess('Price saved.');router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save price.');

    } finally {setSaving(null);}
  }

  const calc = item.price_calculation || {};
  const rate = typeof calc.exchange_rate === 'number' ? calc.exchange_rate : null;
  const markup = typeof calc.markup_percent === 'number' ? calc.markup_percent : null;

  return (
    <article className="quote-item">
      <div className="quote-item-main">
        <div>
          <div className="eyebrow">LINE ITEM</div>
          <h3>{item.description || item.supplier_products?.product_name || item.model || item.supplier_products?.model_part_number || 'Quoted item'}</h3>
          <div className="muted">{item.model || item.supplier_products?.model_part_number}</div><div className="muted">Qty {savedQuantity}</div>
        </div>
        <span className="badge">{priceStatus === 'admin_confirmed' ? 'Admin confirmed' : 'Suggested'}</span>
      </div>

      <div className="quote-item-grid">
        <div><span className="field-label">Quantity</span><div className="price-edit"><input type="number" min="0.0001" step="1" aria-label="Quantity" value={quantity} disabled={!editable || saving!==null} onChange={(e) => {setQuantity(e.target.value);setSuccess('');}} /></div></div>
        <div><span className="field-label">Supplier cost</span><strong>{item.supplier_cost ?? '—'} {item.supplier_currency || ''}</strong></div>


        <div><span className="field-label">Suggested / customer price</span><div className="price-edit"><input type="number" min="0" step="0.01" aria-label="Customer price" value={price} disabled={!editable || saving!==null} onChange={(e) => {setPrice(e.target.value);setSuccess('');}} /><span>{currency}</span></div></div>
        <div><span className="field-label">Line total</span><strong>{savedPrice==null?'To be confirmed':(savedQuantity * Number(savedPrice)).toFixed(2)} {currency}</strong></div>
      </div>

      <details className="quote-price-breakdown"><summary>Pricing details</summary><p>Exchange rate: {rate ?? 'Same currency'} · Markup: {markup == null ? '—' : markup+'%'}</p></details>
      {editable && (
        <div className="quote-item-actions">
          <button className="secondary-button" disabled={saving!==null} onClick={confirmQuantity}>{saving==='quantity'?'Saving…':'Save quantity'}</button>
          <button className="primary-button" disabled={saving!==null} onClick={confirmPrice}>{saving==='price' ? 'Saving…' : priceStatus==='admin_confirmed'?'Save & confirm price':'Confirm price'}</button>
          {success&&<span className="save-feedback" role="status">{success}</span>}
          {error && <span className="error-inline" role="alert">{displayText(error)}</span>}
        </div>
      )}
    </article>
  );
}
