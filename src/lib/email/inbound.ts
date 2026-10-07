import 'server-only';

import crypto from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import {
  applyCustomerClarificationAnswer,
  cleanEmailReply,
  extractEmailAddress as extractCustomerEmail,
  findCustomerClarificationForEmail,
} from '@/lib/ai/clarification-replies';
import { findSupplierRFQForEmail } from '@/lib/ai/supplier-email-matching';
import { continueInquiryWorkflow } from '@/lib/ai/workflow';
import { parseInquiryFile } from '@/lib/ai/document-processor';

export type InboundEmailAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
  contentId?: string | null;
};

export type InboundEmail = {
  providerMessageId: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  receivedAt?: string | null;
  attachments?: InboundEmailAttachment[];
  provider: string;
};

function safeStorageName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

async function storeSupplierAttachments(
  inquiryId: string,
  responseId: string,
  attachments: InboundEmailAttachment[],
) {
  if (!attachments.length) return [];

  const supabase = createSupabaseAdminClient();
  const stored: Array<Record<string, unknown>> = [];

  for (const attachment of attachments) {
    const fileName = safeStorageName(attachment.fileName || 'attachment');
    const storagePath = `${inquiryId}/supplier-responses/${responseId}/${crypto.randomUUID()}-${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('supplier-email-attachments')
      .upload(storagePath, attachment.content, {
        contentType: attachment.mimeType || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      throw new ToolError('CONFLICT', `Could not store supplier attachment ${attachment.fileName}: ${uploadError.message}`);
    }

    let extractedText = '';
    let qualityFlags: string[] = [];
    const supported =
      attachment.mimeType === 'application/pdf' ||
      attachment.mimeType.includes('spreadsheet') ||
      attachment.mimeType === 'application/vnd.ms-excel' ||
      attachment.mimeType === 'text/csv' ||
      attachment.mimeType.startsWith('image/') ||
      /\.(pdf|xlsx?|csv)$/i.test(attachment.fileName);

    if (supported) {
      try {
        const parsed = await parseInquiryFile(
          new Uint8Array(attachment.content),
          attachment.mimeType || 'application/octet-stream',
          attachment.fileName,
        );
        extractedText = parsed.extractedText;
        qualityFlags = parsed.qualityFlags;
      } catch (error) {
        qualityFlags = [
          'ATTACHMENT_PARSE_FAILED',
          error instanceof Error ? error.message.slice(0, 300) : 'Unknown attachment parsing error',
        ];
      }
    } else {
      qualityFlags = ['UNSUPPORTED_ATTACHMENT_TYPE'];
    }

    stored.push({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      storagePath,
      contentId: attachment.contentId ?? null,
      extractedText,
      qualityFlags,
    });
  }

  return stored;
}

export async function processInboundEmail(email: InboundEmail) {
  const supabase = createSupabaseAdminClient();

  const { data: existing } = await supabase
    .from('communications')
    .select('id')
    .eq('provider_message_id', email.providerMessageId)
    .maybeSingle();

  if (existing) return { ok: true, duplicate: true };

  const subject = email.subject.trim();
  const body = email.text ?? cleanEmailReply(undefined, email.html);

  const customerMatch = await findCustomerClarificationForEmail({
    sender: email.from,
    subject,
  });

  if (customerMatch.matched) {
    const { data: communication, error } = await supabase.from('communications').insert({
      inquiry_id: customerMatch.inquiryId,
      customer_id: customerMatch.customer.id,
      direction: 'incoming',
      channel: 'email',
      provider_message_id: email.providerMessageId,
      thread_id: email.messageId ?? null,
      subject,
      body,
      received_at: email.receivedAt ?? new Date().toISOString(),
      metadata: {
        provider: email.provider,
        message_id: email.messageId ?? null,
        from: extractCustomerEmail(email.from),
        type: 'customer_clarification_reply',
      },
    }).select('id').single();

    if (error || !communication) throw new ToolError('CONFLICT', error?.message ?? 'Could not store customer email');

    const answer = cleanEmailReply(email.text, email.html);
    if (!answer) {
      await supabase.from('ai_alerts').insert({
        inquiry_id: customerMatch.inquiryId,
        record_type: 'communication',
        record_id: communication.id,
        agent_id: 'email_response',
        alert_type: 'EMPTY_CUSTOMER_EMAIL_REPLY',
        message: 'Customer email reply contained no usable answer text.',
        priority: 'normal',
      });
      return { ok: true, matched: true, answered: false };
    }

    await applyCustomerClarificationAnswer({
      inquiryId: customerMatch.inquiryId,
      clarificationId: customerMatch.clarification.id,
      answer,
      customerUserId: customerMatch.customer.user_id,
      communicationId: communication.id,
    });

    return { ok: true, matched: true, type: 'customer_clarification', answered: true };
  }

  const supplierMatch = await findSupplierRFQForEmail({
    sender: email.from,
    subject,
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
  });
  if (!supplierMatch.matched) {
    const { data: communication, error } = await supabase.from('communications').insert({
      direction: 'incoming',
      channel: 'email',
      provider_message_id: email.providerMessageId,
      thread_id: email.messageId ?? null,
      subject,
      body,
      received_at: email.receivedAt ?? new Date().toISOString(),
      metadata: {
        provider: email.provider,
        message_id: email.messageId ?? null,
        from: extractCustomerEmail(email.from),
        type: 'unmatched_incoming_email',
      },
    }).select('id').single();

    if (error || !communication) throw new ToolError('CONFLICT', error?.message ?? 'Could not store incoming email');

    await supabase.from('unmatched_emails').insert({
      communication_id: communication.id,
      reason: 'Incoming email could not be safely matched to a customer clarification or supplier RFQ: ' + supplierMatch.reason,
    });

    await supabase.from('ai_alerts').insert({
      agent_id: 'email_response',
      alert_type: 'UNMATCHED_INCOMING_EMAIL',
      message: `Incoming email from ${extractCustomerEmail(email.from)} could not be uniquely matched to a customer clarification or supplier RFQ.`,
      priority: 'normal',
    });

    return { ok: true, matched: false, reason: supplierMatch.reason };
  }

  const { data: communication, error: communicationError } = await supabase.from('communications').insert({
    inquiry_id: supplierMatch.inquiryId,
    supplier_id: supplierMatch.supplierId,
    rfq_id: supplierMatch.rfq.id,
    direction: 'incoming',
    channel: 'email',
    provider_message_id: email.providerMessageId,
    thread_id: email.messageId ?? null,
    subject,
    body,
    received_at: email.receivedAt ?? new Date().toISOString(),
    metadata: {
      provider: email.provider,
      message_id: email.messageId ?? null,
      from: extractCustomerEmail(email.from),
      type: 'supplier_rfq_reply',
      attachment_count: email.attachments?.length ?? 0,
    },
  }).select('id').single();

  if (communicationError || !communication) {
    if (communicationError?.code === '23505') return { ok: true, duplicate: true };
    throw new ToolError('CONFLICT', communicationError?.message ?? 'Could not store supplier email');
  }

  const responseId = crypto.randomUUID();
  const attachmentMetadata = await storeSupplierAttachments(
    supplierMatch.inquiryId,
    responseId,
    email.attachments ?? [],
  );

  const { data: response, error: responseError } = await supabase.from('supplier_responses').insert({
    id: responseId,
    communication_id: communication.id,
    supplier_id: supplierMatch.supplierId,
    inquiry_id: supplierMatch.inquiryId,
    status: 'received',
    raw_extraction: {
      source: 'supplier_email',
      subject,
      body,
      metadata: {
        provider: email.provider,
        message_id: email.messageId ?? null,
      },
      extraction_policy: 'explicit_values_only',
    },
    attachments: attachmentMetadata,
  }).select('id').single();

  if (responseError || !response) throw new ToolError('CONFLICT', responseError?.message ?? 'Could not store supplier response');

  await supabase.from('timeline_events').insert({
    inquiry_id: supplierMatch.inquiryId,
    event_type: 'supplier_email_received',
    visibility: 'admin',
    actor_type: 'system',
    metadata: {
      communication_id: communication.id,
      supplier_id: supplierMatch.supplierId,
      rfq_id: supplierMatch.rfq.id,
      attachment_count: attachmentMetadata.length,
    },
  });

  try {
    await continueInquiryWorkflow(supplierMatch.inquiryId);
  } catch (workflowError) {
    await supabase.from('ai_alerts').insert({
      inquiry_id: supplierMatch.inquiryId,
      agent_id: 'orchestrator',
      alert_type: 'SUPPLIER_EMAIL_WORKFLOW_CONTINUATION_FAILED',
      message: workflowError instanceof Error ? workflowError.message : 'Workflow continuation failed after supplier email',
      priority: 'normal',
    });
  }

  return {
    ok: true,
    matched: true,
    type: 'supplier_rfq_reply',
    inquiryId: supplierMatch.inquiryId,
    rfqId: supplierMatch.rfq.id,
    communicationId: communication.id,
    supplierResponseId: response.id,
    attachmentCount: attachmentMetadata.length,
  };
}
