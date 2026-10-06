'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getSupplierRfqRecipientsAction, sendSupplierRfqAction, verifySupplierCandidateAction } from './supplier-rfq-actions';

type Requirement = {
  id: string;
  type: string;
  value: string;
  status: string;
  source?: string;
  source_ref?: string | null;
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
    supplier_addresses: Array<{
      id: string;
      address: string;
      is_primary: boolean;
    }>;
    supplier_phones: Array<{
      id: string;
      phone: string;
      is_primary: boolean;
      status: string;
    }>;
    supplier_websites: Array<{
      id: string;
      url: string;
      is_primary: boolean;
    }>;
  } | null;
};

function normalizedCountry(candidate: Candidate) {
  return (candidate.proposed_country || candidate.suppliers?.primary_country || '').trim();
}

function domestic(country: string | null | undefined) {
  const value = (country ?? '').trim().toLowerCase();
  return value === 'turkey' || value === 'türkiye' || value === 'tr' || value.includes('turkey');
}

function region(country: string | null | undefined) {
  const value = (country ?? '').trim().toLowerCase();
  if (domestic(value)) return 'Turkey';
  const europe = ['germany','italy','spain','france','united kingdom','uk','england','netherlands','belgium','austria','switzerland','poland','czech','czechia','portugal','sweden','norway','denmark','finland','ireland','romania','hungary','greece'];
  const asia = ['china','japan','south korea','korea','india','indonesia','malaysia','singapore','thailand','vietnam','taiwan','hong kong','pakistan'];
  const americas = ['usa','united states','canada','mexico','brazil'];
  const middleEast = ['uae','united arab emirates','saudi','qatar','israel','jordan','iran','iraq'];
  if (europe.some((item) => value.includes(item))) return 'Europe';
  if (asia.some((item) => value.includes(item))) return 'Asia';
  if (americas.some((item) => value.includes(item))) return 'Americas';
  if (middleEast.some((item) => value.includes(item))) return 'Middle East';
  return value ? 'International' : 'Country not verified';
}

