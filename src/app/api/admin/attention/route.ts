import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/ai/guards';
import { sameOriginRequest } from '@/lib/notifications';
import { oneRelated } from '@/lib/data/relations';

export async function GET() {
  let context;
  try { context=await requireAdmin(); } catch { return NextResponse.json({error:'Admin access required'},{status:401}); }
  const {supabase,user}=context;
  const [unread,notifications,revisions,drafts,approvals,rfqs,alerts,tasks]=await Promise.all([
    supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',user.id).is('read_at',null),
    supabase.from('notifications').select('id,title,message,action_url,created_at').eq('user_id',user.id).is('read_at',null).order('created_at',{ascending:false}).limit(6),
    supabase.from('quote_revision_requests').select('id,quote_id,reason,free_text,customer_quotes!quote_revision_requests_quote_id_fkey(reference)',{count:'exact'}).eq('status','pending_approval').order('created_at',{ascending:false}).limit(4),
    supabase.from('customer_quotes').select('id,reference,status',{count:'exact'}).in('status',['draft','pending_approval']).not('parent_quote_id','is',null).order('updated_at',{ascending:false}).limit(4),
    supabase.from('customer_quotes').select('id',{count:'exact',head:true}).eq('status','pending_approval'),
    supabase.from('rfqs').select('id',{count:'exact',head:true}).in('status',['draft','pending_approval']),
    supabase.from('ai_alerts').select('id',{count:'exact',head:true}).eq('status','open'),
    supabase.from('tasks').select('id',{count:'exact',head:true}).in('status',['open','in_progress']),
  ]);
  if([unread,notifications,revisions,drafts,approvals,rfqs,alerts,tasks].some(result=>result.error)) return NextResponse.json({error:'Could not refresh notifications'},{status:503});
  return NextResponse.json({unreadCount:unread.count??0,notifications:notifications.data??[],revisionCount:revisions.count??0,
    revisions:(revisions.data??[]).map(row=>({id:row.id,quoteId:row.quote_id,reference:oneRelated(row.customer_quotes)?.reference??'Quotation',reason:row.reason,message:row.free_text})),
    approvals:approvals.count??0,rfqs:rfqs.count??0,alerts:alerts.count??0,tasks:tasks.count??0,draftCount:drafts.count??0,drafts:drafts.data??[]},{headers:{'Cache-Control':'private, no-store'}});
}

export async function POST(request:Request) {
  if(!sameOriginRequest(request.headers.get('origin'),request.headers.get('host'))) return NextResponse.json({error:'Invalid origin'},{status:403});
  let context;
  try { context=await requireAdmin(); } catch { return NextResponse.json({error:'Admin access required'},{status:401}); }
  const input=z.object({id:z.string().uuid()}).safeParse(await request.json().catch(()=>null));
  if(!input.success) return NextResponse.json({error:'Invalid notification'},{status:400});
  const {supabase,user}=context;
  const {error}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',input.data.id).eq('user_id',user.id).is('read_at',null);
  if(error) return NextResponse.json({error:'Could not mark notification as read'},{status:503});
  return NextResponse.json({ok:true});
}
