import 'server-only';
import {quantityUnit} from './quantity-unit';
import {inquiryItems} from '@/lib/ui/inquiry-items';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {getCompanyProfile} from './company';
import {getSupplierLanguage,type SupplierLanguage} from '@/lib/email/supplier-language';

export type OrderLine={itemId:string;supplierQuoteId:string;description:string;model:string;brand:string;quantity:number;currency:string;net:number|null;gross:number|null;taxText:string;delivery:string;terms:string;unit?:string;taxRate?:number|null;taxMode?:string;loadingDate?:string;deliveryDate?:string};
export type OrderGroup={supplierId:string;supplierName:string;recipient:string;reference:string;lines:OrderLine[];instructions:string;language?:SupplierLanguage;country?:string};
const money=(value:number|null)=>value==null?'Not stated':Number(value).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:6});
export const orderFingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function renderSupplierOrder(group:OrderGroup,company:{name:string}) {
  const tr=group.language==='tr';
  const subject=(tr?'Sipariş teyidi | ':'Purchase order | ')+group.reference;
  const body=(tr?'Merhaba,\n\n':'Hello,\n\n')+(tr?'Satın alma siparişimiz '+group.reference+' ekte yer almaktadır. Sipariş kabulünü ve sevk / teslim tarihlerini teyit etmenizi rica ederiz.':'Please find attached our purchase order '+group.reference+'. Please confirm acceptance and the dispatch / delivery dates.')+(tr?'\n\nİyi çalışmalar,\nSatın Alma Departmanı\n':'\n\nKind regards,\nPurchasing Department\n')+company.name;
  const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html='<!doctype html><html lang="'+(tr?'tr':'en')+'"><head><meta charset="utf-8" /></head><body style="font-family:Arial,sans-serif;font-size:14px;color:#172b45;line-height:1.6;padding:24px">'+body.split('\n\n').map(paragraph=>'<p style="margin:0 0 18px">'+escape(paragraph).replaceAll('\n','<br />')+'</p>').join('')+'</body></html>';
  return {subject,body,html};
}

