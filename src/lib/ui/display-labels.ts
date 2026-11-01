import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {displayText,internalIds,quoteDisplayReference} from './display-text';
import {getInquiryDisplayReference} from './inquiry-reference';
export async function displayLabels(db:SupabaseClient,texts:string[]):Promise<Record<string,string>>{
 const ids=internalIds(texts);if(!ids.length)return {};
 const [requirements,inquiries,quotes,suppliers,rfqs]=await Promise.all([
  db.from('requirements').select('id,type,value').in('id',ids),
  db.from('inquiries').select('id,reference,created_at,current_version,updated_at').in('id',ids),
  db.from('customer_quotes').select('id,reference,display_reference').in('id',ids),
  db.from('suppliers').select('id,legal_name').in('id',ids),
  db.from('rfqs').select('id,rfq_code').in('id',ids),
 ]);
 const labels:Record<string,string>={};
 for(const row of requirements.data??[])labels[row.id]=displayText(row.type.replaceAll('_',' ')+': '+row.value);
 for(const row of inquiries.data??[])labels[row.id]=getInquiryDisplayReference(row.reference,null,row.created_at,row.current_version,row.updated_at);
 for(const row of quotes.data??[])labels[row.id]=quoteDisplayReference(row.reference,row.display_reference);
 for(const row of suppliers.data??[])labels[row.id]=displayText(row.legal_name);
 for(const row of rfqs.data??[])labels[row.id]=row.rfq_code||'Supplier quotation request';
 return labels;
}
