
'use client';

import { useState } from 'react';
import { approveClarificationAction, continueInquiryWorkflowAction, startInquiryWorkflowAction } from '@/app/actions';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\\b\\w/g, (c) => c.toUpperCase());
}

export function WorkflowPanel({ inquiryId, status, executions, alerts, clarifications, researchCases }: {
  inquiryId: string;
  status: string;
  executions: Array<{ id: string; task_key: string; agent_id: string; status: string; attempt_count: number; error_code: string | null; error_message: string | null; created_at: string }>;
  alerts: Array<{ id: string; alert_type: string; message: string; priority: string; created_at: string }>;
  clarifications: Array<{ id: string; requirement_id: string | null; question: string; status: string; created_at: string }>;
  researchCases: Array<{ id: string; status: string; created_at: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canStart = !['converted', 'closed'].includes(status);
  const latestExecution = executions[0];
  const actionLabel = status === 'processing' ? 'Start workflow' : status === 'clarification_required' || status === 'researching' ? 'Continue workflow' : 'Run workflow';

  async function approveClarification(id: string) {
    setBusy(true);
    setError('');
    try {
      await approveClarificationAction({ inquiryId, clarificationId: id });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError('');
    try {
      if (status === 'processing') await startInquiryWorkflowAction(inquiryId);
      else await continueInquiryWorkflowAction(inquiryId);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workflow action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section workflow-panel">
      <div className="section-head">
        <div>
          <div className="eyebrow">WORKFLOW</div>
          <h2>Procurement Workflow</h2>
        </div>
        {canStart && <button className="button" onClick={run} disabled={busy}>{busy ? 'Running…' : actionLabel}</button>}
      </div>

      <div className="workflow-grid">
        <div className="detail-card">
          <strong>Current stage</strong>
          <div className="workflow-stage">{label(status)}</div>
          <div className="muted">The runner only advances through verified gates. It never invents research or sends email without approval.</div>
        </div>
        <div className="detail-card">
          <strong>Latest execution</strong>
          {latestExecution ? <>
            <div>{label(latestExecution.agent_id)} · {label(latestExecution.status)}</div>
            <div className="muted">Attempts: {latestExecution.attempt_count}</div>
          </> : <div className="muted">No workflow execution yet.</div>}
        </div>
      </div>

      {error && <div className="error-inline">{error}</div>}

      {clarifications.length > 0 && <div className="detail-card">
        <strong>Clarifications</strong>
        <div className="list">
          {clarifications.slice(0, 5).map((item) => <div className="list-item" key={item.id}>
            <div><strong>{label(item.status)}</strong><div className="muted">{item.question}</div></div>{item.status === 'draft' && <button className="inline-button" onClick={() => approveClarification(item.id)} disabled={busy}>Approve</button>}
          </div>)}
        </div>
      </div>}

      {researchCases.length > 0 && <div className="detail-card">
        <strong>Research</strong>
        <div className="muted">Latest case: {label(researchCases[0].status)}</div>
      </div>}

      {alerts.length > 0 && <div className="detail-card">
        <strong>Open AI Alerts</strong>
        <div className="list">
          {alerts.map((alert) => <div className="list-item" key={alert.id}>
            <div><strong>{label(alert.alert_type)}</strong><div className="muted">{alert.message}</div></div>
            <span className="badge">{label(alert.priority)}</span>
          </div>)}
        </div>
      </div>}
    </section>
  );
}
