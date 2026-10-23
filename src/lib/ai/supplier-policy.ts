export const SUPPLIER_BATCH_SIZE = 5;
export function canonicalBrand(value: string): string {
  const key = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['gmi','gminternational','gmigminternational'].includes(key)) return 'GMI';
  if (key === 'ctc' || key === 'connectiontechnologycenter' || key === 'connectiontechnologyccenter' || /^ctcconnectiontechnologyc?center$/.test(key)) return 'CTC';
  if (key === 'hansford' || key.startsWith('hansfordsensors')) return 'HANSFORD SENSORS';
  return key;
}
export function isExclusiveBrand(value: string) {
  return ['GMI','CTC','HANSFORD SENSORS'].includes(canonicalBrand(value));
}
export function isAryaPreferredBrand(value: string) {
  return isExclusiveBrand(value) || canonicalBrand(value) === 'siemens';
}
export function isAryaWebsite(value: string | null | undefined) {
  try { return new URL(value ?? '').hostname.toLowerCase().replace(/^www\./,'') === 'aryaautomation.com'; } catch { return false; }
}
export type BrandRequirement = {id:string;type:string;value:string;source_ref?:string|null};
export function productBrand(product: BrandRequirement, rows: BrandRequirement[]) {
  const stated = rows.find(row => Boolean(product.source_ref) && row.source_ref === product.source_ref && row.type === 'specification' && /^(brand|manufacturer|marka)\s*:/i.test(row.value));
  if (stated) return canonicalBrand(stated.value.replace(/^(brand|manufacturer|marka)\s*:\s*/i,''));
  const exclusive = product.value.match(/\b(?:G\.?M\.?\s+INTERNATIONAL|GMI|CTC|SIEMENS|HANSFORD(?:\s+SENSORS)?)\b/i)?.[0];
  return exclusive ? canonicalBrand(exclusive) : '';
}
/** Prioritize Turkish evidence before paging without treating locale as verification. */
export function supplierEvidencePriority(row: {source_url:string;structured_data:Record<string,unknown>|null;finding?:string|null}) {
  try {
    const host = new URL(row.source_url).hostname.toLowerCase().replace(/^www\./,'');
    if (isAryaWebsite(row.source_url)) return 0;
    if (host.endsWith('.tr')) return 1;
    const country = String(row.structured_data?.country ?? '').toLowerCase();
    if (['turkey','türkiye','turkiye','tr'].includes(country)) return 1;
  } catch {}
  return 2;
}
/** Select only the next page of company domains; remaining evidence stays in storage. */
export function supplierEvidenceBatch<T extends {source_url:string;structured_data:Record<string,unknown>|null}>(
  rows:T[], reviewed:Array<{requirement_id:string|null;proposed_website:string|null;status:string}>, limits:Record<string,number> = {}, reviewedDomains:Record<string,string[]> = {},
) {
  const domains = new Map<string,string[]>();
  const host = (url:string|null) => {try{return new URL(url ?? '').hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}};
  const ordered = [...rows].sort((a,b)=>supplierEvidencePriority(a)-supplierEvidencePriority(b));
  for (const row of ordered) {
    const id = String(row.structured_data?.arat_requirement_id ?? '');
    const domain = host(row.source_url);
    const list = domains.get(id) ?? [];
    if (domain && !list.includes(domain)) list.push(domain);
    domains.set(id,list);
  }
  return ordered.filter(row => {
    const id = String(row.structured_data?.arat_requirement_id ?? '');
    const domain = host(row.source_url);
    if (!domain || !(domains.get(id) ?? []).slice(0,limits[id] ?? SUPPLIER_BATCH_SIZE).includes(domain)) return false;
    if(reviewedDomains[id]?.includes(domain)) return false;
    return !reviewed.some(candidate => candidate.status === 'finalized' && candidate.requirement_id === id && host(candidate.proposed_website) === domain);
  });
}
