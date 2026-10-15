import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {inquiryItems} from '@/lib/ui/inquiry-items';
import {getInquiryDisplayReference,getQuoteReference} from '@/lib/ui/inquiry-reference';
import {quotationSubject,type QuoteDocument} from './document';
// Authorization is enforced by the page, download endpoint or send action.
export async function loadQuoteDocument(quoteId:string) {
  const db=createSupabaseAdminClient();
  const {data:q,error}=await db.from('customer_quotes').select('id,inquiry_id,customer_id,display_reference,reference,revision_number,parent_quote_id,currency,valid_until,subject,body,status,created_at,sent_at').eq('id',quoteId).single();
  if(error||!q)throw new Error('Quotation not found.');
  const [inquiry,customer,items,requirements,quotes]=await Promise.all([
    db.from('inquiries').select('id,reference,created_at,current_version,updated_at,normalized_information').eq('id',q.inquiry_id).single(),
    db.from('customers').select('name,company_name').eq('id',q.customer_id).single(),
    db.from('customer_quote_items').select('id,description,model,brand,delivery_text,quantity,unit_price,total,price_calculation,price_status').eq('customer_quote_id',q.id).order('created_at',{ascending:true}),
    db.from('requirements').select('id,type,value,source_ref,admin_edited,status').eq('inquiry_id',q.inquiry_id),
    db.from('customer_quotes').select('id,parent_quote_id,created_at').eq('inquiry_id',q.inquiry_id).order('created_at',{ascending:true}),
  ]);
  for(const result of [inquiry,customer,items,requirements,quotes])if(result.error)throw new Error('Quotation details could not be loaded.');
  if(!inquiry.data||!customer.data)throw new Error('Quotation request or customer is missing.');
  const name=customer.data.company_name||customer.data.name||'Customer';
  const inquiryReference=getInquiryDisplayReference(inquiry.data.reference,name,inquiry.data.created_at,1,inquiry.data.updated_at);
  const roots=(quotes.data??[]).filter(row=>!row.parent_quote_id);
  const ordinal=Math.max(1,roots.findIndex(row=>row.id===(q.parent_quote_id||q.id))+1);
  // Keep persisted modern references stable. Legacy sent references remain
  // stored unchanged; use a readable reference in the corrected view/export.
  const reference=q.display_reference||(/^[A-Z0-9]+-\d{8}-Q\d+(?:-R\d+)?$/.test(q.reference)?q.reference:getQuoteReference(inquiryReference,ordinal,q.revision_number));
  const requested=inquiryItems(inquiry.data.normalized_information,requirements.data??[]);
  const lines=(items.data??[]).map(item=>{
    const calc=(item.price_calculation??{}) as Record<string,unknown>;
    const matching=requested.find(request=>request.sourceRef===calc.source_ref)??(requested.length===1?requested[0]:undefined);
    const description=item.description||matching?.fullDescription;
    if(!description)throw new Error('A quote item is missing its inquiry description. Edit the item before preparing the customer document.');
    return {description,model:item.model||matching?.model||'',brand:item.brand||matching?.brand||'',delivery:item.delivery_text||String(calc.customer_delivery||''),quantity:Number(item.quantity),unitPrice:Number(item.unit_price??0),total:Number(item.total??0)};
  });
  const date=new Date(q.sent_at||q.created_at).toLocaleDateString('en-GB',{timeZone:'Europe/Istanbul'});
  const baseUrl=(process.env.NEXT_PUBLIC_APP_URL||'').replace(/\/$/,'');
  // Local development addresses cannot be opened by an external customer.
  const externalUrl=baseUrl&&!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(baseUrl);
  const document:QuoteDocument={reference,inquiryReference,customerName:name,currency:q.currency,date,validUntil:q.valid_until,message:q.body,
    portalUrl:externalUrl?baseUrl+'/customer/quotes/'+q.inquiry_id:undefined,lines};
  const subject=!q.subject||/^(?:Quotation\s*[—-]|Quotation.*(?:DRAFT-|CUS-))/i.test(q.subject)?quotationSubject(reference,lines[0]?.model):q.subject;
  return {document,subject,status:q.status,recordReference:q.reference,inquiryId:q.inquiry_id,unconfirmed:(items.data??[]).some(item=>item.unit_price==null||item.price_status!=='admin_confirmed')};
}
