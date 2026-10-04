'use client';

import { useMemo, useState } from 'react';
import { sendSupplierRfqAction } from './supplier-rfq-actions';

type Requirement = {
  id: string;
  type: string;
  value: string;
  status: string;
  source?: string;
  admin_edited?: boolean;
  updated_at?: string;
};

type Candidate = {
  id: string;
  requirement_id: string | null;
  proposed_name: string;
  proposed_country: string | null;
  proposed_website: string | null;
  status: string;
  match_evidence: unknown;
  availability_evidence: unknown;
  verification_evidence: unknown;
  created_at: string;
  supplier_id: string | null;
  suppliers: {
    id: string;
    legal_name: string;
    primary_country: string;
    supplier_type: string;
    verification_status: string;
    supplier_contacts: Array<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      job_title: string | null;
      department: string | null;
      status: string;
      is_primary: boolean;
    }>;
    supplier_emails: Array<{
      email: string;
      is_primary: boolean;
      status: string;
    }>;
  } | null;
};

function domestic(country: string | null | undefined) {
  const value = (country ?? '').trim().toLowerCase();
  return value === 'turkey' || value === 'türkiye' || value === 'tr' || value.includes('turkey');
}

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function emailFor(candidate: Candidate) {
  return candidate.suppliers?.supplier_contacts.find((contact) => contact.email && contact.status === 'active')?.email
    ?? candidate.suppliers?.supplier_emails.find((email) => email.status === 'active' && email.is_primary)?.email
    ?? candidate.suppliers?.supplier_emails.find((email) => email.status === 'active')?.email
    ?? null;
}

function buildPreview(requirements: Requirement[], candidate: Candidate, language: 'tr' | 'en') {
  const product = requirements.find((item) => item.id === candidate.requirement_id && item.type === 'product');
  if (!product) return null;

  const index = product.source ? product.source : '';
  const sameItem = requirements.filter((item) => {
    if (item.id === product.id) return true;
    return item.source === index;
  });
  const model = sameItem.find((item) => item.type === 'model_part_number')?.value ?? '';
  const quantity = sameItem.find((item) => item.type === 'quantity')?.value ?? '';
  const specs = sameItem.filter((item) => item.type === 'specification').map((item) => item.value);

  const subject = language === 'tr' ? `Teklif Talebi – ${product.value}` : `RFQ – ${product.value}`;
  const lines = [
    language === 'tr' ? 'Merhaba,' : 'Dear Sir/Madam,',
    language === 'tr'
      ? 'Aşağıdaki ürün için fiyat teklifinizi ve teslim süresini paylaşmanızı rica ederiz.'
      : 'We would like to request your quotation for the following item.',
    '',
    `1. ${product.value}`,
    model ? `Model / Part Number: ${model}` : '',
    quantity ? `Quantity: ${quantity}` : '',
    ...specs,
    '',
    language === 'tr'
      ? 'Lütfen birim fiyat, stok/uygunluk, teslim süresi, ödeme şartları ve teklif geçerlilik süresini belirtiniz.'
      : 'Please provide unit price, availability, delivery time, payment terms and quotation validity.',
    '',
    language === 'tr' ? 'İyi çalışmalar,\nArya Automation' : 'Best regards,\nArya Automation',
  ].filter(Boolean);

  return { subject, body: lines.join('\n'), recipient: emailFor(candidate) };
}

