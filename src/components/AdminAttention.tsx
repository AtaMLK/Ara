'use client';

import Link from 'next/link';
import {useEffect,useState,useCallback,useRef} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {notificationHref,type AdminAttention as Attention} from '@/lib/notifications';

export default function AdminAttention({mode='compact'}:{mode?:'compact'|'center'}) {
 const [data,setData]=useState<Attention|null>(null);
 const [error,setError]=useState('');
 const pathname=usePathname();
 const router=useRouter();
 const bell=useRef<HTMLDetailsElement>(null);
 const close=()=>{if(bell.current)bell.current.open=false;};
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(bell.current?.open&&!bell.current.contains(event.target as Node))close();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&bell.current?.open){close();bell.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[]);
 useEffect(()=>{close();},[pathname]);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  try{const response=await fetch('/api/admin/attention',{cache:'no-store',signal});if(!response.ok)throw new Error();setData(await response.json());setError('');}
  catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setError('Notifications could not refresh.');}
 },[]);
 useEffect(()=>{
  if(mode==='compact'&&pathname==='/notifications')return;
  const controller=new AbortController();let busy=false;
  const poll=async()=>{if(busy||document.hidden)return;busy=true;try{await refresh(controller.signal);}finally{busy=false;}};
  void poll();const timer=setInterval(()=>void poll(),15000);
  window.addEventListener('focus',poll);document.addEventListener('visibilitychange',poll);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',poll);document.removeEventListener('visibilitychange',poll);};
 },[pathname,refresh,mode]);
 if(mode==='compact'&&pathname==='/notifications')return null;
 const unread=data?.unreadCount??0;
 return <section className={`admin-attention attention-${mode}`} aria-label="Notifications and customer requests">
  <div className="attention-toolbar">
   {!!data?.revisionCount&&<Link href="/quotes/revisions" className="attention-queue">Revisions <span className="attention-count">{data.revisionCount}</span></Link>}
   <details className="attention-bell" ref={bell}><summary>Notifications <span className="attention-count">{error?'!':data?unread:'…'}</span></summary>
    <div className="attention-popover">
     <div className="attention-popover-heading"><strong>Unread notifications</strong><button type="button" className="text-button" onClick={close} aria-label="Close notifications">×</button></div>
     {error&&<p role="status">{error} <button type="button" onClick={()=>void refresh()}>Retry</button></p>}
     {data?.notifications.map(item=><div className="attention-notification" key={item.id}>
      <Link href={notificationHref(item.action_url)} onClick={close}><strong>{item.title}</strong></Link>
      <button type="button" className="text-button" onClick={async()=>{
       try{const response=await fetch('/api/admin/attention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});if(!response.ok){const result=await response.json();throw new Error(result.error||'Could not mark notification as read.');}await refresh();}
       catch(error){setError(error instanceof Error?error.message:'Could not mark notification as read.');}
      }}>Mark read</button>
     </div>)}
     {data&&unread===0&&<p>No unread notifications.</p>}
     <Link href="/notifications" onClick={close}>Open notification center →</Link>
    </div>
   </details>
  </div>
  {mode==='center'&&<>
   <div className="attention-other-work">
    <Link href="/quotes/revisions">Customer revision requests ({data?.revisionCount??'…'}) →</Link>
    {!!data?.approvals&&<Link href="/quotes?status=pending_approval">{data.approvals} quotations awaiting approval →</Link>}
    {!!data?.rfqs&&<Link href="/rfqs">{data.rfqs} RFQs to review →</Link>}
    {!!data?.alerts&&<Link href="/notifications?view=alerts">{data.alerts} open AI alerts →</Link>}
    {!!data?.tasks&&<Link href="/notifications?view=tasks">{data.tasks} open tasks →</Link>}
   </div>
   {!!data?.revisionCount&&<div className="attention-banner" aria-label="Customer revisions awaiting review">
    <div className="attention-banner-title"><strong>{data.revisionCount} customer revision {data.revisionCount===1?'request needs':'requests need'} your review</strong><Link href="/quotes/revisions">Review all →</Link></div>
    {data.revisions.map(item=><Link href={'/quotes/'+item.quoteId} prefetch={false} onClick={()=>router.refresh()} className="attention-work" key={item.id}><div><strong>{item.reference}</strong><span>{item.reason.replaceAll('_',' ')}{item.message?` · ${item.message}`:''}</span></div><b>Review request →</b></Link>)}
   </div>}
   {!!data?.draftCount&&<div className="attention-drafts"><strong>{data.draftCount} revised {data.draftCount===1?'quotation needs':'quotations need'} completion</strong>{data.drafts.map(item=><Link href={'/quotes/'+item.id} key={item.id}>{item.reference} · {item.status==='draft'?'Edit & confirm prices':'Review & send'} →</Link>)}</div>}
  </>}
 </section>;
}
