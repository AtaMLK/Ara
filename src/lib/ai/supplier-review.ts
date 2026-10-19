import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import { SUPPLIER_BATCH_SIZE } from './supplier-policy';
export async function getSupplierReviewProgress(inquiryId:string) {
  const db=createSupabaseAdminClient();
  const research=await db.from('research_cases').select('id,scope').eq('inquiry_id',inquiryId).eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(research.error) throw new ToolError('TRANSIENT',research.error.message);
  if(!research.data) return {} as Record<string,{limit:number;hasMore:boolean}>;
  const results=await db.from('research_results').select('source_url,structured_data').eq('research_case_id',research.data.id);
  if(results.error) throw new ToolError('TRANSIENT',results.error.message);
  const domains=new Map<string,Set<string>>();
  for(const row of results.data ?? []) {
    try {const id=String(row.structured_data?.arat_requirement_id ?? '');const set=domains.get(id) ?? new Set<string>();set.add(new URL(row.source_url).hostname.replace(/^www\./,''));domains.set(id,set);}catch{}
  }
  const limits=(research.data.scope?.supplier_review_limits ?? {}) as Record<string,number>;
  return Object.fromEntries([...domains].map(([id,hosts])=>[id,{limit:limits[id] ?? SUPPLIER_BATCH_SIZE,hasMore:hosts.size>(limits[id] ?? SUPPLIER_BATCH_SIZE)}]));
}
