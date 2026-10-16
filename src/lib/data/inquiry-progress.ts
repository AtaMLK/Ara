import 'server-only';
import {oneRelated} from './relations';
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
    db.from('customer_quotes').select('id,status').eq('inquiry_id',inquiryId),
  ]);
  for(const result of results)if(result.error)throw new Error('Could not load inquiry progress');
  const [inquiry,executions,research,rfqs,responses,clarifications,quotes]=results;
  let supplierOrdersComplete=false;
  const acceptedIds=(quotes.data??[]).filter(quote=>quote.status==='accepted').map(quote=>quote.id);
  if(acceptedIds.length){
    const [items,orders]=await Promise.all([
      db.from('customer_quote_items').select('customer_quote_id,supplier_quotes(supplier_responses(supplier_id))').in('customer_quote_id',acceptedIds).eq('is_selected',true),
      db.from('supplier_order_confirmations').select('customer_quote_id,supplier_id,status').in('customer_quote_id',acceptedIds),
    ]);
    if(items.error||orders.error)throw new Error('Could not load supplier order progress');
    supplierOrdersComplete=!!items.data?.length&&items.data.every(item=>{
      const supplierId=oneRelated(oneRelated(item.supplier_quotes)?.supplier_responses)?.supplier_id;
      return !!supplierId&&orders.data?.some(order=>order.customer_quote_id===item.customer_quote_id&&order.supplier_id===supplierId&&order.status==='sent');
    });
  }
  return inquiryProgress({supplierOrdersComplete,status:inquiry.data?.status??'processing',aiComplete:(executions.data??[]).some(e=>e.agent_id==='intake'&&e.status==='succeeded'),researchComplete:(research.data??[]).some(r=>r.status==='completed'),verified:(rfqs.data??[]).length>0,rfqSent:(rfqs.data??[]).some(r=>r.status==='sent'||r.sent_at),responseReceived:(responses.data??[]).length>0,clarificationPending:(clarifications.data??[]).some(c=>c.status==='sent'),quoteStatuses:(quotes.data??[]).map(q=>q.status)});
}
