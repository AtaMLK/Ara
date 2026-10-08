'use client';

import { useState } from 'react';
import { Check, Circle, Clock3, X } from 'lucide-react';

export type InquiryProcessStep = {
  key: string;
  title: string;
  description: string;
  state: 'completed' | 'current' | 'upcoming' | 'warning';
  detail?: string;
};

export default function InquiryProcess({ steps, eyebrow = 'PROCESS' }: { steps: InquiryProcessStep[]; eyebrow?: string }) {
  const [selected, setSelected] = useState<InquiryProcessStep | null>(null);
  const current = steps.find((step) => step.state === 'current' || step.state === 'warning');

  return (
    <>
      <section className="section inquiry-process">
        <div className="section-head">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2>Request Process</h2>
            <div className="muted">Follow the request step by step.</div>
          </div>
          <span className="badge">{current?.title ?? 'Completed'}</span>
        </div>
        <div className="inquiry-process-track" role="list">
          {steps.map((step, index) => (
            <button type="button" role="listitem" key={step.key}
              className={`inquiry-process-step inquiry-process-step--${step.state}`}
              onClick={() => setSelected(step)}
              aria-label={`${step.title}: ${step.state}`}
              title={step.detail || step.description}>
              <span className="inquiry-process-icon">
                {step.state === 'completed' ? <Check size={15} /> : step.state === 'warning' ? <Clock3 size={15} /> : step.state === 'current' ? <span className="inquiry-process-current-dot" /> : <Circle size={13} />}
              </span>
              <span className="inquiry-process-step-text">
                <strong>{index + 1}. {step.title}</strong>
                <span>{step.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {selected && typeof document !== 'undefined' && (
        <div className="inquiry-process-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <div className="inquiry-process-modal" role="dialog" aria-modal="true" aria-labelledby="inquiry-process-modal-title">
            <header className="inquiry-process-modal-head">
              <div>
                <div className="eyebrow">PROCESS STEP</div>
                <h2 id="inquiry-process-modal-title">{selected.title}</h2>
                <div className="muted">{selected.description}</div>
              </div>
              <button type="button" className="arat-dialog-close" onClick={() => setSelected(null)} aria-label="Close"><X size={17} /></button>
            </header>
            <div className="inquiry-process-modal-body">
              <div className={`inquiry-process-modal-status inquiry-process-modal-status--${selected.state}`}>{selected.state === 'completed' ? 'Completed' : selected.state === 'warning' ? 'Action required' : selected.state === 'current' ? 'Current stage' : 'Upcoming'}</div>
              <p>{selected.detail || selected.description}</p>
            </div>
            <footer className="inquiry-process-modal-foot">
              <button type="button" className="secondary-button" onClick={() => setSelected(null)}>Close</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
