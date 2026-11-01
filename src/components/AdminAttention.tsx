'use client';

import Link from 'next/link';
import { useEffect,useState,useCallback } from 'react';
import { usePathname,useRouter } from 'next/navigation';
import { notificationHref,type AdminAttention as Attention } from '@/lib/notifications';

export default function AdminAttention() {
  const [data,setData]=useState<Attention|null>(null);
  const [error,setError]=useState('');
  const pathname=usePathname();
  const router=useRouter();
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    try {
      const response=await fetch('/api/admin/attention',{cache:'no-store',signal});
      if(!response.ok) throw new Error('Notifications could not refresh.');
      setData(await response.json());setError('');
    } catch(error) {if(!(error instanceof DOMException&&error.name==='AbortError'))setError('Notifications could not refresh.');}
  },[]);
  useEffect(()=>{
    const controller=new AbortController();let busy=false;
    const poll=async()=>{if(busy||document.hidden)return;busy=true;try{await refresh(controller.signal);}finally{busy=false;}};
    void poll();const timer=setInterval(()=>void poll(),15000);
    window.addEventListener('focus',poll);document.addEventListener('visibilitychange',poll);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',poll);document.removeEventListener('visibilitychange',poll);};
  },[pathname,refresh]);
  const unread=data?.unreadCount??0;
  return <section className="admin-attention" aria-label="Notifications and customer requests">
    <div className="attention-toolbar">
      <Link href="/quotes/revisions" className="attention-queue">Customer revisions <span className="attention-count">{data?.revisionCount??'…'}</span></Link>
      <details className="attention-bell"><summary>Notifications <span className="attention-count">{data?unread:'…'}</span></summary>
        <div className="attention-popover"><strong>Unread notifications</strong>
          {data?.notifications.map(item=><div className="attention-notification" key={item.id}>
            <Link href={notificationHref(item.action_url)}><strong>{item.title}</strong><span>{item.message}</span></Link>
            <button type="button" className="text-button" onClick={async()=>{
              try {const response=await fetch('/api/admin/attention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});if(!response.ok){const result=await response.json();throw new Error(result.error||'Could not mark notification as read.');}await refresh();}
              catch(error){setError(error instanceof Error?error.message:'Could not mark notification as read.');}
            }}>Mark read</button>
          </div>)}
          {data&&unread===0&&<p>No unread notifications.</p>}
          <Link href="/notifications">View all notifications</Link>
        </div>
      </details>
    </div>
    {error&&<div className="attention-error" role="status">{error} <button type="button" onClick={()=>void refresh()}>Retry</button></div>}
    <div aria-live="polite" aria-atomic="true" className="attention-announcement">{data&&data.revisionCount>0?`${data.revisionCount} customer revision requests need review.`:''}</div>
    {!!unread&&data?.notifications[0]&&<div className="attention-unread"><div><strong>{unread} unread notifications</strong><span>{data.notifications[0].title}</span></div><Link href={notificationHref(data.notifications[0].action_url)}>Open notification →</Link></div>}
    {data&&<div className="attention-other-work">
      {data.approvals>0&&<Link href="/quotes?status=pending_approval">{data.approvals} quotations awaiting approval →</Link>}
      {data.rfqs>0&&<Link href="/rfqs">{data.rfqs} RFQs to review →</Link>}
      {data.alerts>0&&<Link href="/notifications?view=alerts">{data.alerts} open AI alerts →</Link>}
      {data.tasks>0&&<Link href="/notifications?view=tasks">{data.tasks} open tasks →</Link>}
    </div>}
    {!!data?.revisionCount&&<div className="attention-banner" role="region" aria-label="Customer revisions awaiting review">
      <div className="attention-banner-title"><strong>{data.revisionCount} customer revision {data.revisionCount===1?'request needs':'requests need'} your review</strong><Link href="/quotes/revisions">Review all →</Link></div>
      {data.revisions.map(item=><Link prefetch={false} onClick={()=>router.refresh()} href={'/quotes/'+item.quoteId} className="attention-work" key={item.id}>
        <div><strong>{item.reference}</strong><span>{item.reason.replaceAll('_',' ')}{item.message?` · ${item.message}`:''}</span></div><b>Review request →</b>
      </Link>)}
    </div>}
    {!!data?.draftCount&&<div className="attention-drafts"><strong>{data.draftCount} revised {data.draftCount===1?'quotation needs':'quotations need'} completion</strong>
      {data.drafts.map(item=><Link href={'/quotes/'+item.id} key={item.id}>{item.reference} · {item.status==='draft'?'Edit & confirm prices':'Review & send'} →</Link>)}
    </div>}
  </section>;
}
