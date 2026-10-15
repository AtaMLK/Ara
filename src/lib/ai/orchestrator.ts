import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import type {AgentId} from './context';
import {ToolError} from '@/lib/errors';

export type WorkflowStage='document'|'intake'|'clarification'|'research'|'supplier_discovery'|'verification'|'rfq'|'quote_extraction'|'comparison'|'customer_quote'|'customer_response'|'email_response'|'reporting'|'completed';
const stageAgent:Record<WorkflowStage,AgentId>={document:'document',intake:'intake',clarification:'clarification',research:'product_research',supplier_discovery:'supplier_discovery',verification:'supplier_verification',rfq:'rfq',quote_extraction:'quote_extraction',comparison:'comparison',customer_quote:'customer_quote',customer_response:'orchestrator',email_response:'orchestrator',reporting:'reporting',completed:'orchestrator'};

export async function enqueueWorkflow(inquiryId:string,stage:WorkflowStage){
 const supabase=createSupabaseAdminClient(); const taskKey=`inquiry:${inquiryId}:stage:${stage}`;
 const {data:existing,error:readError}=await supabase.from('ai_executions').select('*').eq('task_key',taskKey).maybeSingle();
 if(readError) throw new ToolError('TRANSIENT',readError.message);
 if(existing && existing.status !== 'failed') return existing;
 const payload={task_key:taskKey,agent_id:stageAgent[stage],inquiry_id:inquiryId,status:'queued',attempt_count:0,error_code:null,error_message:null,started_at:null,completed_at:null,output_ref:{}};
 const query=existing
   ? supabase.from('ai_executions').update(payload).eq('id',existing.id).eq('status','failed')
   : supabase.from('ai_executions').upsert(payload,{onConflict:'task_key',ignoreDuplicates:true});
 const {error}=await query;
 if(error) throw new ToolError('TRANSIENT',error.message);
 const {data,error:reloadError}=await supabase.from('ai_executions').select('*').eq('task_key',taskKey).single();
 if(reloadError || !data) throw new ToolError('TRANSIENT',reloadError?.message ?? 'Execution could not be loaded');
 return data;
}
export async function markExecutionRunning(executionId:string){
 const supabase=createSupabaseAdminClient();
 const {data:current,error:readError}=await supabase
   .from('ai_executions')
   .select('*')
   .eq('id',executionId)
   .single();
 if(readError || !current) throw new ToolError('NOT_FOUND','Execution not found');

 // A competing worker must not execute work already claimed by another worker.
 if(current.status === 'running') return null;
 if(current.status !== 'queued') {
   throw new ToolError('CONFLICT',`Execution cannot enter running state from ${current.status}`);
 }

 const {data,error}=await supabase
   .from('ai_executions')
   .update({status:'running',started_at:new Date().toISOString()})
   .eq('id',executionId)
   .eq('status','queued')
   .select('*')
   .single();

 if(error||!data) {
   const {data:after}=await supabase.from('ai_executions').select('*').eq('id',executionId).maybeSingle();
   if(after?.status === 'running' || after?.status === 'succeeded') return null;
   throw new ToolError('CONFLICT','Execution cannot enter running state');
 }
 return data;
}
export async function enqueueSupplierQuoteExtraction(inquiryId:string,options:{retryFailed?:boolean}={}){
 // Polling the same saved email must not reset a terminal failure every minute.
 // A genuinely new reply or explicit recovery may request another attempt.
 if(options.retryFailed === false){
   const {data:existing,error}=await createSupabaseAdminClient().from('ai_executions')
     .select('*').eq('task_key',`inquiry:${inquiryId}:stage:quote_extraction`).maybeSingle();
   if(error) throw new ToolError('TRANSIENT',error.message);
   if(existing?.status === 'failed') return existing;
 }
 const execution=await enqueueWorkflow(inquiryId,'quote_extraction');
 if(execution.status !== 'succeeded') return execution;
 const supabase=createSupabaseAdminClient();
 const {error}=await supabase.from('ai_executions')
   .update({status:'queued',output_ref:{},error_code:null,error_message:null,started_at:null,completed_at:null})
   .eq('id',execution.id).eq('status','succeeded');
 if(error) throw new ToolError('TRANSIENT',error.message);
 const {data,error:reloadError}=await supabase.from('ai_executions').select('*').eq('id',execution.id).single();
 if(reloadError || !data) throw new ToolError('TRANSIENT',reloadError?.message ?? 'Quote extraction execution could not be loaded');
 return data;
}
export async function markExecutionSuccess(executionId:string,outputRef:unknown={}){
 const supabase=createSupabaseAdminClient();
 const {data:current,error:readError}=await supabase.from('ai_executions').select('*').eq('id',executionId).single();
 if(readError || !current) throw new ToolError('NOT_FOUND','Execution not found');
 // A second worker/action may finish the same execution after the first worker.
 // Treat an already-succeeded execution as idempotent instead of a false conflict.
 if(current.status === 'succeeded') return current;
 if(current.status !== 'running') {
   throw new ToolError('CONFLICT',`Execution cannot be completed from ${current.status}`);
 }
 const {data,error}=await supabase
   .from('ai_executions')
   .update({status:'succeeded',output_ref:outputRef,completed_at:new Date().toISOString()})
   .eq('id',executionId)
   .eq('status','running')
   .select('*')
   .single();
 if(error||!data) {
   const {data:after}=await supabase.from('ai_executions').select('*').eq('id',executionId).maybeSingle();
   if(after?.status === 'succeeded') return after;
   throw new ToolError('CONFLICT','Execution cannot be completed');
 }
 return data;
}
export async function markExecutionFailure(executionId:string,errorCode:string,errorMessage:string){
 const supabase=createSupabaseAdminClient(); const {data:current}=await supabase.from('ai_executions').select('*').eq('id',executionId).single();
 if(!current) throw new ToolError('NOT_FOUND','Execution not found');
 if(current.status !== 'running') return current;
 const terminal=current.attempt_count+1>=3;
 const {data,error}=await supabase.from('ai_executions').update({status:terminal?'failed':'queued',attempt_count:current.attempt_count+1,error_code:errorCode,error_message:errorMessage,completed_at:terminal?new Date().toISOString():null}).eq('id',executionId).eq('status','running').select('*').single();
 if(error) throw new ToolError('TRANSIENT',error.message);
 if(terminal) await supabase.from('ai_alerts').insert({inquiry_id:current.inquiry_id,agent_id:current.agent_id,alert_type:'AI_PROCESSING_FAILED',message:errorMessage,priority:'urgent'});
 return data;
}
