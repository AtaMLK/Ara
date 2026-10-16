import {T} from '@/components/language';

'use client';

import { useState } from 'react';
import { approveClarificationAction, sendClarificationAction, continueInquiryWorkflowAction, startInquiryWorkflowAction } from '@/app/actions';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

  // RFQ is a persisted approval state; Admin continues through RFQ controls.
  const canStart = !['converted', 'closed'].includes(status) && executions.some(execution=>execution.status==='failed');
  const latestExecution = executions[0];
  const actionLabel = 'Retry failed automation';

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

  async function sendClarification(id: string) {
    setBusy(true);
    setError('');
    try {
      await sendClarificationAction({ inquiryId, clarificationId: id });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
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
          <div className="eyebrow"><T>WORKFLOW</T></div>
          <h2><T>Procurement Workflow</T></h2>
        </div>
        {canStart && <button className="button" onClick={run} disabled={busy}><T>{busy ? 'Running…' : actionLabel}</T></button>}
      </div>

      <div className="workflow-grid">
        <div className="detail-card">
          <strong><T>Current stage</T></strong>
          <div className="workflow-stage"><T>{label(status)}</T></div>
          <div className="muted"><T>The runner only advances through verified gates. It never invents research or sends email without approval.</T></div>
        </div>
        <div className="detail-card">
          <strong><T>Latest execution</T></strong>
          {latestExecution ? <>
            <div><T>{label(latestExecution.agent_id)}</T> · <T>{label(latestExecution.status)}</T></div>
            <div className="muted"><T>Attempts: </T>{latestExecution.attempt_count}</div>
          </> : <div className="muted"><T>No workflow execution yet.</T></div>}
        </div>
      </div>

      {error && <div className="error-inline"><T>{error}</T></div>}

      {clarifications.length > 0 && <div className="detail-card">
        <strong><T>Clarifications</T></strong>
        <div className="list">
          {clarifications.slice(0, 5).map((item) => <div className="list-item" key={item.id}>
            <div><strong><T>{label(item.status)}</T></strong><div className="muted">{item.question}</div></div>{item.status === 'draft' && <button className="inline-button" onClick={() => approveClarification(item.id)} disabled={busy}><T>Approve</T></button>}
            {item.status === 'pending_approval' && <button className="inline-button" onClick={() => sendClarification(item.id)} disabled={busy}><T>Send to customer</T></button>}
          </div>)}
        </div>
      </div>}

      {researchCases.length > 0 && <div className="detail-card">
        <strong><T>Research</T></strong>
        <div className="muted"><T>Latest case: </T><T>{label(researchCases[0].status)}</T></div>
      </div>}

      {alerts.length > 0 && <div className="detail-card">
        <strong><T>Open AI Alerts</T></strong>
        <div className="list">
          {alerts.map((alert) => <div className="list-item" key={alert.id}>
            <div><strong><T>{label(alert.alert_type)}</T></strong><div className="muted">{alert.message}</div></div>
            <span className="badge"><T>{label(alert.priority)}</T></span>
          </div>)}
        </div>
      </div>}
    </section>
  );
}
