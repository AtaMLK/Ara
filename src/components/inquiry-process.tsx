'use client';

import {T,Localized,useI18n} from '@/components/language';
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
  const {t}=useI18n();
  const [selected, setSelected] = useState<InquiryProcessStep | null>(null);
  const current = steps.find((step) => step.state === 'warning') ?? steps.find((step) => step.state === 'current');

  return (
    <>
      <section className="section inquiry-process">
        <div className="section-head">
          <div>
            <div className="eyebrow"><T>{eyebrow}</T></div>
            <h2><T>Request Process</T></h2>
            <div className="muted"><T>Follow the request step by step.</T></div>
          </div>
          <span className="badge"><T>{current?.title ?? 'Completed'}</T></span>
        </div>
        <div className="inquiry-process-track" role="list">
          {steps.map((step, index) => (
            <Localized as="button" type="button" role="listitem" key={step.key}
              className={`inquiry-process-step inquiry-process-step--${step.state}`}
              onClick={() => setSelected(step)}
              aria-label={`${t(step.title)}: ${t(step.state)}`}
              title={step.detail || step.description}>
              <span className="inquiry-process-icon">
                {step.state === 'completed' ? <Check size={15} /> : step.state === 'warning' ? <Clock3 size={15} /> : step.state === 'current' ? <span className="inquiry-process-current-dot" /> : <Circle size={13} />}
              </span>
              <span className="inquiry-process-step-text">
                <strong>{index + 1}. <T>{step.title}</T></strong>
                <span><T>{step.description}</T></span>
              </span>
            </Localized>
          ))}
        </div>
      </section>

      {selected && typeof document !== 'undefined' && (
        <div className="inquiry-process-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <div className="inquiry-process-modal" role="dialog" aria-modal="true" aria-labelledby="inquiry-process-modal-title">
            <header className="inquiry-process-modal-head">
              <div>
                <div className="eyebrow"><T>PROCESS STEP</T></div>
                <h2 id="inquiry-process-modal-title"><T>{selected.title}</T></h2>
                <div className="muted"><T>{selected.description}</T></div>
              </div>
              <Localized as="button" type="button" className="arat-dialog-close" onClick={() => setSelected(null)} aria-label="Close"><X size={17} /></Localized>
            </header>
            <div className="inquiry-process-modal-body">
              <div className={`inquiry-process-modal-status inquiry-process-modal-status--${selected.state}`}><T>{selected.state === 'completed' ? 'Completed' : selected.state === 'warning' ? 'Action required' : selected.state === 'current' ? 'Current stage' : 'Upcoming'}</T></div>
              <p><T>{selected.detail || selected.description}</T></p>
            </div>
            <footer className="inquiry-process-modal-foot">
              <button type="button" className="secondary-button" onClick={() => setSelected(null)}><T>Close</T></button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
