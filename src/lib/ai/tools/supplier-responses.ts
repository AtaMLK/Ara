import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireAdmin} from '../guards';

const responseSchema=z.object({communicationId:z.string().uuid(),supplierId:z.string().uuid(),inquiryId:z.string().uuid(),rawExtraction:z.record(z.string(),z.unknown()).default({}),attachments:z.array(z.unknown()).default([])});

export async function createSupplierResponse(ctx:AIContext,input:unknown){
  const value=responseSchema.parse(input);
  const {supabase}=await requireAdmin();
  const {data,error}=await supabase.from('supplier_responses').insert({
    communication_id:value.communicationId,supplier_id:value.supplierId,inquiry_id:value.inquiryId,
    status:'received',raw_extraction:value.rawExtraction,attachments:value.attachments
  }).select('*').single();
  if(error) throw new ToolError('CONFLICT',error.message);
  return data;
}

const quoteSchema=z.object({supplierResponseId:z.string().uuid(),productId:z.string().uuid().optional(),matchStatus:z.enum(['match','partial_match','mismatch','unknown']).default('unknown'),currency:z.string().length(3).optional(),quantity:z.number().nonnegative().optional(),moq:z.number().nonnegative().optional(),netPrice:z.number().nonnegative().optional(),validUntil:z.string().optional(),leadTimeText:z.string().optional(),availability:z.string().optional(),paymentTerms:z.string().optional(),incoterm:z.string().optional(),deliveryMethod:z.string().optional(),originalData:z.record(z.string(),z.unknown()).default({})});

export async function createSupplierQuote(ctx:AIContext,input:unknown){
  const value=quoteSchema.parse(input);
  const {supabase}=await requireAdmin();
  if(value.netPrice!==undefined && !value.currency) throw new ToolError('VALIDATION','Price requires currency');
  if(value.netPrice!==undefined && value.matchStatus==='mismatch') throw new ToolError('VALIDATION','A mismatched quote cannot carry a final price');
  if(value.currency && value.currency.length!==3) throw new ToolError('VALIDATION','Currency must be a 3-letter code');
  const {data,error}=await supabase.from('supplier_quotes').insert({
    supplier_response_id:value.supplierResponseId,product_id:value.productId,match_status:value.matchStatus,
    currency:value.currency,quantity:value.quantity,moq:value.moq,net_price:value.netPrice,
    valid_until:value.validUntil,lead_time_text:value.leadTimeText,availability:value.availability,
    payment_terms:value.paymentTerms,incoterm:value.incoterm,delivery_method:value.deliveryMethod,
    original_data:value.originalData
  }).select('*').single();
  if(error) throw new ToolError('CONFLICT',error.message);
  return data;
}
