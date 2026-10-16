import {createSupabaseServerClient} from '@/lib/supabase/server';
import {loadQuoteDocument} from '@/lib/quotes/load-document';
import {getQuoteCompany} from '@/lib/quotes/company';
import {createQuotePdf} from '@/lib/quotes/document';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {getQuoteReadiness} from '@/lib/quotes/readiness';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params,db=await createSupabaseServerClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user)return Response.json({error:'Sign in to download this quotation.'},{status:401});
  // RLS enforces Admin access or the owning customer and visible quote status.
  const {data:quote}=await db.from('customer_quotes').select('id,status').eq('id',id).maybeSingle();
  if(!quote)return Response.json({error:'Quotation not found.'},{status:404});
  const {data:profile}=await db.from('profiles').select('role,status').eq('user_id',user.id).single();
  if(profile?.status!=='active'||!['admin','customer'].includes(profile.role))return Response.json({error:'Access denied.'},{status:403});
  if(profile.role==='customer'&&!['sent','accepted','rejected','expired','revision_requested','superseded'].includes(quote.status))return Response.json({error:'Quotation not found.'},{status:404});
  const admin=createSupabaseAdminClient();
  const {data:sent}=await admin.from('communications').select('metadata').eq('quote_id',id).eq('direction','outgoing').contains('metadata',{type:'customer_quote'}).order('sent_at',{ascending:false}).limit(1).maybeSingle();
  const path=sent?.metadata?.quotation_pdf_path;
  if(typeof path==='string'&&path.startsWith('customer-quotes/'+id+'/')){
    const {data:stored,error}=await admin.storage.from('supplier-email-attachments').download(path);
    if(error||!stored)return Response.json({error:'The sent quotation attachment could not be loaded.'},{status:503});
    return new Response(await stored.arrayBuffer(),{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="Quotation.pdf"','Cache-Control':'private, no-store'}});
  }
  const loaded=await loadQuoteDocument(id);
  if(['draft','pending_approval'].includes(quote.status)){
    const readiness=await getQuoteReadiness(id);
    if(readiness.problems.length)return Response.json({error:readiness.problems.join(' ')},{status:409});
  }
  if(loaded.unconfirmed)return Response.json({error:'Confirm every item price before generating the final quotation PDF.'},{status:409});
  const pdf=await createQuotePdf(loaded.document,await getQuoteCompany());
  return new Response(Buffer.from(pdf),{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="Quotation-${loaded.document.reference}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
