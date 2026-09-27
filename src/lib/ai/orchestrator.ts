import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import type {AgentId} from './context';
import {ToolError} from '@/lib/errors';

export type WorkflowStage='document'|'intake'|'clarification'|'research'|'supplier_discovery'|'verification'|'rfq'|'quote_extraction'|'comparison'|'customer_quote'|'customer_response'|'reporting'|'completed';
const stageAgent:Record<WorkflowStage,AgentId>={document:'document',intake:'intake',clarification:'clarification',research:'product_research',supplier_discovery:'supplier_discovery',verification:'supplier_verification',rfq:'rfq',quote_extraction:'quote_extraction',comparison:'comparison',customer_quote:'customer_quote',customer_response:'orchestrator',reporting:'reporting',completed:'orchestrator'};

export async function enqueueWorkflow(inquiryId:string,stage:WorkflowStage){
 const supabase=createSupabaseAdminClient(); const taskKey=`inquiry:${inquiryId}:stage:${stage}`;
 const {data:existing}=await supabase.from('ai_executions').select('*').eq('task_key',taskKey).maybeSingle();
 if(existing&&(existing.status==='queued'||existing.status==='running')) return existing;
 const {data,error}=await supabase.from('ai_executions').upsert({task_key:taskKey,agent_id:stageAgent[stage],inquiry_id:inquiryId,status:'queued'},{onConflict:'task_key'}).select('*').single();
 if(error) throw new ToolError('TRANSIENT',error.message); return data;
}
export async function markExecutionRunning(executionId:string){
 const supabase=createSupabaseAdminClient(); const {data,error}=await supabase.from('ai_executions').update({status:'running',attempt_count:1,started_at:new Date().toISOString()}).eq('id',executionId).eq('status','queued').select('*').single();
 if(error||!data) throw new ToolError('CONFLICT','Execution cannot enter running state'); return data;
}
export async function markExecutionSuccess(executionId:string,outputRef:unknown={}){
 const supabase=createSupabaseAdminClient(); const {data,error}=await supabase.from('ai_executions').update({status:'succeeded',output_ref:outputRef,completed_at:new Date().toISOString()}).eq('id',executionId).eq('status','running').select('*').single();
 if(error||!data) throw new ToolError('CONFLICT','Execution cannot be completed'); return data;
}
export async function markExecutionFailure(executionId:string,errorCode:string,errorMessage:string){
 const supabase=createSupabaseAdminClient(); const {data:current}=await supabase.from('ai_executions').select('*').eq('id',executionId).single();
 if(!current) throw new ToolError('NOT_FOUND','Execution not found');
 const terminal=current.attempt_count>=3;
 const {data,error}=await supabase.from('ai_executions').update({status:terminal?'failed':'queued',attempt_count:current.attempt_count+1,error_code:errorCode,error_message:errorMessage,completed_at:terminal?new Date().toISOString():null}).eq('id',executionId).select('*').single();
 if(error) throw new ToolError('TRANSIENT',error.message);
 if(terminal) await supabase.from('ai_alerts').insert({inquiry_id:current.inquiry_id,agent_id:current.agent_id,alert_type:'AI_PROCESSING_FAILED',message:errorMessage,priority:'urgent'});
 return data;
}
