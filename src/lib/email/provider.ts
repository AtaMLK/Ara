import 'server-only';

import nodemailer from 'nodemailer';
import {createHash} from 'node:crypto';
import {dispatchEmailOnce} from './dispatch';
import {withRequestDeadline} from '@/lib/ai/request-deadline';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import type { EmailAttachment, EmailProvider, SendEmailInput, SendEmailResult } from './types';

async function resolveAttachments(attachments: EmailAttachment[] = []) {
  if (!attachments.length) return [];

  const supabase = createSupabaseAdminClient();
  const resolved: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }> = [];

  for (const attachment of attachments) {
    const { data, error } = await supabase.storage
      .from('supplier-email-attachments')
      .download(attachment.storagePath);

    if (error || !data) {
      throw new ToolError('NOT_FOUND', `Email attachment could not be loaded: ${attachment.fileName}`);
    }

    resolved.push({
      filename: attachment.fileName,
      content: Buffer.from(await data.arrayBuffer()),
      contentType: attachment.mimeType,
    });
  }

  return resolved;
}

class SmtpEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 465);
    const secure = (process.env.SMTP_SECURE ?? 'true').toLowerCase() === 'true';
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;

    if (!host || !user || !password) {
      throw new ToolError(
        'TRANSIENT',
        'SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required',
      );
    }
    if(!input.idempotencyKey?.trim())throw new ToolError('VALIDATION','A stable email idempotency key is required.');
    if(!input.to.length)throw new ToolError('VALIDATION','Email recipient is required.');

    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
      connectionTimeout:10_000,greetingTimeout:10_000,socketTimeout:60_000,
    });

    const attachments = await resolveAttachments(input.attachments);

    const resolved=[...attachments,...(input.generatedAttachments??[]).map(attachment=>({filename:attachment.fileName,content:Buffer.from(attachment.content),contentType:attachment.mimeType,cid:attachment.cid}))];
    const from=input.from || process.env.SMTP_FROM || user;
    const replyTo=input.replyTo || process.env.SMTP_REPLY_TO || process.env.IMAP_USER || user;
    const messageId='<arat-'+createHash('sha256').update(input.idempotencyKey).digest('hex')+'@mail.aryaautomation.com>';
    const hash=createHash('sha256').update(JSON.stringify({from,to:input.to,replyTo,subject:input.subject,html:input.html,text:input.text??'',
      attachments:resolved.map(a=>({filename:a.filename,contentType:a.contentType,cid:'cid' in a?a.cid:null,sha256:createHash('sha256').update(a.content).digest('hex')})),
    })).digest('hex');
    return dispatchEmailOnce({key:input.idempotencyKey,hash,messageId,subject:input.subject,recipients:input.to,inquiryId:input.inquiryId},async()=>{
    try{
    const result = await withRequestDeadline('SMTP send',90_000,()=>transport.sendMail({
      messageId,
      from,
      to: input.to,
      replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: resolved,
      headers: input.idempotencyKey
        ? { 'X-ARAT-Idempotency-Key': input.idempotencyKey }
        : undefined,
    }));
    if(!result.accepted?.length||result.rejected?.length)throw new Error('SMTP did not accept every recipient');

    return {
      providerMessageId: result.messageId,
      threadId: result.messageId,
      sentAt: new Date().toISOString(),
    };
    }finally{transport.close();}
    });
  }
}

export function getEmailProvider(): EmailProvider {
  return new SmtpEmailProvider();
}
