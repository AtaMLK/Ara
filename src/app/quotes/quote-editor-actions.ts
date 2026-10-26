'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/ai/guards';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { pricePreview, reviewSupplierTax, reviewSupplierAmount, supplierCommercial, type SupplierCommercial } from '@/lib/quotes/commercial';

export async function selectQuoteOfferAction(itemId:string) {
  z.string().uuid().parse(itemId);
  const {user}=await requireAdmin();
  const db=createSupabaseAdminClient();
  const {data:item,error}=await db.from('customer_quote_items').select('id,customer_quote_id').eq('id',itemId).single();
  if(error||!item)throw new Error('Supplier offer not found.');
  const {error:selectError}=await db.rpc('select_customer_quote_offer',{p_item_id:itemId});
  if(selectError)throw new Error(selectError.message);
  const {error:auditError}=await db.from('audit_logs').insert({actor_type:'admin',actor_user_id:user.id,action:'customer_quote_supplier_offer_selected',record_type:'customer_quote_item',record_id:itemId,metadata:{customer_quote_id:item.customer_quote_id}});
  revalidatePath('/quotes/'+item.customer_quote_id);
  if(auditError)throw new Error('Offer selected; its audit record could not be saved.');
}

const controlsSchema = z.object({
  supplierReview:z.object({amount:z.number().nonnegative().finite(),basis:z.enum(['net','gross']),currency:z.string().regex(/^[A-Z]{3}$/)}).nullable().optional(),
  itemId: z.string().uuid(), quantity: z.number().positive().finite(),quantityUnit:z.string().trim().max(40).optional(),
  description:z.string().trim().min(1).max(2000).optional(),model:z.string().trim().max(300).optional(),brand:z.string().trim().max(300).optional(),
  basis: z.enum(['net','gross']), markupPercent: z.number().min(0).max(10000).nullable(),
  deliveryCost: z.number().nonnegative().finite(), deliveryAllocation: z.enum(['per_unit','per_line']),
  markupOn: z.enum(['goods','landed']), rounding: z.number().nonnegative().max(10000),
  exchangeRateId: z.string().uuid().nullable(),
  taxMode: z.enum(['unknown','excluded','included','exempt']), taxRate: z.number().min(0).max(100).nullable(),
  deliveryMin: z.number().nonnegative().nullable(), deliveryMax: z.number().nonnegative().nullable(),
  deliveryUnit: z.enum(['days','weeks','months','stock','unknown']), businessDays: z.boolean(),
  deliveryNote: z.string().trim().max(1000),
  priceMode: z.enum(['formula','manual']), manualPrice: z.number().nonnegative().finite().nullable(),
  confirm: z.boolean(),
});

