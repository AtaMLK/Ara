import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireAdmin,requireInquiryAccess} from '../guards';

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
 const {data:quote,error:qerr}=await supabase.from('customer_quotes').select('status').eq('id',value.customerQuoteId).single();
 if(qerr||!quote) throw new ToolError('NOT_FOUND','Customer Quote not found');
 if(quote.status!=='draft'&&quote.status!=='pending_approval') throw new ToolError('CONFLICT','Quote is not editable');
 const {data,error}=await supabase.from('customer_quote_items').insert(value).select('*').single();
 if(error) throw new ToolError('CONFLICT',error.message); return data;
}
export async function requestQuoteApproval(quoteId:string){
 const {supabase}=await requireAdmin(); const {data,error}=await supabase.from('customer_quotes').update({status:'pending_approval'}).eq('id',quoteId).eq('status','draft').select('*').single();
 if(error||!data) throw new ToolError('CONFLICT','Quote is not in Draft state'); return data;
}
export async function approveCustomerQuote(quoteId:string){
 const {supabase,user}=await requireAdmin(); const {data,error}=await supabase.from('customer_quotes').update({status:'sent',approved_by:user.id,approved_at:new Date().toISOString()}).eq('id',quoteId).eq('status','pending_approval').select('*').single();
 if(error||!data) throw new ToolError('CONFLICT','Quote is not awaiting approval'); return data;
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
