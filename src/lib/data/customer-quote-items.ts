import 'server-only';
import {requireCustomerAccess} from '@/lib/ai/guards';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';

// The internal table also contains supplier costs and markup. Expose only this
// fixed projection, after session ownership and visible quotation status checks.
export async function loadCustomerQuoteItems(quoteIds:string[]) {
  if(!quoteIds.length)return [];
  const {supabase,customer}=await requireCustomerAccess();
  const {data:quotes,error}=await supabase.from('customer_quotes').select('id')
    .in('id',quoteIds).eq('customer_id',customer.id)
    .in('status',['sent','accepted','rejected','revision_requested','superseded']);
  if(error)throw new Error('Quotation access could not be checked.');
  if(!quotes?.length)return [];
  const {data,error:itemError}=await createSupabaseAdminClient().from('customer_quote_items')
    .select('id,description,model,brand,delivery_text,customer_quote_id,quantity,unit_price,total,supplier_products(product_name,model_part_number)')
    .in('customer_quote_id',quotes.map(quote=>quote.id)).order('created_at',{ascending:true});
  if(itemError)throw new Error('Quotation items could not be loaded.');
  return data??[];
}