export async function loadOrderGroups(quoteId:string,instructions='') {
  const db=createSupabaseAdminClient();
  const {data:quote,error}=await db.from('customer_quotes').select('id,inquiry_id,status,reference,display_reference').eq('id',quoteId).single();
  if(error||!quote)throw new Error('Quotation not found.');
  if(quote.status!=='accepted')throw new Error('Customer acceptance is required before ordering from suppliers.');
  const {data:items,error:itemError}=await db.from('customer_quote_items')
    .select('id,is_selected,description,model,brand,quantity,supplier_quote_id,supplier_currency,supplier_cost,price_calculation').eq('customer_quote_id',quoteId).eq('is_selected',true).order('created_at',{ascending:true});
  if(itemError)throw new Error('Accepted items could not be loaded.');
  if(!items?.length)throw new Error('No accepted items to order.');
  const refs=items.map(item=>(item.price_calculation as Record<string,unknown>|null)?.source_ref).filter((ref):ref is string=>typeof ref==='string'&&!!ref);
  if(new Set(refs).size!==refs.length)throw new Error('Multiple selected supplier offers refer to the same requested item. Resolve the allocation before placing supplier orders.');
  if(items.some(item=>!item.supplier_quote_id))throw new Error('An accepted item has no supplier source. Link its original supplier offer before preparing an order.');
  const {data:offers,error:offersError}=await db.from('supplier_quotes').select('id,supplier_response_id,moq,original_data').in('id',items.map(item=>item.supplier_quote_id!));
  if(offersError)throw new Error('Supplier sources could not be loaded.');
  const {data:responses,error:responseError}=await db.from('supplier_responses').select('id,supplier_id,inquiry_id').in('id',(offers??[]).map(offer=>offer.supplier_response_id));
  if(responseError)throw new Error('Supplier replies could not be loaded.');
  const supplierIds=[...new Set((responses??[]).map(response=>response.supplier_id))];
  const [suppliers,rfqs]=await Promise.all([
    db.from('suppliers').select('id,legal_name,status,primary_country').in('id',supplierIds),
    db.from('rfqs').select('id,supplier_id,recipient_email,sent_at').eq('inquiry_id',quote.inquiry_id).in('supplier_id',supplierIds).in('status',['sent','completed']).order('sent_at',{ascending:false}),
  ]);
  if(suppliers.error||rfqs.error)throw new Error('Supplier order contacts could not be loaded.');
  const [request,requirements]=await Promise.all([db.from('inquiries').select('normalized_information').eq('id',quote.inquiry_id).single(),db.from('requirements').select('id,type,value,source_ref,status,admin_edited').eq('inquiry_id',quote.inquiry_id)]);
  if(request.error||requirements.error)throw new Error('Requested quantity units could not be checked.');
  const requested=inquiryItems(request.data?.normalized_information,requirements.data??[]);
  const groups=new Map<string,OrderGroup>();
  for(const item of items){
    const offer=offers?.find(offer=>offer.id===item.supplier_quote_id);
    const response=responses?.find(response=>response.id===offer?.supplier_response_id);
    if(!response||response.inquiry_id!==quote.inquiry_id)throw new Error('A supplier offer does not belong to this inquiry.');
    const supplier=suppliers.data?.find(supplier=>supplier.id===response.supplier_id);
    if(!supplier||supplier.status!=='active')throw new Error('The selected supplier is unavailable or inactive.');
    const recipient=rfqs.data?.find(rfq=>rfq.supplier_id===supplier.id&&rfq.recipient_email)?.recipient_email;
    if(!recipient||!z.string().email().safeParse(recipient).success)throw new Error('No previously approved RFQ email address for '+supplier.legal_name+'.');
    let group=groups.get(supplier.id);
    if(!group){group={supplierId:supplier.id,supplierName:supplier.legal_name,recipient,reference:(quote.display_reference||quote.reference)+'-PO'+([...supplierIds].sort().indexOf(supplier.id)+1),lines:[],instructions,language:await getSupplierLanguage(supplier.id),country:supplier.primary_country||''};groups.set(supplier.id,group);}
    const calc=(item.price_calculation??{}) as Record<string,unknown>;
    if(offer?.moq!=null&&Number(item.quantity)<Number(offer.moq))throw new Error('Requested order quantity is below the supplier minimum. Obtain updated supplier terms before ordering.');
    if(typeof calc.selected_price_tier_id==='string'){
      const {data:tier,error:tierError}=await db.from('supplier_quote_price_tiers').select('supplier_quote_id,min_quantity,max_quantity').eq('id',calc.selected_price_tier_id).single();
      if(tierError||!tier||tier.supplier_quote_id!==item.supplier_quote_id||tier.min_quantity!=null&&Number(item.quantity)<Number(tier.min_quantity)||tier.max_quantity!=null&&Number(item.quantity)>Number(tier.max_quantity))throw new Error('Order quantity does not match the reviewed supplier price tier. Obtain updated supplier terms.');
    }
    const commercial=(calc.admin_commercial??calc.commercial??{}) as {net?:number|null;gross?:number|null;taxText?:string;taxRate?:number|null;taxMode?:string;delivery?:{original?:string}};
    if(!item.description||!item.supplier_currency||!Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0)throw new Error('Complete the accepted item description, quantity and supplier currency before ordering.');
    const net=commercial.net==null?null:Number(commercial.net),gross=commercial.gross==null?null:Number(commercial.gross);
    if(net==null&&gross==null)throw new Error('Review the original supplier cost before placing this order.');
    const original=(offer?.original_data??{}) as Record<string,unknown>;
    const matching=requested.find(line=>line.sourceRef===calc.source_ref)??(requested.length===1?requested[0]:undefined);
    const unit=quantityUnit(calc.quantity_unit,original.quantity_unit,matching?.unit,matching?.quantity);
    const supplierUnit=quantityUnit(original.quantity_unit);
    if(supplierUnit&&unit&&supplierUnit.toLowerCase()!==unit.toLowerCase())throw new Error('Supplier and accepted item units differ. Review the supplier quantity and price basis before placing this order.');
    group.lines.push({itemId:item.id,supplierQuoteId:item.supplier_quote_id!,description:item.description,model:item.model||'',brand:item.brand||'',quantity:Number(item.quantity),currency:item.supplier_currency,
      unit,taxRate:commercial.taxRate??null,taxMode:commercial.taxMode,loadingDate:String(calc.loading_date||original.loading_date||''),deliveryDate:String(calc.delivery_date||original.delivery_date||''),
      net,gross,taxText:commercial.taxRate!=null?commercial.taxRate+'% ('+(commercial.taxMode||'reviewed')+')':commercial.taxText||'',delivery:commercial.delivery?.original||'',
      terms:[calc.payment_terms,calc.incoterm,calc.delivery_method,...(Array.isArray(calc.conditions)?calc.conditions.map(condition=>typeof condition==='string'?condition:condition?.text):[])].filter(Boolean).map(String).join(' · ')});
  }
  return {quote,groups:[...groups.values()].map(group=>({...group,lines:group.lines.sort((a,b)=>a.itemId.localeCompare(b.itemId))})),company:await getCompanyProfile()};
}

export async function notifyAcceptedQuote(quoteId:string) {
  const db=createSupabaseAdminClient();
  const {data:quote,error}=await db.from('customer_quotes').select('id,status,reference,display_reference').eq('id',quoteId).single();
  if(error||!quote||quote.status!=='accepted')throw new Error('Accepted quotation could not be checked.');
  const {data:admins,error:adminError}=await db.from('profiles').select('user_id').eq('role','admin').eq('status','active');
  if(adminError)throw new Error('Admin notification could not be prepared.');
  for(const admin of admins??[]){
    const {data:existing,error:readError}=await db.from('notifications').select('id').eq('user_id',admin.user_id).eq('record_type','supplier_order_confirmation').eq('record_id',quoteId).limit(1);
    if(readError)throw new Error('Admin notification could not be checked.');
    if(existing?.length)continue;
    const {error:writeError}=await db.from('notifications').insert({user_id:admin.user_id,category:'task',priority:'normal',title:'Customer accepted quotation — review supplier orders',message:(quote.display_reference||quote.reference)+': review and send a separate order to each supplying company.',record_type:'supplier_order_confirmation',record_id:quoteId,action_url:'/quotes/'+quoteId+'#supplier-order-confirmation'});
    if(writeError&&writeError.code!=='23505')throw new Error('Admin notification could not be saved.');
  }
}