export function CandidatePanel({
  inquiryId,
  requirements,
  candidates,
}: {
  inquiryId: string;
  requirements: Requirement[];
  candidates: Candidate[];
}) {
  const products = requirements.filter((item) => item.type === 'product');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string; recipient: string | null; language: 'tr' | 'en' } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    for (const product of products) map.set(product.id, []);
    for (const candidate of candidates) {
      const key = candidate.requirement_id;
      if (key && map.has(key)) map.get(key)!.push(candidate);
    }
    return map;
  }, [candidates, products]);

  function valid(candidate: Candidate) {
    return candidate.status === 'finalized'
      && candidate.supplier_id
      && candidate.suppliers?.verification_status === 'verified'
      && Boolean(emailFor(candidate));
  }

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const modalCandidates = selectedProductId ? (grouped.get(selectedProductId) ?? []) : [];
  const selectedCandidates = candidates.filter((candidate) => selected.includes(candidate.id));

  async function openPreview(language: 'tr' | 'en') {
    setError('');
    if (!selected.length) {
      setError('Select at least one supplier.');
      return;
    }
    const first = selectedCandidates[0];
    const item = buildPreview(requirements, first, language);
    if (!item) {
      setError('Selected supplier is not linked to a product requirement.');
      return;
    }
    setPreview({ ...item, language });
  }

  async function send() {
    setBusy(true);
    setError('');
    try {
      await sendSupplierRfqAction({ inquiryId, candidateIds: selected });
      setSelected([]);
      setPreview(null);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send supplier RFQ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section supplier-candidate-section">
      <div className="section-head">
        <div>
          <div className="eyebrow">SUPPLIER DISCOVERY</div>
          <h2>Supplier Candidates</h2>
          <div className="muted">Suppliers are researched per product and consolidated here.</div>
        </div>
        <span className="badge">{candidates.filter(valid).length} valid</span>
      </div>

      {error && <div className="error-inline">{error}</div>}

      {products.length === 0 ? (
        <div className="detail-card"><div className="empty">No product requirements are confirmed yet.</div></div>
      ) : (
        <div className="table supplier-product-table">
          <div className="row header"><div>Product</div><div>Brand / Model</div><div>Valid Suppliers</div><div>Status</div></div>
          {products.map((product) => {
            const rows = grouped.get(product.id) ?? [];
            const validCount = rows.filter(valid).length;
            const model = requirements.find((item) => item.type === 'model_part_number' && item.source === product.source)?.value;
            return (
              <div className="row" key={product.id}>
                <div><strong>{product.value}</strong></div>
                <div>{model || '—'}</div>
                <div>
                  <button className="supplier-count-button" onClick={() => { setSelectedProductId(product.id); setError(''); }}>
                    {validCount}
                  </button>
                </div>
                <div>{validCount ? <span className="badge status-approved">Ready</span> : <span className="badge">Researching</span>}</div>
              </div>
            );
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="supplier-selection-bar">
          <strong>{selected.length} supplier{selected.length === 1 ? '' : 's'} selected</strong>
          <div className="supplier-selection-actions">
            <button className="secondary-button" onClick={() => openPreview('tr')}>Preview Turkish Email</button>
            <button className="primary-button" onClick={() => openPreview('en')}>Preview English Email</button>
          </div>
        </div>
      )}

      {selectedProductId && (
        <div className="supplier-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProductId(null); }}>
          <div className="supplier-modal" role="dialog" aria-modal="true">
            <div className="supplier-modal-head">
              <div>
                <div className="eyebrow">SUPPLIER SHORTLIST</div>
                <h2>{requirements.find((item) => item.id === selectedProductId)?.value}</h2>
              </div>
              <button className="text-button" onClick={() => setSelectedProductId(null)}>Close</button>
            </div>

            {(['domestic', 'international'] as const).map((group) => {
              const rows = modalCandidates.filter((candidate) => domestic(candidate.proposed_country) === (group === 'domestic'));
              const title = group === 'domestic' ? 'Domestic / Turkey' : 'International';
              return (
                <div className="supplier-modal-group" key={group}>
                  <div className="supplier-modal-group-head">
                    <div><strong>{title}</strong><div className="muted">{rows.length} candidate{rows.length === 1 ? '' : 's'}</div></div>
                    <span className="badge">{group === 'domestic' ? 'Türkçe' : 'English'}</span>
                  </div>
                  {rows.length === 0 ? <div className="empty">No valid candidate in this group.</div> : rows.map((candidate) => {
                    const canSend = valid(candidate);
                    const contact = candidate.suppliers?.supplier_contacts.find((item) => item.email && item.status === 'active')
                      ?? candidate.suppliers?.supplier_contacts.find((item) => item.status === 'active');
                    return (
                      <label className="supplier-candidate-row" key={candidate.id}>
                        <input type="checkbox" checked={selected.includes(candidate.id)} disabled={!canSend} onChange={() => toggle(candidate.id)} />
                        <div className="supplier-candidate-main">
                          <strong>{candidate.suppliers?.legal_name || candidate.proposed_name}</strong>
                          <div className="muted">{label(candidate.suppliers?.supplier_type || 'unknown')} · {candidate.proposed_country || candidate.suppliers?.primary_country || '—'}</div>
                          <div className="muted">{candidate.proposed_website || 'No website'}{contact?.name ? ` · ${contact.name}` : ''}</div>
                        </div>
                        <div className="supplier-candidate-contact">
                          <span>{emailFor(candidate) || 'No email'}</span>
                          {candidate.suppliers?.verification_status === 'verified' ? <span className="badge status-approved">Verified</span> : <span className="badge status-pending_approval">Not verified</span>}
                        </div>
                      </label>
                    );
                  })}
                  {rows.some(valid) && (
                    <button
                      className="primary-button supplier-send-button"
                      onClick={() => openPreview(group === 'domestic' ? 'tr' : 'en')}
                    >
                      Send Email
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {preview && (
        <div className="supplier-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <div className="supplier-modal supplier-preview-modal" role="dialog" aria-modal="true">
            <div className="supplier-modal-head">
              <div><div className="eyebrow">EMAIL PREVIEW</div><h2>{preview.language === 'tr' ? 'Turkish Supplier RFQ' : 'English Supplier RFQ'}</h2></div>
              <button className="text-button" onClick={() => setPreview(null)}>Close</button>
            </div>
            <div className="preview-meta"><strong>To</strong><span>{selectedCandidates.map(emailFor).filter(Boolean).join(', ') || preview.recipient || '—'}</span></div>
            <div className="preview-meta"><strong>Subject</strong><span>{preview.subject}</span></div>
            <textarea className="supplier-email-preview" value={preview.body} readOnly />
            <div className="supplier-preview-actions">
              <button className="secondary-button" onClick={() => setPreview(null)}>Cancel</button>
              <button className="primary-button" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Confirm & Send'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
