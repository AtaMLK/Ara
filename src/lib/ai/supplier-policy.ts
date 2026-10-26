export const SUPPLIER_BATCH_SIZE = 5;
export type SupplierEvidence={source_url:string;structured_data:Record<string,unknown>|null;finding?:string|null;source_name?:string|null};
export function supplierHost(url:string|null|undefined){
  try{const parsed=new URL(url??'');return ['http:','https:'].includes(parsed.protocol)?parsed.hostname.toLowerCase().replace(/^www\./,''):'';}catch{return '';}
}
export function isTurkishCountry(country:string|null|undefined){
  return ['turkey','turkiye','tr','tur'].includes((country??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim());
}
/** Published location evidence only: a Turkey search query or shipping destination is not a company address. */
export function supplierCountryEvidence(row:SupplierEvidence):{country:string;basis:string;text:string}|null{
  const country=String(row.structured_data?.country??'').trim();
  if(country&&!/^(unknown|not stated|n\/a)$/i.test(country)){
    const evidence=row.structured_data?.arat_country_evidence as {basis?:string;text?:string}|undefined;
    return {country:isTurkishCountry(country)?'Turkey':country,basis:evidence?.basis??'published_country',text:evidence?.text??country};
  }
  const address=String(row.structured_data?.address??row.structured_data?.contact_address??'');
  const text=[address,row.finding??''].join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ı/g,'i');
  const match=text.match(/\b(?:istanbul|ankara|izmir|bursa|kocaeli|konya|antalya|gaziantep|kayseri|sakarya|tekirdag|gebze)\b\s*[,/–-]\s*(?:\d{5}\s*[,/–-]?\s*)?(?:turkey|turkiye)\b/)
    ??text.match(/\b(?:based|located|headquartered)\s+in\s+(?:turkey|turkiye)\b/)
    ??text.match(/\b(?:address|adres|headquarters|office)\s*:\s*[^.!?\n]{0,180}\b(?:istanbul|ankara|izmir|bursa|kocaeli|gebze)\b[^.!?\n]{0,50}\b(?:turkey|turkiye)\b/);
  return match?{country:'Turkey',basis:'published_address',text:match[0]}:null;
}
/** Obvious information portals must not consume the five-company research window. */
export function isSupplierEvidenceSource(row:SupplierEvidence){
  const host=supplierHost(row.source_url);
  if(!host)return false;
  if(row.structured_data?.arat_source_kind==='marketplace')return false;
  if(/^(?:support|docs|developer|documentation)\./.test(host)||host==='industry-mobile-support.siemens-info.com')return false;
  if(/(^|\.)(?:datasheet\.live|alldatasheet\.(?:com|net)|indiamart\.com|made-in-china\.com|sahibinden\.com|stocktuner\.com)$/.test(host))return false;
  return !/(^|\.)(?:google\.[a-z.]+|youtube\.com|wikipedia\.org|linkedin\.com|facebook\.com|instagram\.com|amazon\.[a-z.]+|ebay\.[a-z.]+|alibaba\.com|researchgate\.net|sciencedirect\.com|scribd\.com)$/.test(host)
    &&!/(?:^|\.)(?:gov|edu)(?:\.[a-z]{2})?$/.test(host);
}

type ReviewedCandidate={requirement_id:string|null;proposed_website:string|null;status:string;supplier_id?:string|null};
export function uniqueSupplierCandidates<T extends {requirement_id:string|null;supplier_id?:string|null;proposed_website?:string|null}>(rows:T[]){
  const ids=new Set<string>(),hosts=new Set<string>();
  return rows.filter(row=>{
    const id=row.supplier_id?row.requirement_id+'::'+row.supplier_id:'';
    const host=supplierHost(row.proposed_website),key=row.requirement_id+'::'+host;
    if(id&&ids.has(id)||host&&hosts.has(key))return false;
    if(id)ids.add(id);if(host)hosts.add(key);return true;
  });
}
export function supplierReviewBackfill(rows:SupplierEvidence[],candidates:ReviewedCandidate[],limits:Record<string,number>,reviewed:Record<string,string[]>,targets:Record<string,number>={}){
  const next={...limits};let needed=false;
  const ids=new Set(rows.filter(isSupplierEvidenceSource).map(r=>String(r.structured_data?.arat_requirement_id??'')));
  for(const id of ids){
    const companies=new Set(uniqueSupplierCandidates(candidates.filter(c=>c.requirement_id===id&&c.status==='finalized')).map(c=>c.supplier_id||supplierHost(c.proposed_website)).filter(Boolean));
    if(companies.size>=(targets[id]??SUPPLIER_BATCH_SIZE))continue;
    if(rows.some(r=>String(r.structured_data?.arat_requirement_id??'')===id&&isSupplierEvidenceSource(r)&&!reviewed[id]?.includes(supplierHost(r.source_url))&&!candidates.some(c=>c.requirement_id===id&&c.status==='finalized'&&supplierHost(c.proposed_website)===supplierHost(r.source_url)))){
      next[id]=(limits[id]??SUPPLIER_BATCH_SIZE)+SUPPLIER_BATCH_SIZE;needed=true;
    }
  }
  return {needed,limits:next};
}
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
export function supplierEvidencePriority(row: SupplierEvidence) {
  try {
    const host = new URL(row.source_url).hostname.toLowerCase().replace(/^www\./,'');
    if (isAryaWebsite(row.source_url)) return 0;
    const location=supplierCountryEvidence(row);
    if(location)return isTurkishCountry(location.country)?1:2;
    if (host.endsWith('.tr')) return 1;
  } catch {}
  return 2;
}
/** Select only the next page of company domains; remaining evidence stays in storage. */
export function supplierEvidenceBatch<T extends {source_url:string;structured_data:Record<string,unknown>|null}>(
  rows:T[], reviewed:Array<{requirement_id:string|null;proposed_website:string|null;status:string}>, limits:Record<string,number> = {}, reviewedDomains:Record<string,string[]> = {},
) {
  const domains = new Map<string,string[]>();
  const host = supplierHost;
  const ordered = rows.filter(isSupplierEvidenceSource).sort((a,b)=>supplierEvidencePriority(a)-supplierEvidencePriority(b));
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
