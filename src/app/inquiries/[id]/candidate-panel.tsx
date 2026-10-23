'use client';

import {T,Localized,useI18n} from '@/components/language';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { getSupplierRfqPreviewAction, sendSupplierRfqAction, verifySupplierCandidateAction } from './supplier-rfq-actions';
import { loadMoreSupplierCandidatesAction } from './supplier-discovery-actions';
import {productBrand,isExclusiveBrand,isAryaWebsite,SUPPLIER_BATCH_SIZE} from '@/lib/ai/supplier-policy';

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
      professional_profile?: string | null;
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
  const rawNote = typeof evidence.match_note === 'string' ? evidence.match_note : '';
  const note = /supplemental web research added manually|supplier relationship and exact model\/quantity availability require confirmation/i.test(rawNote)
    ? ''
    : rawNote;
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

type ResearchContact = { email: string; sourceUrl: string | null };

function researchContact(candidate: Candidate): ResearchContact | null {
  // Some research providers return contact details inside evidence JSON before
  // they have been normalized into supplier_emails/supplier_contacts.
  // Read only explicit email fields and keep the source URL when supplied.
  const roots = [candidate.match_evidence, candidate.verification_evidence];
  const visited = new Set<object>();
  const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

  function walk(value: unknown, sourceUrl: string | null = null, depth = 0): ResearchContact | null {
    if (!value || typeof value !== 'object' || depth > 7 || visited.has(value as object)) return null;
    visited.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, sourceUrl, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const record = value as Record<string, unknown>;
    const nextSource = [record.source_url, record.sourceUrl, record.url, record.page_url, record.evidence_url]
      .find((item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item)) ?? sourceUrl;

    for (const key of ['email', 'contact_email', 'sales_email', 'email_address', 'public_email']) {
      const candidateEmail = record[key];
      if (typeof candidateEmail === 'string' && emailPattern.test(candidateEmail.trim())) {
        return { email: candidateEmail.trim(), sourceUrl: nextSource };
      }
    }

    for (const child of Object.values(record)) {
      const found = walk(child, nextSource, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const root of roots) {
    const found = walk(root);
    if (found) return found;
  }
  return null;
}

function emailFor(candidate: Candidate) {
  return candidate.suppliers?.supplier_contacts.find((contact) => contact.email && contact.status === 'active')?.email
    ?? candidate.suppliers?.supplier_emails.find((email) => email.status === 'active' && email.is_primary)?.email
    ?? candidate.suppliers?.supplier_emails.find((email) => email.status === 'active')?.email
    ?? researchContact(candidate)?.email
    ?? null;
}

function representationStatus(candidate: Candidate): { label: string; kind: 'official' | 'not_official' | 'unknown' } {
  const evidence = candidate.match_evidence as Record<string, unknown> | null;
  const verification = candidate.verification_evidence as Record<string, unknown> | null;
  const values = [evidence?.representation_status, evidence?.distributor_status, evidence?.official_distributor, verification?.representation_status]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase());
  if (values.some((value) => ['official', 'authorized', 'authorised', 'official_distributor', 'true'].includes(value))) {
    return { label: 'Official representative claim', kind: 'official' };
  }
  if (values.some((value) => ['not_official', 'not authorized', 'not authorised', 'reseller', 'false', 'unofficial'].includes(value))) {
    return { label: 'Not an official representative', kind: 'not_official' };
  }
  return { label: 'Representation not confirmed', kind: 'unknown' };
}


export function CandidatePanel({
  inquiryId,
  requirements,
  candidates:allCandidates,
  reviewProgress = {},
}: {
  inquiryId: string;
  requirements: Requirement[];
  candidates: Candidate[];
  reviewProgress?:Record<string,{limit:number;hasMore:boolean}>;
}) {
  const {t}=useI18n();
  const router=useRouter();
  const products = requirements.filter((item) => item.type === 'product');
  const candidates=allCandidates.filter(candidate=>{
    const product=products.find(row=>row.id===candidate.requirement_id);
    return product && !['admin_removed','admin_rejected'].includes(candidate.status) && (!isExclusiveBrand(productBrand(product,requirements)) || isAryaWebsite(candidate.proposed_website));
  });
  const [visibleLimits,setVisibleLimits]=useState<Record<string,number>>({});
  const [moreAvailable,setMoreAvailable]=useState<Record<string,boolean>>({});
  const [loadingMore,setLoadingMore]=useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [sendConfirmation, setSendConfirmation] = useState('');
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifiedIds, setVerifiedIds] = useState<string[]>([]);
  const [localVerification,setLocalVerification]=useState<{source:Candidate[];supplierIds:string[]}|null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof getSupplierRfqPreviewAction>>['previews'] | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    for (const product of products) map.set(product.id, []);
    for (const candidate of candidates) {
      const key = candidate.requirement_id;
      if (key && map.has(key)) map.get(key)!.push(candidate);
    }
    for(const rows of map.values()) rows.sort((a,b)=>{
      const preferred=(row:Candidate)=>Boolean((row.match_evidence as Record<string,unknown>)?.preferred_brand_supplier);
      return Number(isAryaWebsite(b.proposed_website))-Number(isAryaWebsite(a.proposed_website)) || Number(domestic(normalizedCountry(b)))-Number(domestic(normalizedCountry(a))) || Number(preferred(b))-Number(preferred(a)) || Number(b.suppliers?.verification_status==='verified')-Number(a.suppliers?.verification_status==='verified') || a.id.localeCompare(b.id);
    });
    return map;
  }, [candidates, products]);

  function isRfqSent(candidate: Candidate) {
  const evidence = (candidate.verification_evidence ?? {}) as Record<string, unknown>;
  return evidence.rfq_sent === true || typeof evidence.rfq_sent_at === 'string';
}