export async function saveQuoteCommercialAction(input: z.infer<typeof controlsSchema>) {
  const value = controlsSchema.parse(input);
  const { supabase, user } = await requireAdmin();
  const { data: item, error } = await supabase.from('customer_quote_items')
    .select('id,customer_quote_id,price_calculation,supplier_cost,supplier_currency,unit_price,quantity,price_status')
    .eq('id', value.itemId).single();
  if (error || !item) throw new Error('Quote item not found.');
  const { data: quote } = await supabase.from('customer_quotes').select('id,status,currency').eq('id',item.customer_quote_id).single();
  if (!quote || !['draft','pending_approval'].includes(quote.status)) throw new Error('Only editable quotes can be changed.');
  const snapshot = (item.price_calculation ?? {}) as Record<string, unknown>;
  const saved = snapshot.commercial as Partial<SupplierCommercial> | undefined;
  if (!saved) throw new Error('Supplier cost breakdown is unavailable. Re-prepare this draft before pricing.');
  const defaults=supplierCommercial({netPrice:item.supplier_cost});
  const source={...defaults,...saved,delivery:saved.delivery??defaults.delivery,warnings:saved.warnings??defaults.warnings};
  if (value.deliveryMin != null && value.deliveryMax != null && value.deliveryMax < value.deliveryMin) throw new Error('Maximum delivery must be at least the minimum.');
  const reviewedTax = reviewSupplierTax(source,value.taxMode,value.taxRate);
  const commercial = value.supplierReview ? reviewSupplierAmount(reviewedTax,value.supplierReview) : reviewedTax;
  const supplierCurrency=value.supplierReview?.currency??item.supplier_currency;
  let exchangeRate: number | null = supplierCurrency === quote.currency ? 1 : null;
  let rateId: string | null = null;
  if (exchangeRate == null && value.exchangeRateId) {
    const today = new Date().toISOString().slice(0,10);
    const { data: rate, error: rateError } = await supabase.from('exchange_rates').select('id,rate,valid_from,valid_until')
      .eq('id',value.exchangeRateId).eq('from_currency',supplierCurrency).eq('to_currency',quote.currency)
      .eq('status','approved').lte('valid_from',today).or('valid_until.is.null,valid_until.gte.'+today).single();
    if (rateError || !rate || !Number.isFinite(Number(rate.rate)) || Number(rate.rate) <= 0) throw new Error('Choose a valid approved exchange rate for this currency pair.');
    exchangeRate = Number(rate.rate); rateId = rate.id;
  }
  const preview = pricePreview(commercial, { ...value, exchangeRate });
  const unitPrice = value.priceMode === 'manual' ? value.manualPrice : preview?.unitPrice ?? null;
  if (value.confirm && unitPrice == null) throw new Error('Enter a customer price, or complete the markup, supplier cost and approved exchange rate.');
  if (value.confirm && value.priceMode === 'formula' && commercial.warnings.some(warning => warning.includes('conflict'))) throw new Error('Resolve the supplier tax conflict or enter an explicit manual customer price.');
  const delivery = value.deliveryUnit === 'stock' ? 'In stock' : value.deliveryMin == null || value.deliveryUnit === 'unknown' ? value.deliveryNote :
    `${value.deliveryMin}${value.deliveryMax != null && value.deliveryMax !== value.deliveryMin ? '–'+value.deliveryMax : ''} ${value.businessDays && value.deliveryUnit === 'days' ? 'business ' : ''}${value.deliveryUnit}${value.deliveryNote ? ' — '+value.deliveryNote : ''}`;
  const nextCalculation = { ...snapshot, quantity_unit:value.quantityUnit??snapshot.quantity_unit??'',admin_controls: value, admin_commercial: commercial,
    customer_delivery: delivery, exchange_rate: exchangeRate, markup_percent: value.markupPercent,
    formula: value.markupOn === 'landed' ? '(converted cost + delivery per unit) × (1 + markup / 100)' : 'converted cost × (1 + markup / 100) + delivery per unit',
    confirmed_by: value.confirm ? user.id : null, confirmed_at: value.confirm ? new Date().toISOString() : null };
  const { error: updateError } = await supabase.from('customer_quote_items').update({
    quantity: value.quantity, unit_price: value.confirm ? unitPrice : null,
    price_status: value.confirm ? 'admin_confirmed' : 'suggested', exchange_rate_id: rateId,
    pricing_rule_id: null, price_calculation: nextCalculation,
    delivery_text:delivery||null,
    ...(value.description!==undefined?{description:value.description}:{}),...(value.model!==undefined?{model:value.model}:{}),...(value.brand!==undefined?{brand:value.brand}:{}),
  }).eq('id',item.id);
  if (updateError) throw new Error(updateError.message);
  const { error: auditError } = await createSupabaseAdminClient().from('audit_logs').insert({ actor_type:'admin',actor_user_id:user.id,
    action:value.confirm ? 'customer_quote_commercial_confirmed' : 'customer_quote_commercial_saved',record_type:'customer_quote_item',record_id:item.id,
    before_data:item,after_data:{unit_price:value.confirm?unitPrice:null,price_calculation:nextCalculation,supplier_currency:supplierCurrency,supplier_cost:value.supplierReview?commercial.net:item.supplier_cost},metadata:{customer_quote_id:quote.id} });
  if (auditError) throw new Error('Changes saved, but audit logging failed: '+auditError.message);
  revalidatePath('/quotes/'+quote.id); revalidatePath('/quotes');
  return { ok:true };
}

export async function setDraftCurrencyAction(quoteId: string, currency: string) {
  const value = z.object({quoteId:z.string().uuid(),currency:z.string().regex(/^[A-Z]{3}$/)}).parse({quoteId,currency});
  const {supabase,user}=await requireAdmin();
  const {data:quote}=await supabase.from('customer_quotes').select('id,status,currency').eq('id',value.quoteId).single();
  if (!quote || !['draft','pending_approval'].includes(quote.status)) throw new Error('Only editable quotes can change currency.');
  if (quote.currency===value.currency) return {ok:true};
  // Clear previous currency amounts before changing the header, so a failed
  // second update cannot leave confirmed amounts labelled with another currency.
  const {data:items,error:readError}=await supabase.from('customer_quote_items').select('id,price_calculation').eq('customer_quote_id',quote.id);
  if(readError) throw new Error(readError.message);
  for(const item of items??[]) {
    const calculation={...item.price_calculation};
    for(const key of ['admin_controls','admin_commercial','customer_delivery','exchange_rate','markup_percent','confirmed_by','confirmed_at']) delete calculation[key];
    const {error:itemsError}=await supabase.from('customer_quote_items').update({unit_price:null,price_status:'suggested',exchange_rate_id:null,price_calculation:calculation}).eq('id',item.id);
    if(itemsError) throw new Error(itemsError.message);
  }
  const {error:updateError}=await supabase.from('customer_quotes').update({currency:value.currency,status:'draft'}).eq('id',quote.id).in('status',['draft','pending_approval']);
  if(updateError) throw new Error(updateError.message);
  await createSupabaseAdminClient().from('audit_logs').insert({actor_type:'admin',actor_user_id:user.id,action:'customer_quote_currency_changed',record_type:'customer_quote',record_id:quote.id,before_data:{currency:quote.currency},after_data:{currency:value.currency}});
  revalidatePath('/quotes/'+quote.id); revalidatePath('/quotes'); return {ok:true};
}