function shortWebsite(value: string | null | undefined) {
  if (!value) return null;
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
}

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function matchMeta(candidate: Candidate) {
  const evidence = (candidate.match_evidence ?? {}) as Record<string, unknown>;
  const type = typeof evidence.match_type === 'string' ? evidence.match_type : 'same_brand_distributor';
  const score = typeof evidence.match_score === 'number' ? evidence.match_score : null;
  const note = typeof evidence.match_note === 'string' ? evidence.match_note : '';
  const coverageCount = typeof evidence.coverage_count === 'number' ? evidence.coverage_count : 1;
  const coverageTotal = typeof evidence.coverage_total === 'number' ? evidence.coverage_total : 1;
  const labels: Record<string, string> = {
    exact_product: 'Exact product match',
    same_brand_distributor: 'Same brand / supplier',
    same_brand_similar: 'Same brand / similar product',
    related_alternative: 'Related alternative',
  };
  return { type, label: labels[type] ?? 'Supplier match', score, note, coverageCount, coverageTotal };
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

  const index = product.source_ref ? product.source_ref : '';
  const sameItem = requirements.filter((item) => {
    if (item.id === product.id) return true;
    return item.source_ref === index;
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
  const [sendConfirmation, setSendConfirmation] = useState('');
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifiedIds, setVerifiedIds] = useState<string[]>([]);
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

  function isRfqSent(candidate: Candidate) {
  const evidence = (candidate.verification_evidence ?? {}) as Record<string, unknown>;
  return evidence.rfq_sent === true || typeof evidence.rfq_sent_at === 'string';
}

function isVerified(candidate: Candidate) {
    const evidence = (candidate.verification_evidence ?? {}) as Record<string, unknown>;
    return candidate.suppliers?.verification_status === 'verified'
      || evidence.verification_status === 'verified'
      || verifiedIds.includes(candidate.id);
  }

  function valid(candidate: Candidate) {
    const verified = isVerified(candidate);
    // Verification controls supplier selection. Email availability is validated
    // when the admin sends the RFQ, so a verified supplier is not hidden/disabled
    // merely because its contact email has not been added yet.
    return candidate.status === 'finalized'
      && Boolean(candidate.supplier_id)
      && verified;
  }

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const modalCandidates = selectedProductId ? (grouped.get(selectedProductId) ?? []) : [];
  const selectedCandidates = candidates.filter((candidate) => selected.includes(candidate.id));

  async function openPreview(language: 'tr' | 'en') {
    setError('');
    if (!selected.length) {
      const message = 'Select at least one supplier.';
      setError(message);
      toast.error('No supplier selected', { description: message });
      return;
    }
    const first = selectedCandidates[0];
    const item = buildPreview(requirements, first, language);
    if (!item) {
      const message = 'Selected supplier is not linked to a product requirement.';
      setError(message);
      toast.error('RFQ preview unavailable', { description: message });
      return;
    }

    const { recipients } = await getSupplierRfqRecipientsAction({
      inquiryId,
      candidateIds: selected,
    });
    const recipientEmails = recipients.map((entry) => entry.email).filter(Boolean);
    if (!recipientEmails.length) {
      const message = 'No active supplier email found for the selected supplier.';
      setError(message);
      toast.error('Supplier email unavailable', { description: message });
      return;
    }

    setPreview({ ...item, recipient: recipientEmails.join(', '), language });
  }

  async function verify(candidateId: string) {
    setVerifying(candidateId);
    setError('');
    try {
      await verifySupplierCandidateAction({ inquiryId, candidateId });
      setVerifiedIds((current) => current.includes(candidateId) ? current : [...current, candidateId]);
      toast.success('Supplier verified', { description: 'The supplier is now ready for RFQ selection.' });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not verify supplier';
      setError(message);
      toast.error('Supplier verification failed', { description: message });
    } finally {
      setVerifying(null);
    }
  }

  async function send() {
    setBusy(true);
    setError('');
    setSendConfirmation('');
    try {
      const result = await sendSupplierRfqAction({ inquiryId, candidateIds: selected });
      setSelected([]);
      setSentIds((current) => [...new Set([...current, ...result.results.map((item) => item.candidateId)])]);
      toast.success(
        result.results.length === 1 ? 'RFQ email sent' : 'RFQ emails sent',
        {
          description: result.results.length === 1
            ? `Sent successfully to ${result.results[0].email}.`
            : `${result.results.length} supplier emails were sent successfully.`,
        },
      );
      setSendConfirmation('');
      setPreview(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not send supplier RFQ';
      setError(message);
      toast.error('RFQ email failed', { description: message });
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
        <span className="badge">{candidates.length} candidates · {candidates.filter(valid).length} ready</span>
      </div>

      {error && <div className="error-inline">{error}</div>}
      {sendConfirmation && <div className="success-inline">{sendConfirmation}</div>}

      {products.length === 0 ? (
        <div className="detail-card"><div className="empty">No product requirements are confirmed yet.</div></div>
      ) : (
        <div className="table supplier-product-table">
          <div className="row header"><div>Product</div><div>Brand / Model</div><div>Suppliers Found</div><div>Status</div></div>
          {products.map((product) => {
            const rows = grouped.get(product.id) ?? [];
            const validCount = rows.length;
            const model = requirements.find((item) => item.type === 'model_part_number' && item.source_ref === product.source_ref)?.value;
            return (
              <div className="row" key={product.id}>
                <div><strong>{product.value}</strong></div>
                <div>{model || '—'}</div>
                <div>
                  <button className="supplier-count-button" onClick={() => { setSelectedProductId(product.id); setSelected([]); setPreview(null); setError(''); }}>
                    {validCount}
                  </button>
                </div>
                <div>{validCount ? <span className="badge status-approved">Candidates found</span> : <span className="badge">Researching</span>}</div>
              </div>
            );
          })}
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

            {(['Turkey', 'Europe', 'Asia', 'International'] as const).map((group) => {
              const rows = modalCandidates.filter((candidate) => {
                const country = normalizedCountry(candidate);
                const candidateRegion = region(country);
                // Anything outside Turkey / Europe / Asia is intentionally grouped under International.
                return candidateRegion === group || (group === 'International' && !['Turkey', 'Europe', 'Asia'].includes(candidateRegion));
              });
              if (rows.length === 0) return null;
              const title = group === 'Turkey' ? 'Internal / Turkey' : group;
              return (
                <div className="supplier-modal-group" key={group}>
                  <div className="supplier-modal-group-head">
                    <div><strong>{title}</strong><div className="muted">{rows.length} candidate{rows.length === 1 ? '' : 's'}</div></div>
                    <span className="badge">{group === 'Turkey' ? 'Türkçe' : 'English'}</span>
                  </div>
                  {rows.map((candidate) => {
                    const canSend = valid(candidate);
                    const contact = candidate.suppliers?.supplier_contacts.find((item) => item.email && item.status === 'active')
                      ?? candidate.suppliers?.supplier_contacts.find((item) => item.status === 'active');
                    const email = emailFor(candidate);
                    const verified = isVerified(candidate);
                    const rfqSent = sentIds.includes(candidate.id) || isRfqSent(candidate);
                    const disabledReason = rfqSent
                      ? 'RFQ email already sent'
                      : !candidate.supplier_id
                      ? 'Supplier record not created'
                      : !verified
                        ? 'Supplier verification required'
                        : !email
                          ? 'No active supplier email found'
                          : candidate.status !== 'finalized'
                            ? 'Candidate is not finalized'
                            : '';
                    return (
                      <label className="supplier-candidate-row" key={candidate.id} title={disabledReason || 'Select supplier'}>
                        <input type="checkbox" checked={selected.includes(candidate.id)} disabled={!canSend || rfqSent} onChange={() => toggle(candidate.id)} />
                        <div className="supplier-candidate-main">
                          <strong>{candidate.suppliers?.legal_name || candidate.proposed_name}</strong>
                          <div className="muted">{region(normalizedCountry(candidate))} · {normalizedCountry(candidate) || 'Country not verified'}</div>
                          <div className="muted">
                            {(() => {
                              const website = candidate.suppliers?.supplier_websites.find((item) => item.is_primary)?.url ?? candidate.proposed_website;
                              return website ? (
                                <a href={website} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{shortWebsite(website)}</a>
                              ) : 'No website';
                            })()}
                          </div>
                          {(() => {
                            const meta = matchMeta(candidate);
                            return (
                              <>
                                <div className="supplier-match-line"><strong>{meta.label}</strong>{meta.score !== null ? ` · ${meta.score}/100` : ''} · Covers {meta.coverageCount}/{meta.coverageTotal} products</div>
                                {meta.type !== 'exact_product' && (
                                  <div className="supplier-match-warning">
                                    ⚠ {meta.type === 'same_brand_distributor'
                                      ? 'Exact requested product is not confirmed, but this supplier/distributor is supported as a supplier for the requested brand.'
                                      : meta.type === 'same_brand_similar'
                                        ? 'Exact requested model is not confirmed, but a similar product from the requested brand is supported by the evidence.'
                                        : 'This is not an exact product match; the supplier is shown as a related alternative based on the research evidence.'}
                                  </div>
                                )}
                                {meta.note && <div className="muted">{meta.note}</div>}
                              </>
                            );
                          })()}
                          {contact?.name && <div className="muted">Contact: {contact.name}{contact.job_title ? ` · ${contact.job_title}` : ''}{contact.department ? ` · ${contact.department}` : ''}</div>}
                          {contact?.phone && <div className="muted">{contact.phone}</div>}
                          {!contact?.phone && candidate.suppliers?.supplier_phones.find((item) => item.status === 'active')?.phone && (
                            <div className="muted">{candidate.suppliers.supplier_phones.find((item) => item.status === 'active')?.phone}</div>
                          )}
                          {candidate.suppliers?.supplier_addresses.find((item) => item.is_primary)?.address && (
                            <div className="muted">Address: {candidate.suppliers.supplier_addresses.find((item) => item.is_primary)?.address}</div>
                          )}
                        </div>
                        <div className="supplier-candidate-contact">
                          <span>{email || 'No active email'}</span>
                          {rfqSent ? (
                            <span className="badge status-approved">✓ Email Sent</span>
                          ) : verified ? (
                            <span className="badge status-approved">✓ Verified</span>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button supplier-verify-button"
                              disabled={verifying === candidate.id || !candidate.supplier_id}
                              onClick={(event) => { event.preventDefault(); event.stopPropagation(); void verify(candidate.id); }}
                            >
                              {verifying === candidate.id ? 'Verifying…' : 'Verify Supplier'}
                            </button>
                          )}
                          {!canSend && disabledReason && <span className="muted">{disabledReason}</span>}
                        </div>
                      </label>
                    );
                  })}
                  {rows.some(valid) && (
                    <button
                      className="primary-button supplier-send-button"
                      disabled={busy}
                      onClick={() => openPreview(group === 'Turkey' ? 'tr' : 'en')}
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
            <div className="preview-meta"><strong>To</strong><span>{preview.recipient || '—'}</span></div>
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