function isVerified(candidate: Candidate) {
    return candidate.suppliers?.verification_status === 'verified'
      || (localVerification?.source===allCandidates && localVerification.supplierIds.includes(candidate.supplier_id ?? ''));
  }

  function valid(candidate: Candidate) {
    const verified = isVerified(candidate);
    // Verification controls supplier selection. Email availability is validated
    // when the admin sends the RFQ, so a verified supplier is not hidden/disabled
    // merely because its contact email has not been added yet.
    // The server action persists status='finalized'. Reflect that successful
    // verification immediately in this client view instead of waiting for a
    // server-component refresh to replace the candidate props.
    return (candidate.status === 'finalized' || verifiedIds.includes(candidate.id))
      && Boolean(candidate.supplier_id)
      && verified;
  }

  function toggle(id: string) {
    const candidate=candidates.find(row=>row.id===id);
    const related=candidates.filter(row=>row.supplier_id===candidate?.supplier_id && valid(row) && !isRfqSent(row) && !sentIds.includes(row.id)).map(row=>row.id);
    setSelected(current=>current.includes(id)?current.filter(item=>!related.includes(item)):[...new Set([...current,...related])]);
  }

  const allModalCandidates=selectedProductId ? (grouped.get(selectedProductId) ?? []) : [];
  const visibleLimit=selectedProductId ? (visibleLimits[selectedProductId] ?? SUPPLIER_BATCH_SIZE) : SUPPLIER_BATCH_SIZE;
  const modalCandidates = allModalCandidates.slice(0,visibleLimit);
  const displayGroups=['Turkey','Europe','Asia','International'] as const;
  const modalProduct=products.find(row=>row.id===selectedProductId);
  const canReviewMore=Boolean(modalProduct && !isExclusiveBrand(productBrand(modalProduct,requirements)) && (moreAvailable[modalProduct.id] ?? reviewProgress[modalProduct.id]?.hasMore ?? false));
  async function showMore() {
    if(!selectedProductId) return;
    setLoadingMore(true);setError('');
    try {
      if(visibleLimit>=allModalCandidates.length && canReviewMore) {
        const progress=await loadMoreSupplierCandidatesAction({inquiryId,requirementId:selectedProductId});
        setMoreAvailable(current=>({...current,[selectedProductId]:progress.hasMore}));
      }
      setVisibleLimits(current=>({...current,[selectedProductId]:visibleLimit+SUPPLIER_BATCH_SIZE}));
    }catch(e){setError(e instanceof Error?e.message:'Could not review more suppliers');}
    finally{setLoadingMore(false);}
  }
  const selectedCandidates = candidates.filter((candidate) => selected.includes(candidate.id));

  async function openPreview() {
    setError('');setBusy(true);
    try {const result=await getSupplierRfqPreviewAction({inquiryId,candidateIds:selected});setPreview(result.previews);}
    catch(e){const message=e instanceof Error?e.message:'RFQ preview unavailable';setError(message);toast.error(t('RFQ preview unavailable'),{description:t(message)});}
    finally {setBusy(false);}
  }

  async function verify(candidateId: string) {
    setVerifying(candidateId);
    setError('');
    try {
      const result=await verifySupplierCandidateAction({ inquiryId, candidateId });
      setLocalVerification(current=>({source:allCandidates,supplierIds:[...new Set([...(current?.source===allCandidates?current.supplierIds:[]),result.supplierId])]}));
      setVerifiedIds((current) => current.includes(candidateId) ? current : [...current, candidateId]);
      router.refresh();
      toast.success(t('Supplier verified'), { description: t('The supplier is now ready for RFQ selection.') });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not verify supplier';
      setError(message);
      toast.error(t('Supplier verification failed'), { description: t(message) });
    } finally {
      setVerifying(null);
    }
  }

  async function send() {
    setBusy(true);
    setError('');
    setSendConfirmation('');
    try {
      const result = await sendSupplierRfqAction({ inquiryId, candidateIds: selected,previews:preview??undefined });
      setSelected([]);
      setSentIds((current) => [...new Set([...current, ...result.results.flatMap((item) => item.candidateIds)])]);
      toast.success(
        t(result.results.length === 1 ? 'RFQ email sent' : 'RFQ emails sent'),
        {
          description: t(result.results.length === 1
            ? `Sent successfully to ${result.results[0].email}.`
            : `${result.results.length} supplier emails were sent successfully.`),
        },
      );
      setSendConfirmation('');
      setPreview(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not send supplier RFQ';
      setError(message);
      toast.error(t('RFQ email failed'), { description: t(message) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section supplier-candidate-section">
      <div className="section-head">
        <div>
          <div className="eyebrow"><T>SUPPLIER DISCOVERY</T></div>
          <h2><T>Supplier Candidates</T></h2>
          <div className="muted"><T>Suppliers are researched per product and consolidated here.</T></div>
        </div>
        <span className="badge">{candidates.length}<T> candidates · </T>{candidates.filter(valid).length}<T> ready</T></span>
      </div>

      {error && <div className="error-inline"><T>{error}</T></div>}
      {sendConfirmation && <div className="success-inline">{sendConfirmation}</div>}
      {selected.length>0 && <button type="button" className="primary-button" disabled={busy} onClick={()=>void openPreview()}>Review {new Set(selectedCandidates.map(row=>row.supplier_id)).size} supplier email(s) for {selected.length} selected items</button>}

      {products.length === 0 ? (
        <div className="detail-card"><div className="empty"><T>No product requirements are confirmed yet.</T></div></div>
      ) : (
        <div className="table supplier-product-table">
          <div className="row header"><div><T>Product</T></div><div><T>Brand / Model</T></div><div><T>Suppliers Found</T></div><div><T>Status</T></div></div>
          {products.map((product) => {
            const rows = grouped.get(product.id) ?? [];
            const validCount = rows.length;
            const model = requirements.find((item) => item.type === 'model_part_number' && item.source_ref === product.source_ref)?.value;
            const brand = requirements.find((item) => item.type === 'specification' && item.source_ref === product.source_ref && /^brand\s*:/i.test(item.value))?.value.replace(/^brand\s*:\s*/i, '').trim();
            return (
              <div className="row" key={product.id}>
                <div><strong>{product.value}</strong></div>
                <div>{brand || '—'}{model ? <><span className="muted"> / </span>{model}</> : ''}</div>
                <div>
                  <button className="supplier-count-button" onClick={() => { setSelectedProductId(product.id); setPreview(null); setError(''); }}>
                    {validCount}
                  </button>
                </div>
                <div>{validCount ? <span className="badge status-approved"><T>Candidates found</T></span> : <span className="badge"><T>Researching</T></span>}</div>
              </div>
            );
          })}
        </div>
      )}


      {selectedProductId && typeof document !== 'undefined' && createPortal(
        <div className="supplier-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProductId(null); }}>
          <div className="supplier-modal" role="dialog" aria-modal="true">
            <div className="supplier-modal-head">
              <div>
                <div className="eyebrow"><T>SUPPLIER SHORTLIST</T></div>
                <h2>{requirements.find((item) => item.id === selectedProductId)?.value}</h2>
              </div>
              <button className="text-button" onClick={() => setSelectedProductId(null)}><T>Close</T></button>
            </div>

            {displayGroups.map((group) => {
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
                    <div><strong><T>{title}</T></strong><div className="muted">{rows.length}<T> candidate</T>{rows.length === 1 ? '' : 's'}</div></div>
                    <span className="badge"><T>{group === 'Turkey' ? 'Türkçe' : 'English'}</T></span>
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
                      <Localized as="label" className="supplier-candidate-row" key={candidate.id} title={disabledReason ||'Select supplier'}>
                        <input type="checkbox" checked={selected.includes(candidate.id)} disabled={!canSend || rfqSent} onChange={() => toggle(candidate.id)} />
                        <div className="supplier-candidate-main">
                          <strong>{candidate.suppliers?.legal_name || candidate.proposed_name}</strong>
                          <div className="muted">{region(normalizedCountry(candidate))} · {normalizedCountry(candidate) ||<T>{'Country not verified'}</T>}</div>
                          <div className="muted">
                            {(() => {
                              const website = candidate.suppliers?.supplier_websites.find((item) => item.is_primary)?.url ?? candidate.proposed_website;
                              return website ? (
                                <a href={website} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{shortWebsite(website)}</a>
                              ) : 'No website';
                            })()}
                          </div>
                          {(() => {
                            const representation = representationStatus(candidate);
                            return (
                              <div className={representation.kind === 'official' ? 'supplier-match-line' : representation.kind === 'not_official' ? 'supplier-match-warning' : 'muted'}>
                                {representation.kind === 'official' ? '✓ ' : representation.kind === 'not_official' ? 'ⓘ ' : '○ '}<T>{representation.label}</T>
                              </div>
                            );
                          })()}
                          {(() => {
                            const meta = matchMeta(candidate);
                            return (
                              <>
                                <div className="supplier-match-line"><strong><T>{meta.label}</T></strong>{meta.score !== null ? ` · ${meta.score}/100` : ''}<T> · Covers </T>{meta.coverageCount}/{meta.coverageTotal}<T> products</T></div>
                                {meta.type !== 'exact_product' && (
                                  <div className="supplier-match-warning">
                                    ⚠ <T>{meta.type === 'same_brand_distributor'
                                      ? 'Exact model not confirmed'
                                      : meta.type === 'same_brand_similar'
                                        ? 'Similar product; exact model not confirmed'
                                        : 'Related alternative'}</T>
                                  </div>
                                )}
                                {meta.note && <div className="muted">{meta.note}</div>}
                              </>
                            );
                          })()}
                          {contact?.name && <div className="muted"><T>Contact: </T>{contact.name}{contact.job_title ? ` · ${contact.job_title}` : ''}{contact.department ? ` · ${contact.department}` : ''}</div>}
                          {contact?.phone && <div className="muted">{contact.phone}</div>}
                          {!contact?.phone && candidate.suppliers?.supplier_phones.find((item) => item.status === 'active')?.phone && (
                            <div className="muted">{candidate.suppliers.supplier_phones.find((item) => item.status === 'active')?.phone}</div>
                          )}
                          {candidate.suppliers?.supplier_addresses.find((item) => item.is_primary)?.address && (
                            <div className="muted"><T>Address: </T>{candidate.suppliers.supplier_addresses.find((item) => item.is_primary)?.address}</div>
                          )}
                          <details onClick={(event) => event.stopPropagation()}>
                            <summary><T>All contact details and evidence</T></summary>
                            {candidate.suppliers?.supplier_emails.filter((item) => item.status === 'active').map((item) => <div key={item.email}><T>Email: </T>{item.email}</div>)}
                            {candidate.suppliers?.supplier_phones.filter((item) => item.status === 'active').map((item) => <div key={item.id}><T>Phone: </T>{item.phone}</div>)}
                            {candidate.suppliers?.supplier_addresses.map((item) => <div key={item.id}><T>Address: </T>{item.address}</div>)}
                            {candidate.suppliers?.supplier_contacts.filter((item) => item.status === 'active').map((item) => (
                              <div key={item.id}><T>Contact: </T>{[item.name, item.job_title, item.department, item.email, item.phone, item.professional_profile].filter(Boolean).join(' · ')}</div>
                            ))}
                            {(() => {
                              const evidence = (candidate.verification_evidence ?? {}) as Record<string, unknown>;
                              const assessment = evidence.assessment as { explanation?: string } | undefined;
                              const missing = Array.isArray(evidence.missing_contact_fields) ? evidence.missing_contact_fields.filter((value) => typeof value === 'string') : [];
                              const urls = [evidence.source_url, ...(Array.isArray(evidence.contact_sources) ? evidence.contact_sources : [])]
                                .filter((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value));
                              return <>
                                {assessment?.explanation && <div><T>Verification: </T>{assessment.explanation}</div>}
                                {missing.length > 0 && <div className="supplier-match-warning"><T>Not found in public evidence: </T>{missing.join(', ')}</div>}
                                {[...new Set(urls)].map((url) => <div key={url}><a href={url} target="_blank" rel="noreferrer"><T>Source: </T>{url}</a></div>)}
                              </>;
                            })()}
                          </details>
                        </div>
                        <div className="supplier-candidate-contact">
                          <span>{email ||<T>{'No email found yet'}</T>}</span>
                          {researchContact(candidate)?.sourceUrl && (
                            <a className="muted" href={researchContact(candidate)!.sourceUrl!} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><T>
                              Email source
                            </T></a>
                          )}
                          {rfqSent ? (
                            <span className="badge status-approved"><T>✓ Email Sent</T></span>
                          ) : verified ? (
                            <span className="badge status-approved"><T>✓ Verified</T></span>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button supplier-verify-button"
                              disabled={verifying === candidate.id || !candidate.supplier_id}
                              onClick={(event) => { event.preventDefault(); event.stopPropagation(); void verify(candidate.id); }}
                            >
                              <T>{verifying === candidate.id ? 'Verifying…' : 'Verify Supplier'}</T>
                            </button>
                          )}
                          {!canSend && disabledReason && <span className="muted">{disabledReason}</span>}
                        </div>
                      </Localized>
                    );
                  })}
                  {rows.some(valid) && (
                    <button
                      className="primary-button supplier-send-button"
                      disabled={busy}
                      onClick={() => openPreview()}
                    ><T>
                      Review supplier messages
                    </T></button>
                  )}
                </div>
              );
            })}
            {(allModalCandidates.length>visibleLimit || canReviewMore) && <button type="button" className="secondary-button" disabled={loadingMore} onClick={()=>void showMore()}>{loadingMore?'Reviewing next suppliers…':'Show 5 more suppliers'}</button>}
            <div className="muted">Showing {modalCandidates.length} suppliers. {selected.length} items selected across {new Set(selectedCandidates.map(row=>row.supplier_id)).size} suppliers. One email per supplier.</div>
          </div>
        </div>,
        document.body,
      )}

      {preview && typeof document !== 'undefined' && createPortal(
        <div className="supplier-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <div className="supplier-modal supplier-preview-modal" role="dialog" aria-modal="true">
            <div className="supplier-modal-head">
              <div><div className="eyebrow"><T>EMAIL PREVIEW</T></div><h2>{`Review ${preview.length} supplier message${preview.length===1?'':'s'}`}</h2></div>
              <button className="text-button" onClick={() => setPreview(null)}><T>Close</T></button>
            </div>
            {preview.map(message=><section className="detail-card" key={message.candidateId}>
              <div className="preview-meta"><strong><T>To</T></strong><span>{message.recipient}</span></div>
              <div className="preview-meta"><strong><T>Subject</T></strong><span>{message.subject}</span></div>
              <Localized as="iframe" title={'Supplier message to '+message.recipient} sandbox="" srcDoc={message.html} style={{width:'100%',height:350,border:0,background:'white'}} />
            </section>)}
            <div className="supplier-preview-actions">
              <button className="secondary-button" onClick={() => setPreview(null)}><T>Cancel</T></button>
              <button className="primary-button" disabled={busy} onClick={send}><T>{busy ? 'Sending…' : 'Confirm & Send'}</T></button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
