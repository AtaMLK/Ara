export function getInquiryDisplayReference(
  reference: string,
  customerName?: string | null,
  createdAt?: string | null,
  currentVersion?: number | null,
  updatedAt?: string | null,
) {
  const source = (customerName ?? '').trim();
  const initials = source
    ? (() => { const parts = source.split(/\s+/).filter(Boolean); return (parts.length > 1 ? parts.map((part) => part[0]).join('') : parts[0].slice(0, 2)).toUpperCase(); })()
    : reference.split('-')[0] || 'REQ';

  const dateSource = createdAt ? new Date(createdAt) : null;
  const date = dateSource && !Number.isNaN(dateSource.getTime())
    ? String(dateSource.getUTCFullYear()) + String(dateSource.getUTCMonth() + 1).padStart(2, '0') + String(dateSource.getUTCDate()).padStart(2, '0')
    : '';

  const version = Math.max(1, currentVersion ?? 1);
  const revision = version > 1 ? 'R' + (version - 1) : '';
  let changedDays = '';
  if (version > 1 && createdAt && updatedAt) {
    const created = new Date(createdAt).getTime();
    const updated = new Date(updatedAt).getTime();
    if (Number.isFinite(created) && Number.isFinite(updated)) {
      const days = Math.max(0, Math.ceil((updated - created) / 86400000));
      changedDays = '+' + days + 'd';
    }
  }

  return [initials, date].filter(Boolean).join('-') + (revision ? ' · ' + revision + (changedDays ? ' · ' + changedDays : '') : '');
}