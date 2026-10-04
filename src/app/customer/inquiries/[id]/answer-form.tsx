'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { answerClarificationAction } from '@/app/actions';

export default function AnswerClarificationForm({ inquiryId, clarificationId }: { inquiryId: string; clarificationId: string }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await answerClarificationAction({ inquiryId, clarificationId, answer });
      setDone(true);
      setAnswer('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to submit your answer.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="clarification-answer-success" role="status">
        <strong>Answer submitted</strong>
        <span>We received your answer and will continue processing this request.</span>
      </div>
    );
  }

  return (
    <form className="clarification-answer-form stack" onSubmit={submit}>
      <label className="clarification-answer-label">Your answer<textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Enter the model or part number…" rows={3} required /></label>
      {error && <div className="error-box" role="alert">{error}</div>}
      <button className="primary-button" disabled={loading || !answer.trim()}>{loading ? 'Submitting…' : 'Submit answer'}</button>
    </form>
  );
}
