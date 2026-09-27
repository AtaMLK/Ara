'use client';

import { useState } from 'react';
import { finalizeSupplierCandidateAction } from '@/app/actions';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CandidatePanel({ inquiryId, candidates }: {
  inquiryId: string;
  candidates: Array<{
    id: string;
    proposed_name: string;
    proposed_country: string | null;
    proposed_website: string | null;
    status: string;
    match_evidence: unknown;
    availability_evidence: unknown;
    verification_evidence: unknown;
  }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function finalize(id: string) {
    setBusy(id);
    setError('');
    try {
      await finalizeSupplierCandidateAction({ inquiryId, candidateId: id });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finalize candidate');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="section">
      <div className="section-head">
        <div><div className="eyebrow">SUPPLIER DISCOVERY</div><h2>Supplier Candidates</h2></div>
        <span className="badge">{candidates.length} candidate{candidates.length === 1 ? '' : 's'}</span>
      </div>
      {error && <div className="error-inline">{error}</div>}
      {candidates.length === 0 ? (
        <div className="detail-card"><div className="empty">No supplier candidates yet. Research must produce evidence before candidates can be added.</div></div>
      ) : (
        <div className="table">
          <div className="row header"><div>Supplier</div><div>Country</div><div>Status</div><div>Action</div></div>
          {candidates.map((candidate) => (
            <div className="row" key={candidate.id}>
              <div>
                <strong>{candidate.proposed_name}</strong>
                {candidate.proposed_website && <div className="muted">{candidate.proposed_website}</div>}
              </div>
              <div>{candidate.proposed_country || '—'}</div>
              <div><span className="badge">{label(candidate.status)}</span></div>
              <div>
                {candidate.status === 'proposed' ? (
                  <button className="inline-button" onClick={() => finalize(candidate.id)} disabled={busy !== null}>
                    {busy === candidate.id ? 'Finalizing…' : 'Finalize'}
                  </button>
                ) : <span className="muted">Locked</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
