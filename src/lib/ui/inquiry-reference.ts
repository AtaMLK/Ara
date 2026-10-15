export function getInquiryDisplayReference(
  reference: string,
  customerName?: string | null,
  createdAt?: string | null,
  currentVersion?: number | null,
  updatedAt?: string | null,
) {
  const dateSource = createdAt ? new Date(createdAt) : null;
  const date = dateSource && !Number.isNaN(dateSource.getTime())
    ? String(dateSource.getUTCFullYear()) + String(dateSource.getUTCMonth() + 1).padStart(2, '0') + String(dateSource.getUTCDate()).padStart(2, '0')
    : reference.match(/(?:^|-)(\d{8})(?:-|$)/)?.[1] || '';

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

  const suffix=reference.match(/-([A-Za-z0-9]{6})$/)?.[1]?.toUpperCase();
  return ['AO', date, suffix].filter(Boolean).join('-') + (revision ? ' · ' + revision + (changedDays ? ' · ' + changedDays : '') : '');
}

export function getQuoteReference(inquiryReference:string,ordinal=1,revision=0) {
  const base=inquiryReference.split(' · ')[0].replace(/[^A-Za-z0-9-]/g,'');
  return `${base}-Q${Math.max(1,ordinal)}${revision>0?'-R'+revision:''}`;
}
