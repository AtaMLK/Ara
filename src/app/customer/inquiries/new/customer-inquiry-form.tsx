'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createCustomerInquiryAction } from '@/app/actions';

type InquiryItem = {
  description: string;
  quantity: string;
  brand: string;
  partNumber: string;
  serialNumber: string;
  details: string;
};

const emptyItem = (): InquiryItem => ({
  description: '',
  quantity: '',
  brand: '',
  partNumber: '',
  serialNumber: '',
  details: '',
});

export default function CustomerInquiryForm() {
  const [items, setItems] = useState<InquiryItem[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function updateItem(index: number, field: keyof InquiryItem, value: string) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function addItem() {
    setItems((current) => [...current, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));
  }

  async function submit(formData: FormData) {
    setError('');
    const invalid = items.findIndex((item) => !item.description.trim() || !item.quantity.trim());
    if (invalid !== -1) {
      setError(`Please complete Product Description and Quantity for item ${invalid + 1}.`);
      return;
    }

    const parsedQuantities = items.map((item) => Number(item.quantity));
    if (parsedQuantities.some((quantity) => !Number.isFinite(quantity) || quantity <= 0)) {
      setError('Quantity must be greater than 0 for every item.');
      return;
    }

    setBusy(true);
    try {
      const result = await createCustomerInquiryAction({
        title: String(formData.get('title') ?? ''),
        description: String(formData.get('description') ?? ''),
        originalCustomerText: String(formData.get('bulkRequest') ?? ''),
        itemsJson: JSON.stringify(items),
        priority: formData.get('priority') === 'urgent' ? 'urgent' : 'normal',
        files: formData.getAll('files').filter((value): value is File => value instanceof File && value.size > 0),
      });
      if (result?.ok) window.location.href = `/customer/inquiries/${result.inquiryId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the request.');
      setBusy(false);
    }
  }

  return (
    <form action={submit}>
      <label className="form-field">
        <span>Request title <small>Optional</small></span>
        <input name="title" placeholder="e.g. Hydraulic cylinder spare parts" maxLength={200} />
      </label>

      <div className="customer-items-section">
        <div className="customer-items-heading">
          <div>
            <strong>Products</strong>
            <div className="muted">Description and quantity are required. Other details are optional.</div>
          </div>
        </div>

        {items.map((item, index) => (
          <div className="customer-item-card" key={index}>
            <div className="customer-item-card-header">
              <strong>Item {index + 1}</strong>
              {items.length > 1 && (
                <button type="button" className="secondary-button" onClick={() => removeItem(index)}>Remove</button>
              )}
            </div>

            <label className="form-field">
              <span>Product description <small>Required</small></span>
              <textarea
                value={item.description}
                onChange={(e) => updateItem(index, 'description', e.target.value)}
                required
                maxLength={5000}
                rows={3}
                placeholder="What exactly do you need?"
              />
            </label>

            <div className="customer-item-grid">
              <label className="form-field">
                <span>Quantity <small>Required</small></span>
                <input
                  value={item.quantity}
                  onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                  required
                  inputMode="decimal"
                  type="number"
                  min="0.000001"
                  step="any"
                  placeholder="e.g. 10"
                />
              </label>
              <label className="form-field">
                <span>Brand / Manufacturer <small>Optional</small></span>
                <input value={item.brand} onChange={(e) => updateItem(index, 'brand', e.target.value)} placeholder="e.g. Parker" />
              </label>
              <label className="form-field">
                <span>Part Number / Model <small>Optional</small></span>
                <input value={item.partNumber} onChange={(e) => updateItem(index, 'partNumber', e.target.value)} placeholder="e.g. HK-250" />
              </label>
              <label className="form-field">
                <span>Serial Number <small>Optional</small></span>
                <input value={item.serialNumber} onChange={(e) => updateItem(index, 'serialNumber', e.target.value)} placeholder="If applicable" />
              </label>
            </div>

            <label className="form-field">
              <span>Additional product details <small>Optional</small></span>
              <textarea value={item.details} onChange={(e) => updateItem(index, 'details', e.target.value)} maxLength={5000} rows={2} placeholder="Size, specification, application, delivery requirement, etc." />
            </label>
          </div>
        ))}

        <button type="button" className="secondary-button" onClick={addItem}>+ Add Another Item</button>
      </div>

      <label className="form-field">
        <span>Have a product list already? <small>Optional</small></span>
        <textarea name="bulkRequest" maxLength={20000} rows={5} placeholder="You can paste an existing product list here. The structured items above are still required." />
      </label>

      <label className="form-field">
        <span>Attachments <small>Optional · PDF, Excel, CSV, PNG, JPG, WEBP · max 10 MB each</small></span>
        <input name="files" type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp" />
      </label>

      <label className="form-field">
        <span>Additional notes <small>Optional</small></span>
        <textarea name="description" maxLength={5000} rows={4} placeholder="Anything else ARAT should know?" />
      </label>

      <label className="form-field">
        <span>Priority</span>
        <select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="urgent">Urgent</option></select>
      </label>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="form-actions inquiry-submit-row">
        <Link className="secondary-button" href="/customer">Cancel</Link>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
    </form>
  );
}
