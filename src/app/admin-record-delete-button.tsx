'use client';

import { useState } from 'react';
import { softDeleteInquiryAction, softDeleteSupplierAction } from '@/app/admin-record-actions';

export function DeleteSupplierButton({ id, name }: { id: string; name: string }) {
  const [loading, setLoading] = useState(false);

  async function remove() {
    if (!window.confirm(`Hide supplier "${name}" from the active supplier list? Its history will be preserved.`)) return;
    setLoading(true);
    try {
      await softDeleteSupplierAction(id);
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not delete supplier.');
      setLoading(false);
    }
  }

  return <button className="secondary-button" onClick={remove} disabled={loading}>{loading ? 'Hiding…' : 'Delete'}</button>;
}

export function DeleteInquiryButton({ id, reference }: { id: string; reference: string }) {
  const [loading, setLoading] = useState(false);

  async function remove() {
    if (!window.confirm(`Hide inquiry "${reference}" from the active inquiry list? Its history will be preserved.`)) return;
    setLoading(true);
    try {
      await softDeleteInquiryAction(id);
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not delete inquiry.');
      setLoading(false);
    }
  }

  return <button className="secondary-button" onClick={remove} disabled={loading}>{loading ? 'Hiding…' : 'Delete'}</button>;
}
