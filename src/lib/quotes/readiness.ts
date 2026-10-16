import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {inquiryItems} from '@/lib/ui/inquiry-items';

export type OfferLine={is_selected?:boolean;price_status?:string;unit_price?:number|null;quantity?:number;price_calculation?:Record<string,unknown>|null};
export function quoteCoverage(requested:Array<{sourceRef?:string;label:string;quantity:string}>,offers:OfferLine[]) {
  const selected=offers.filter(line=>line.is_selected!==false);
  const problems:string[]=[];
  if(!selected.length)problems.push('Choose at least one supplier offer.');
  for(const item of requested){
    const matching=selected.filter(line=>item.sourceRef?line.price_calculation?.source_ref===item.sourceRef:requested.length===1&&selected.length===1);
    if(matching.length===0)problems.push('Choose an offer for '+item.label+'.');
    if(matching.length>1)problems.push('Choose only one supplier offer for '+item.label+'.');
  }
  if(requested.length>1&&selected.some(line=>!requested.some(item=>item.sourceRef&&item.sourceRef===line.price_calculation?.source_ref)))problems.push('Link every selected supplier offer to its requested item.');
  if(selected.some(line=>line.unit_price==null||line.price_status!=='admin_confirmed'))problems.push('Confirm every selected customer price.');
  return {selected,problems};
}

// Shared by approval and document/send paths: a partial supplier reply must not
// silently turn a multi-item inquiry into an incomplete customer quotation.
export async function getQuoteReadiness(quoteId:string) {
  const db=createSupabaseAdminClient();
  const {data:quote,error}=await db.from('customer_quotes').select('id,inquiry_id').eq('id',quoteId).single();
  if(error||!quote)throw new Error('Quotation not found.');
  const [inquiry,requirements,items,pending,jobs]=await Promise.all([
    db.from('inquiries').select('normalized_information').eq('id',quote.inquiry_id).single(),
    db.from('requirements').select('id,type,value,source_ref,status,admin_edited').eq('inquiry_id',quote.inquiry_id).eq('status','confirmed'),
    db.from('customer_quote_items').select('is_selected,quantity,price_status,unit_price,price_calculation').eq('customer_quote_id',quoteId),
    db.from('supplier_responses').select('id').eq('inquiry_id',quote.inquiry_id).in('status',['received','processing']),
    db.from('ai_executions').select('id').eq('inquiry_id',quote.inquiry_id).in('agent_id',['quote_extraction','comparison','customer_quote']).in('status',['queued','running']),
  ]);
  for(const result of [inquiry,requirements,items,pending,jobs])if(result.error)throw new Error('Quotation readiness could not be checked.');
  const requested=inquiryItems(inquiry.data?.normalized_information,requirements.data??[]);
  const result=quoteCoverage(requested,items.data??[]);
  if(pending.data?.length||jobs.data?.length)result.problems.push('Supplier replies are still being processed.');
  return {...result,requestedCount:requested.length};
}

export async function assertQuoteReady(quoteId:string) {
  const readiness=await getQuoteReadiness(quoteId);
  if(readiness.problems.length)throw new Error(readiness.problems.join(' '));
}
