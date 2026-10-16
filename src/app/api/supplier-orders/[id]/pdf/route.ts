import {createHash} from 'node:crypto';
import {requireAdmin} from '@/lib/ai/guards';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {loadOrderGroups,type OrderGroup} from '@/lib/quotes/supplier-orders';
import {getQuoteCompany} from '@/lib/quotes/company';
import {createCommercialPdf} from '@/lib/quotes/commercial-pdf';
import {purchaseOrderDocument} from '@/lib/quotes/purchase-order-document';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{await requireAdmin();}catch{return Response.json({error:'Admin access required.'},{status:403});}
  const {id}=await params,db=createSupabaseAdminClient();
  const {data:order,error}=await db.from('supplier_order_confirmations').select('customer_quote_id,supplier_id,reference,snapshot,status,sent_at').eq('id',id).maybeSingle();
  if(error||!order)return Response.json({error:'Purchase order not found.'},{status:404});
  const {pdf_path:path,pdf_sha256:hash}=order.snapshot??{};
  // Historical emails had no PDF. Offer an explicitly labelled document copy
  // without changing the sent email, its attachment history or order status.
  if(!path&&order.status==='sent'&&new URL(request.url).searchParams.get('copy')==='current'){
    const saved=order.snapshot as OrderGroup;
    if(!Array.isArray(saved.lines)||!saved.lines.length)return Response.json({error:'Original order details are unavailable.'},{status:409});
    const {groups}=await loadOrderGroups(order.customer_quote_id,saved.instructions||'');
    const fresh=groups.find(group=>group.supplierId===order.supplier_id);
    if(!fresh)return Response.json({error:'Supplier details could not be checked.'},{status:409});
    const group={...saved,language:fresh.language,country:fresh.country,lines:saved.lines.map(line=>{const source=fresh.lines.find(item=>item.itemId===line.itemId);return {...line,unit:line.unit||source?.unit,taxRate:line.taxRate??source?.taxRate};})};
    const company=await getQuoteCompany();
    const bytes=await createCommercialPdf(purchaseOrderDocument(group,new Date(order.sent_at).toLocaleDateString('en-GB',{timeZone:'Europe/Istanbul'})),{...company,...(order.snapshot.company??{}),logo:company.logo,logoType:company.logoType});
    return new Response(Buffer.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="Purchase-Order-Copy.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(typeof path!=='string'||!path.startsWith('supplier-orders/'+order.customer_quote_id+'/'+order.supplier_id+'/')||typeof hash!=='string')return Response.json({error:'Prepare the purchase order PDF first.'},{status:409});
  const version=new URL(request.url).searchParams.get('v');
  if(version&&version!==hash)return Response.json({error:'The preview changed. Refresh the order.'},{status:409});
  const {data:file,error:fileError}=await db.storage.from('supplier-email-attachments').download(path);
  if(fileError||!file)return Response.json({error:'Purchase order PDF could not be loaded.'},{status:503});
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==hash)return Response.json({error:'Purchase order PDF could not be verified.'},{status:409});
  const filename=order.reference.replace(/[^A-Za-z0-9_-]/g,'-');
  return new Response(Buffer.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="'+filename+'.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
