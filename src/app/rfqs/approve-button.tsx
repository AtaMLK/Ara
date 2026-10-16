'use client';

import {T,useI18n} from '@/components/language';
import { useState } from 'react';
import { approveRfqAction, sendRfqAction } from '@/app/actions';

export function ApproveRfqButton({ id }: { id: string }) {
  const {t}=useI18n();
  const [loading, setLoading] = useState(false);
  async function approve() {
    if (!window.confirm(t('Approve this RFQ?'))) return;
    setLoading(true);
    try { await approveRfqAction(id); window.location.reload(); }
    catch { setLoading(false); }
  }
  return <button className="primary-button" onClick={approve} disabled={loading}><T>{loading ? 'Approving…' : 'Approve'}</T></button>;
}

export function SendRfqButton({ id }: { id: string }) {
  const {t}=useI18n();
  const [loading, setLoading] = useState(false);
  async function send() {
    if (!window.confirm(t('Send this RFQ to the supplier now?'))) return;
    setLoading(true);
    try { await sendRfqAction(id); window.location.reload(); }
    catch { setLoading(false); }
  }
  return <button className="secondary-button" onClick={send} disabled={loading}><T>{loading ? 'Sending…' : 'Send email'}</T></button>;
}
