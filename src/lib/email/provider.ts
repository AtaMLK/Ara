import 'server-only';
import {createHash} from 'node:crypto';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {dispatchEmailOnce,type DispatchStore,type EmailDispatch} from './dispatch';
import type {EmailProvider,SendEmailInput,SendEmailResult} from './types';
import {ToolError} from '@/lib/errors';

class ResendEmailProvider implements EmailProvider {
 async send(input:SendEmailInput):Promise<SendEmailResult> {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey)throw new ToolError('TRANSIENT','RESEND_API_KEY is not configured');
  if(!input.idempotencyKey?.trim())throw new ToolError('VALIDATION','A durable email key is required');
  const db=createSupabaseAdminClient();
  const attachments=[];
  for(const item of input.attachments??[]){
   const {data,error}=await db.storage.from('supplier-email-attachments').download(item.storagePath);
   if(error||!data)throw new ToolError('NOT_FOUND','Email attachment could not be loaded');
   attachments.push({filename:item.fileName,content:Buffer.from(await data.arrayBuffer()).toString('base64')});
  }
  const body={from:input.from,to:input.to,subject:input.subject,html:input.html,...(input.text?{text:input.text}:{}),...(attachments.length?{attachments}:{})};
  const payloadHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const messageId='<arat-'+createHash('sha256').update(input.idempotencyKey).digest('hex')+'@arat.invalid>';
    const store: DispatchStore = {
      async reserve(reservation) {
        const { data, error } = await db.from('email_dispatches').insert(reservation).select('*').single();
        if (error?.code === '23505') return null;
        if (error || !data) throw new Error('Could not reserve email delivery');
        return data as EmailDispatch;
      },
      async find(key) {
        const { data, error } = await db.from('email_dispatches').select('*').eq('idempotency_key', key).maybeSingle();
        if (error) throw new Error('Could not check email delivery');
        return data as EmailDispatch | null;
      },
      async sent(id, result) {
        const { data, error } = await db.from('email_dispatches').update({
          status: 'sent', provider_message_id: result.providerMessageId,
          thread_id: result.threadId ?? null, sent_at: result.sentAt, error_text: null,
        }).eq('id', id).eq('status', 'sending').select('id').single();
        if (error || !data) throw new Error('Could not record email receipt');
      },
      async uncertain(id) {
        const { data, error } = await db.from('email_dispatches').update({
          status: 'delivery_uncertain', error_text: 'Delivery was interrupted or its receipt could not be stored. Check the sent mailbox before any resend.',
        }).eq('id', id).eq('status', 'sending').select('id,inquiry_id,subject').maybeSingle();
        if (error) throw new Error('Could not record delivery uncertainty');
        if (!data) return;
        const { error: alertError } = await db.from('ai_alerts').insert({
          inquiry_id: input.inquiryId ?? null, record_type: 'email_dispatch', record_id: id,
          agent_id: 'orchestrator', alert_type: 'EMAIL_DELIVERY_UNCERTAIN',
          message: `Email delivery needs mailbox review: ${input.subject}. Do not resend automatically.`, priority: 'urgent',
        });
        if (alertError) throw new Error('Could not record delivery alert');
      },
    };

  try {
   return await dispatchEmailOnce({idempotency_key:input.idempotencyKey,payload_hash:payloadHash,inquiry_id:input.inquiryId??null,subject:input.subject,recipients:input.to,message_id:messageId},store,async()=>{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':input.idempotencyKey},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(30000)});
    const payload=await response.json().catch(()=>({})) as {id?:string};
    if(!response.ok||!payload.id)throw new Error('Email provider did not confirm delivery');
    return {providerMessageId:payload.id,sentAt:new Date().toISOString()};
   });
  }catch(error){throw new ToolError('CONFLICT',error instanceof Error?error.message:'Email delivery needs review');}
 }
}
export function getEmailProvider():EmailProvider {
 const provider=process.env.EMAIL_PROVIDER??'resend';
 if(provider!=='resend')throw new ToolError('VALIDATION',`Unsupported email provider: ${provider}`);
 return new ResendEmailProvider();
}
