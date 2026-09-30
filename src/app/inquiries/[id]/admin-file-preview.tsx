'use client';

import { useState } from 'react';
import { Download, Eye, X } from 'lucide-react';
import { getAdminInquiryFileUrlAction } from '@/app/actions';

type Props = {
  inquiryId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
};

export default function AdminFilePreview({ inquiryId, fileId, fileName, mimeType }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canPreview = mimeType === 'application/pdf' || mimeType.startsWith('image/');

  async function loadFile() {
    setLoading(true);
    setError('');
    try {
      const result = await getAdminInquiryFileUrlAction({ inquiryId, fileId });
      setUrl(result.url);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open file.');
    } finally {
      setLoading(false);
    }
  }

  async function downloadFile() {
    setLoading(true);
    setError('');
    try {
      const result = await getAdminInquiryFileUrlAction({ inquiryId, fileId });
      const response = await fetch(result.url);
      if (!response.ok) throw new Error('File download failed.');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download file.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="file-actions">
        {canPreview && (
          <button className="inline-button" type="button" onClick={loadFile} disabled={loading}>
            <Eye size={14} aria-hidden="true" />
            {loading ? 'Opening…' : 'Preview'}
          </button>
        )}
        <button className="inline-button" type="button" onClick={downloadFile} disabled={loading}>
          <Download size={14} aria-hidden="true" />
          Download
        </button>
      </div>

      {error && <div className="error-inline file-action-error">{error}</div>}

      {open && url && (
        <div className="file-preview-backdrop" role="dialog" aria-modal="true" aria-label={fileName}>
          <div className="file-preview-modal">
            <div className="file-preview-head">
              <div>
                <strong>{fileName}</strong>
                <div className="muted">{mimeType}</div>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close preview"
                title="Close preview"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="file-preview-body">
              {mimeType === 'application/pdf' ? (
                <iframe title={fileName} src={url} />
              ) : (
                <img src={url} alt={fileName} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
