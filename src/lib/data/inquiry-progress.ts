import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {inquiryProgress} from '@/lib/ui/inquiry-progress';
// Call only after inquiry access has been checked. Return workflow facts only,
// never supplier identities, costs, private messages or internal failure text.
export async function loadInquiryProgress(inquiryId:string) {
  const db=createSupabaseAdminClient();
  const results=await Promise.all([
    db.from('inquiries').select('status').eq('id',inquiryId).single(),
    db.from('ai_executions').select('agent_id,status').eq('inquiry_id',inquiryId),
    db.from('research_cases').select('status').eq('inquiry_id',inquiryId),
    db.from('rfqs').select('status,sent_at').eq('inquiry_id',inquiryId),
    db.from('supplier_responses').select('status').eq('inquiry_id',inquiryId),
    db.from('clarifications').select('status').eq('inquiry_id',inquiryId),
    db.from('customer_quotes').select('status').eq('inquiry_id',inquiryId),
  ]);
  for(const result of results)if(result.error)throw new Error('Could not load inquiry progress');
  const [inquiry,executions,research,rfqs,responses,clarifications,quotes]=results;
  return inquiryProgress({status:inquiry.data?.status??'processing',aiComplete:(executions.data??[]).some(e=>e.agent_id==='intake'&&e.status==='succeeded'),researchComplete:(research.data??[]).some(r=>r.status==='completed'),verified:(rfqs.data??[]).length>0,rfqSent:(rfqs.data??[]).some(r=>r.status==='sent'||r.sent_at),responseReceived:(responses.data??[]).length>0,clarificationPending:(clarifications.data??[]).some(c=>c.status==='sent'),quoteStatuses:(quotes.data??[]).map(q=>q.status)});
}
