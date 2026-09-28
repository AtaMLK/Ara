import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireAdmin,requireInquiryAccess} from '../guards';

function revisionReference(base:string,revision:number){ return `${base}-R${revision}`; }

const draftSchema=z.object({inquiryId:z.string().uuid(),customerId:z.string().uuid(),currency:z.string().length(3),validUntil:z.string().optional(),subject:z.string().optional(),body:z.string().optional()});
const itemSchema=z.object({customerQuoteId:z.string().uuid(),supplierQuoteId:z.string().uuid().optional(),productId:z.string().uuid().optional(),quantity:z.number().positive(),unitPrice:z.number().nonnegative(),supplierCost:z.number().nonnegative().optional(),supplierCurrency:z.string().length(3).optional(),exchangeRateId:z.string().uuid().optional()});
const revisionSchema=z.object({quoteId:z.string().uuid(),reason:z.enum(['price','quantity','delivery_time','product_specification','payment_terms','other']),freeText:z.string().optional()});

export async function createCustomerQuoteDraft(ctx:AIContext,input:unknown){
 const value=draftSchema.parse(input); await requireInquiryAccess(ctx,value.inquiryId); const {supabase}=await requireAdmin();
 const {data,error}=await supabase.from('customer_quotes').insert({inquiry_id:value.inquiryId,customer_id:value.customerId,reference:'DRAFT-'+crypto.randomUUID(),currency:value.currency,valid_until:value.validUntil,subject:value.subject,body:value.body,status:'draft'}).select('*').single();
 if(error) throw new ToolError('CONFLICT',error.message); return data;
}
export async function addCustomerQuoteItem(ctx:AIContext,input:unknown){
 const value=itemSchema.parse(input); const {supabase}=await requireAdmin();
 if(value.supplierCost!==undefined && !value.supplierCurrency) throw new ToolError('VALIDATION','Supplier cost requires supplier currency');
 if(value.exchangeRateId && (!value.supplierCost || !value.supplierCurrency)) throw new ToolError('VALIDATION','Exchange rate requires supplier cost and supplier currency');
 const {data:quote,error:qerr}=await supabase.from('customer_quotes').select('status').eq('id',value.customerQuoteId).single();
 if(qerr||!quote) throw new ToolError('NOT_FOUND','Customer Quote not found');
 if(quote.status!=='draft'&&quote.status!=='pending_approval') throw new ToolError('CONFLICT','Quote is not editable');
 const {data,error}=await supabase.from('customer_quote_items').insert(value).select('*').single();
 if(error) throw new ToolError('CONFLICT',error.message); return data;
}
export async function requestQuoteApproval(quoteId:string){
 const {supabase}=await requireAdmin();
 const {data:items,error:itemError}=await supabase.from('customer_quote_items').select('id,price_status').eq('customer_quote_id',quoteId);
 if(itemError) throw new ToolError('TRANSIENT',itemError.message);
 if(!items?.length || items.some((item)=>item.price_status!=='admin_confirmed')) throw new ToolError('APPROVAL_REQUIRED','Every customer quote item price must be confirmed by Admin');
 const {data,error}=await supabase.from('customer_quotes').update({status:'pending_approval'}).eq('id',quoteId).eq('status','draft').select('*').single();
 if(error||!data) throw new ToolError('CONFLICT','Quote is not in Draft state'); return data;
}
export async function approveCustomerQuote(quoteId:string){
 const {supabase,user}=await requireAdmin();
 const {data:items,error:itemError}=await supabase.from('customer_quote_items').select('id,price_status').eq('customer_quote_id',quoteId);
 if(itemError) throw new ToolError('TRANSIENT',itemError.message);
 if(!items?.length || items.some((item)=>item.price_status!=='admin_confirmed')) throw new ToolError('APPROVAL_REQUIRED','Every customer quote item price must be confirmed by Admin'); const {data,error}=await supabase.from('customer_quotes').update({status:'sent',approved_by:user.id,approved_at:new Date().toISOString()}).eq('id',quoteId).eq('status','pending_approval').select('*').single();
 if(error||!data) throw new ToolError('CONFLICT','Quote is not awaiting approval'); return data;
}

export async function createQuoteRevision(ctx:AIContext,quoteId:string){
  const {supabase}=await requireAdmin();

  const {data:parent,error:parentError}=await supabase
    .from('customer_quotes')
    .select('*')
    .eq('id',quoteId)
    .single();

  if(parentError||!parent) throw new ToolError('NOT_FOUND','Customer Quote not found');
  if(parent.status==='accepted') throw new ToolError('CONFLICT','Accepted quote cannot be revised');
  if(!['sent','rejected','expired','revision_requested'].includes(parent.status)) {
    throw new ToolError('CONFLICT','Only sent, rejected, expired, or revision-requested quotes can create a revision');
  }

  const revisionNumber=(parent.revision_number ?? 0)+1;
  const reference=revisionReference(parent.reference.replace(/-R\d+$/,''),revisionNumber);

  const {data:revision,error}=await supabase
    .from('customer_quotes')
    .insert({
      inquiry_id:parent.inquiry_id,
      customer_id:parent.customer_id,
      parent_quote_id:parent.id,
      reference,
      revision_number:revisionNumber,
      status:'draft',
      currency:parent.currency,
      valid_until:parent.valid_until,
      subject:parent.subject,
      body:parent.body,
    })
    .select('*')
    .single();

  if(error||!revision) throw new ToolError('CONFLICT',error?.message ?? 'Quote revision creation failed');

  const {data:items,error:itemError}=await supabase
    .from('customer_quote_items')
    .select('supplier_quote_id,product_id,quantity,unit_price,exchange_rate_id,supplier_cost,supplier_currency')
    .eq('customer_quote_id',parent.id);

  if(itemError) throw new ToolError('TRANSIENT',itemError.message);

  if(items?.length){
    const {error:copyError}=await supabase.from('customer_quote_items').insert(
      items.map((item)=>({customer_quote_id:revision.id,...item}))
    );
    if(copyError) throw new ToolError('CONFLICT',copyError.message);
  }

  await supabase.from('customer_quotes')
    .update({status:'revision_requested'})
    .eq('id',parent.id)
    .in('status',['sent','rejected','expired']);

  return revision;
}

export async function requestQuoteRevision(ctx:AIContext,input:unknown){
 const value=revisionSchema.parse(input); const {supabase}=await requireAdmin();
 const {data:quote,error:qerr}=await supabase.from('customer_quotes').select('status').eq('id',value.quoteId).single();
 if(qerr||!quote) throw new ToolError('NOT_FOUND','Quote not found');
 if(quote.status==='accepted') throw new ToolError('CONFLICT','Accepted quote cannot be revised');
 const {data,error}=await supabase.from('quote_revision_requests').insert({quote_id:value.quoteId,reason:value.reason,free_text:value.freeText,status:'pending_approval'}).select('*').single();
 if(error) throw new ToolError('CONFLICT',error.message);
 await supabase.from('customer_quotes').update({status:'revision_requested'}).eq('id',value.quoteId); return data;
}
