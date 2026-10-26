import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {ToolError} from '@/lib/errors';
import type {SendEmailResult} from './types';

type Dispatch={key:string;hash:string;messageId:string;subject:string;recipients:string[];inquiryId?:string};

// SMTP cannot participate in a database transaction. A durable claim is never
// released for replay after a transport attempt, including uncertain outcomes.
export async function dispatchEmailOnce(input:Dispatch,send:()=>Promise<SendEmailResult>):Promise<SendEmailResult>{
  const db=createSupabaseAdminClient();
  const {data:claim,error}=await db.from('email_dispatches').insert({
    idempotency_key:input.key,payload_hash:input.hash,message_id:input.messageId,
    subject:input.subject,recipients:input.recipients,inquiry_id:input.inquiryId??null,status:'sending',
  }).select('*').single();
  if(error){
    if(error.code!=='23505')throw new ToolError('TRANSIENT','Email could not be reserved. No email was sent.');
    const {data:previous,error:readError}=await db.from('email_dispatches').select('*').eq('idempotency_key',input.key).single();
    if(readError||!previous)throw new ToolError('CONFLICT','Email reservation needs checking. Do not resend.');
    if(previous.payload_hash!==input.hash)throw new ToolError('CONFLICT','This email already has a delivery record with different content. Review it before sending another message.');
    if(previous.status==='sent'&&previous.provider_message_id&&previous.sent_at)
      return {providerMessageId:previous.provider_message_id,threadId:previous.thread_id??undefined,sentAt:previous.sent_at};
    throw new ToolError('CONFLICT','This email is sending or delivery is uncertain. Check the sent mailbox; it will not be automatically resent.');
  }
  if(!claim)throw new ToolError('CONFLICT','Email reservation failed. No email was sent.');
  let result:SendEmailResult|undefined;
  try{
    result=await send();
    const {data:saved,error:saveError}=await db.from('email_dispatches').update({status:'sent',
      provider_message_id:result.providerMessageId,thread_id:result.threadId??null,sent_at:result.sentAt,error_text:null,
    }).eq('id',claim.id).eq('status','sending').select('id').maybeSingle();
    if(saveError||!saved)throw new Error('Provider result could not be recorded');
    return result;
  }catch{
    // The durable claim remains blocking even if this update or alert also fails.
    const message='Email delivery could not be confirmed. Check the sent mailbox before any resend.';
    try{
      await db.from('email_dispatches').update({status:'delivery_uncertain',error_text:message,
        ...(result?{provider_message_id:result.providerMessageId,thread_id:result.threadId??null,sent_at:result.sentAt}:{}),
      })
        .eq('id',claim.id).eq('status','sending');
      await db.from('ai_alerts').insert({inquiry_id:input.inquiryId??null,record_type:'email_dispatch',record_id:claim.id,
        agent_id:'orchestrator',alert_type:'EMAIL_DELIVERY_UNCERTAIN',message:input.subject+': '+message,priority:'urgent'});
    }catch{/* A restarted worker will also detect abandoned sending claims. */}
    throw new ToolError('CONFLICT',message);
  }
}
