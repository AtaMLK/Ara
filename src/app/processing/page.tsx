import Link from 'next/link';
import {requireAdminPage,listInquiries} from '@/lib/data/admin';
import {WorkflowPanel} from '@/app/inquiries/[id]/workflow-panel';
import {displayText} from '@/lib/ui/display-text';
export default async function ProcessingPage({searchParams}:{searchParams:Promise<{inquiry?:string}>}){
 const params=await searchParams;const requests=await listInquiries();
 const selected=requests.find(row=>row.id===params.inquiry)??requests[0];
 const {supabase}=await requireAdminPage();
 const [executions,clarifications,research]=selected?await Promise.all([
  supabase.from('ai_executions').select('id,task_key,agent_id,status,attempt_count,error_code,error_message,created_at').eq('inquiry_id',selected.id).order('created_at',{ascending:false}).limit(20),
  supabase.from('clarifications').select('id,requirement_id,question,status,created_at').eq('inquiry_id',selected.id).order('created_at',{ascending:false}),
  supabase.from('research_cases').select('id,status,created_at').eq('inquiry_id',selected.id).order('created_at',{ascending:false}).limit(5),
 ]):[];
 return <><header className="topbar"><div><div className="eyebrow">ADMIN</div><h1 className="title">Processing</h1><p className="muted">Workflow controls and customer questions.</p></div><Link className="secondary-button" href="/notifications?view=alerts">Processing alerts</Link></header><form className="filters"><select name="inquiry" defaultValue={selected?.id} aria-label="Request">{requests.map(row=><option key={row.id} value={row.id}>{row.reference} · {row.title}</option>)}</select><button className="secondary-button">Open request</button></form>{selected&&<WorkflowPanel inquiryId={selected.id} status={selected.status} executions={executions?.data??[]} alerts={[]} clarifications={(clarifications?.data??[]).map(row=>({...row,question:displayText(row.question)}))} researchCases={research?.data??[]}/>}</>;
}
