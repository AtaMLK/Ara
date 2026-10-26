import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import { SUPPLIER_BATCH_SIZE,isSupplierEvidenceSource,supplierHost } from './supplier-policy';
export async function getSupplierReviewProgress(inquiryId:string) {
  const db=createSupabaseAdminClient();
  const research=await db.from('research_cases').select('id,scope').eq('inquiry_id',inquiryId).eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(research.error) throw new ToolError('TRANSIENT',research.error.message);
  if(!research.data) return {} as Record<string,{limit:number;hasMore:boolean;reviewing?:boolean}>;
  const results=await db.from('research_results').select('source_url,structured_data,finding').eq('research_case_id',research.data.id);
  if(results.error) throw new ToolError('TRANSIENT',results.error.message);
  const candidates=await db.from('supplier_candidates').select('requirement_id,proposed_website,status').eq('inquiry_id',inquiryId);
  if(candidates.error)throw new ToolError('TRANSIENT',candidates.error.message);
  const execution=await db.from('ai_executions').select('status,output_ref').eq('task_key',`inquiry:${inquiryId}:stage:supplier_discovery`).maybeSingle();
  if(execution.error)throw new ToolError('TRANSIENT',execution.error.message);
  const reviewing=['queued','running'].includes(execution.data?.status??'')&&execution.data?.output_ref?.backfill_pending===true;
  const reviewed=(research.data.scope?.supplier_reviewed_domains??{}) as Record<string,string[]>;
  const domains=new Map<string,Set<string>>();
  for(const row of results.data ?? []) {
    if(!isSupplierEvidenceSource(row))continue;
    const id=String(row.structured_data?.arat_requirement_id??''),host=supplierHost(row.source_url);
    const set=domains.get(id)??new Set<string>();domains.set(id,set);
    if(reviewed[id]?.includes(host)||candidates.data?.some(c=>c.requirement_id===id&&c.status==='finalized'&&supplierHost(c.proposed_website)===host))continue;
    set.add(host);
  }
  const targets=(research.data.scope?.supplier_review_targets ?? research.data.scope?.supplier_review_limits ?? {}) as Record<string,number>;
  return Object.fromEntries([...domains].map(([id,hosts])=>[id,{limit:targets[id] ?? SUPPLIER_BATCH_SIZE,hasMore:hosts.size>0,reviewing}]));
}
