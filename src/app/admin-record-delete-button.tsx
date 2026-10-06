'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { X, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { softDeleteInquiryAction, softDeleteSupplierAction } from '@/app/admin-record-actions';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function ConfirmDialog({ open, title, description, loading, onCancel, onConfirm }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="arat-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onCancel();
    }}>
      <div className="arat-dialog" role="dialog" aria-modal="true" aria-labelledby="arat-dialog-title">
        <div className="arat-dialog-icon" aria-hidden="true">
          <AlertTriangle size={18} />
        </div>

        <button
          type="button"
          className="arat-dialog-close"
          onClick={onCancel}
          disabled={loading}
          aria-label="Close"
        >
          <X size={17} />
        </button>

        <h2 id="arat-dialog-title">{title}</h2>
        <p>{description}</p>

        <div className="arat-dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="arat-danger-button" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 size={15} className="arat-spin" /> : <Trash2 size={15} />}
            {loading ? 'Hiding…' : 'Hide'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteSupplierButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function remove() {
    setLoading(true);
    try {
      await softDeleteSupplierAction(id);
      setOpen(false);
      toast.success('Supplier hidden', {
        description: 'The supplier was removed from the active list. Its history is preserved.',
      });
      router.refresh();
    } catch (error) {
      toast.error('Could not hide supplier', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="secondary-button arat-delete-button"
        onClick={() => setOpen(true)}
        disabled={loading}
      >
        Delete
      </button>

      <ConfirmDialog
        open={open}
        title="Hide supplier?"
        description={`“${name}” will disappear from the active supplier list. Its history and related records will be preserved.`}
        loading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={remove}
      />
    </>
  );
}

export function DeleteInquiryButton({ id, reference }: { id: string; reference: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function remove() {
    setLoading(true);
    try {
      await softDeleteInquiryAction(id);
      setOpen(false);
      toast.success('Inquiry hidden', {
        description: 'The inquiry was removed from the active list. Its history is preserved.',
      });
      router.refresh();
    } catch (error) {
      toast.error('Could not hide inquiry', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="secondary-button arat-delete-button"
        onClick={() => setOpen(true)}
        disabled={loading}
      >
        Delete
      </button>

      <ConfirmDialog
        open={open}
        title="Hide inquiry?"
        description={`“${reference}” will disappear from the active inquiry list. Its history and related records will be preserved.`}
        loading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={remove}
      />
    </>
  );
}
