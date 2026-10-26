'use client';

import {T,Localized,useI18n} from '@/components/language';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { X, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { softDeleteInquiryAction, softDeleteSupplierAction } from '@/app/admin-record-actions';
import { createPortal } from 'react-dom';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function ConfirmDialog({ open, title, description, loading, onCancel, onConfirm }: ConfirmDialogProps) {
  const mounted = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);

  useEffect(() => {
    if (!open || !mounted) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, mounted, loading, onCancel]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="arat-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onCancel();
    }}>
      <div className="arat-dialog" role="dialog" aria-modal="true" aria-labelledby="arat-dialog-title">
        <div className="arat-dialog-icon" aria-hidden="true">
          <AlertTriangle size={18} />
        </div>

        <Localized as="button"
          type="button"
          className="arat-dialog-close"
          onClick={onCancel}
          disabled={loading}
          aria-label="Close"
        >
          <X size={17} />
        </Localized>

        <h2 id="arat-dialog-title"><T>{title}</T></h2>
        <p><T>{description}</T></p>

        <div className="arat-dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={loading}><T>
            Cancel
          </T></button>
          <button type="button" className="arat-danger-button" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 size={15} className="arat-spin" /> : <Trash2 size={15} />}
            <T>{loading ? 'Hiding…' : 'Hide'}</T>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DeleteSupplierButton({ id, name }: { id: string; name: string }) {
  const {t}=useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function remove() {
    setLoading(true);
    try {
      await softDeleteSupplierAction(id);
      setOpen(false);
      toast.success(t('Supplier hidden'), {
        description: t('The supplier was removed from the active list. Its history is preserved.'),
      });
      router.refresh();
    } catch (error) {
      toast.error(t('Could not hide supplier'), {
        description: t(error instanceof Error ? error.message : 'Please try again.'),
      });
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="secondary-button arat-delete-button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        disabled={loading}
      ><T>
        Delete
      </T></button>

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
  const {t}=useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function remove() {
    setLoading(true);
    try {
      await softDeleteInquiryAction(id);
      setOpen(false);
      toast.success(t('Inquiry hidden'), {
        description: t('The inquiry was removed from the active list. Its history is preserved.'),
      });
      router.refresh();
    } catch (error) {
      toast.error(t('Could not hide inquiry'), {
        description: t(error instanceof Error ? error.message : 'Please try again.'),
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
      ><T>
        Delete
      </T></button>

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
