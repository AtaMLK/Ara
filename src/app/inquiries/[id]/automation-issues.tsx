'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {retryFailedAutomationAction} from './automation-recovery';
export default function AutomationIssues({inquiryId,failures,warnings}:{inquiryId:string;failures:Array<{id:string;task_key:string;error_message:string|null}>;warnings:Array<{id:string;message:string}>}) {
  const router=useRouter(),[pending,start]=useTransition(),[error,setError]=useState('');
  if(!failures.length&&!warnings.length)return null;
  return <section className="section detail-card"><h2>{failures.length?'Automation needs attention':'Attachment review'}</h2>
    {warnings.map(warning=><p key={warning.id} className="muted">{warning.message}</p>)}
    {failures.map(failure=><div className="list-item" key={failure.id}><div><strong>{failure.task_key.split(':stage:')[1]?.replaceAll('_',' ')}</strong><p>{failure.error_message}</p></div>
      <button className="secondary-button" disabled={pending} onClick={()=>start(async()=>{setError('');try{await retryFailedAutomationAction({inquiryId,executionId:failure.id});router.refresh();}catch(e){setError(e instanceof Error?e.message:'Retry could not be queued.');}})}>Retry failed automation</button></div>)}
    {error&&<p role="alert" className="error-box">{error}</p>}
  </section>;
}
