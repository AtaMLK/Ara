'use client';

import {T,Localized} from '@/components/language';
import Link from 'next/link';
import { useState } from 'react';
import { createCustomerInquiryAction } from '@/app/actions';

type InquiryItem = {
  description: string;
  quantity: string;
  unit:string;
  brand: string;
  partNumber: string;
  serialNumber: string;
  details: string;
};

const emptyItem = (): InquiryItem => ({
  description: '',
  quantity: '',
  unit:'',
  brand: '',
  partNumber: '',
  serialNumber: '',
  details: '',
});

export default function CustomerInquiryForm() {
  const [items, setItems] = useState<InquiryItem[]>([emptyItem()]);
  const [entryMode,setEntryMode]=useState<'manual'|'list'|'file'>('manual');
  const [bulkRequest,setBulkRequest]=useState('');
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
    const invalid = entryMode==='manual'?items.findIndex((item) => !item.description.trim() || !item.quantity.trim()):-1;
    if (invalid !== -1) {
      setError(`Please complete Product Description and Quantity for item ${invalid + 1}.`);
      return;
    }

    const parsedQuantities = entryMode==='manual'?items.map((item) => Number(item.quantity)):[];
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
        itemsJson: JSON.stringify(entryMode==='manual'?items:[]),
        entryMode,
        priority: formData.get('priority') === 'urgent' ? 'urgent' : 'normal',
        files: formData.getAll('files').filter((value): value is File => value instanceof File && value.size > 0),
      });
      if (result?.ok) window.location.href = `/customer/inquiries/${result.inquiryId}`;
      else setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the request.');
      setBusy(false);
    }
  }

  return (
    <form action={submit}>
      <label className="form-field">
        <span><T>Request title </T><small><T>Optional</T></small></span>
        <Localized as="input" name="title" placeholder="Give your request a short title" maxLength={200} />
      </label>

      <fieldset className="inquiry-entry-method"><legend><T>How would you like to provide your request?</T></legend><div className="inquiry-entry-options">
        {([['manual','Enter items'],['list','Paste a list'],['file','Upload files']] as const).map(([value,label])=><label key={value}><input type="radio" name="entryMethod" value={value} checked={entryMode===value} onChange={()=>{setEntryMode(value);setError('');}}/><span><T>{label}</T></span></label>)}
      </div></fieldset>

      {entryMode==='manual'&&<div className="customer-items-section">
        <div className="customer-items-heading">
          <div>
            <strong><T>Products</T></strong>
            <div className="muted"><T>Description and quantity are required. Other details are optional.</T></div>
          </div>
        </div>

        {items.map((item, index) => (
          <div className="customer-item-card" key={index}>
            <div className="customer-item-card-header">
              <strong><T>Item </T>{index + 1}</strong>
              {items.length > 1 && (
                <button type="button" className="secondary-button" onClick={() => removeItem(index)}><T>Remove</T></button>
              )}
            </div>

            <label className="form-field">
              <span><T>Product description </T><small><T>Required</T></small></span>
              <Localized as="textarea"
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
                <span><T>Quantity </T><small><T>Required</T></small></span>
                <Localized as="input"
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
              <label className="form-field"><span><T>Unit of measure</T><small><T>Optional</T></small></span><Localized as="input" value={item.unit} maxLength={40} onChange={e=>updateItem(index,'unit',e.target.value)} placeholder="e.g. pcs, kg, m" /></label>
              <label className="form-field">
                <span><T>Brand / Manufacturer </T><small><T>Optional</T></small></span>
                <Localized as="input" value={item.brand} onChange={(e) => updateItem(index, 'brand', e.target.value)} placeholder="Brand or manufacturer, if known" />
              </label>
              <label className="form-field">
                <span><T>Part Number / Model </T><small><T>Optional</T></small></span>
                <Localized as="input" value={item.partNumber} onChange={(e) => updateItem(index, 'partNumber', e.target.value)} placeholder="Model or reference, if available" />
              </label>
              <label className="form-field">
                <span><T>Serial Number </T><small><T>Optional</T></small></span>
                <Localized as="input" value={item.serialNumber} onChange={(e) => updateItem(index, 'serialNumber', e.target.value)} placeholder="If applicable" />
              </label>
            </div>

            <label className="form-field">
              <span><T>Additional product details </T><small><T>Optional</T></small></span>
              <Localized as="textarea" value={item.details} onChange={(e) => updateItem(index, 'details', e.target.value)} maxLength={5000} rows={2} placeholder="Size, specification, application, delivery requirement, etc." />
            </label>
          </div>
        ))}

        <button type="button" className="secondary-button" onClick={addItem}><T>+ Add Another Item</T></button>
      </div>}

      {entryMode==='list'&&<label className="form-field">
        <span><T>Paste your request or item list</T><small><T>Required</T></small></span>
        <Localized as="textarea" name="bulkRequest" value={bulkRequest} onChange={e=>setBulkRequest(e.target.value)} required maxLength={20000} rows={8} placeholder="Paste your items, quantities and units here. Include any specifications or delivery needs." />
        <small><T>ARAT will read the list and extract each item and its stated quantity. You do not need to enter the items again.</T></small>
      </label>}

      <label className="form-field">
        <span><T>Attachments </T><small><T>{entryMode==='file'?'Required · PDF, Excel, CSV, PNG, JPG, WEBP · max 10 MB each':'Optional · PDF, Excel, CSV, PNG, JPG, WEBP · max 10 MB each'}</T></small></span>
        <input name="files" type="file" required={entryMode==='file'} multiple accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp" />
        {entryMode==='file'&&<small><T>Upload your item list with quantities and units. ARAT will process the files after submission; no manual item entry is required.</T></small>}
      </label>

      <label className="form-field">
        <span><T>Additional notes </T><small><T>Optional</T></small></span>
        <Localized as="textarea" name="description" maxLength={5000} rows={4} placeholder="Anything else ARAT should know?" />
      </label>

      <label className="form-field">
        <span><T>Priority</T></span>
        <select name="priority" defaultValue="normal"><option value="normal"><T>Normal</T></option><option value="urgent"><T>Urgent</T></option></select>
      </label>

      {error && <div className="form-error" role="alert"><T>{error}</T></div>}

      <div className="form-actions inquiry-submit-row">
        <Link className="secondary-button" href="/customer"><T>Cancel</T></Link>
        <button className="primary-button" type="submit" disabled={busy}><T>{busy ? 'Submitting…' : 'Submit request'}</T></button>
      </div>
    </form>
  );
}
