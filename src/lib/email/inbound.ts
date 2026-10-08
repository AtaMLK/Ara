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
import { runAgent } from '@/lib/ai/agent-runner';
import { supplierEmailAnalysisOutputSchema } from '@/lib/ai/agent-schemas';
import { getEmailProvider } from './provider';

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


function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char] ?? char));
}

async function analyzeSupplierEmailAndNotify(input: {
  inquiryId: string;
  rfqId: string;
  communicationId: string;
  rfqCode: string;
  inquiryReference: string;
  supplierName: string;
  supplierEmail: string;
  subject: string;
  body: string;
  customerId: string | null;
  customerUserId: string | null;
  customerEmail: string | null;
  customerName: string;
}) {
  const supabase = createSupabaseAdminClient();

  const { data: inquiryRequirements } = await supabase
    .from('requirements')
    .select('type,value,status')
    .eq('inquiry_id', input.inquiryId)
    .order('created_at', { ascending: true })
    .limit(100);

  const requirementContext = (inquiryRequirements ?? []).map((item) => ({
    type: item.type,
    value: item.value,
    status: item.status,
  }));

  let analysis: {
    hasActionableInformation: boolean;
    summary: string;
    supplierIntent: 'quote' | 'clarification' | 'unavailable' | 'general_update' | 'unknown';
    customerActionRequired: boolean;
    customerQuestion?: string;
    confidence: number;
  } | null = null;

  if (process.env.OPENAI_API_KEY) {
    try {
      const ai = await runAgent(
        {
          agentId: 'email_response',
          executionId: input.communicationId,
          inquiryId: input.inquiryId,
        },
        {
          rfq_code: input.rfqCode,
          inquiry_reference: input.inquiryReference,
          supplier_name: input.supplierName,
          supplier_email: input.supplierEmail,
          subject: input.subject,
          supplier_email_body: input.body,
          inquiry_requirements: requirementContext,
          instructions: [
            'Analyze the supplier email for an internal procurement workflow.',
            'Determine whether it contains actionable commercial information such as price, availability, lead time, MOQ, payment terms, quotation validity, or a clear statement that the supplier can/cannot supply.',
            'If the supplier is asking for specifications, model/part number, technical details, quantity, documents, confirmation, or any other missing information needed to continue, set customerActionRequired=true and write one concise customer-friendly question in customerQuestion.',
            'Translate the supplier request into clear customer language. Do not merely repeat the supplier email.',
            'customerQuestion is CUSTOMER-FACING and must contain only the minimum information the customer needs to provide.',
            'Never expose supplier name, supplier email, supplier contact person, supplier internal notes, supplier pricing, supplier commercial terms, private supplier details, or raw supplier wording in customerQuestion.',
            'Do not mention that a specific supplier asked for the information. Say only that the request needs additional information to continue.',
            'If the supplier email is vague but clearly asks for more product/technical information (for example "please provide detailed information about the specifications"), treat that as customerActionRequired=true and ask the customer for the relevant missing information based on the inquiry context and the supplier email. Use the inquiry_requirements context to make the question specific when the context supports it. Do not invent a specification that is not supported by the inquiry or supplier email.',
            'If there is no useful supplier information and no clear customer question, set customerActionRequired=false and explain the situation in summary.',
            'Do not invent prices, quantities, models, availability, or customer requirements.',
            'summary must be concise and suitable for an Admin notification.',
          ],
        },
        supplierEmailAnalysisOutputSchema,
      );
      analysis = ai.output;
    } catch (error) {
      console.error('[ARAT][supplier-email-ai] analysis failed', {
        communicationId: input.communicationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!analysis) {
    await supabase.from('ai_alerts').insert({
      inquiry_id: input.inquiryId,
      agent_id: 'email_response',
      alert_type: 'SUPPLIER_EMAIL_AI_ANALYSIS_UNAVAILABLE',
      message: 'Supplier email was received, but AI analysis could not be completed.',
      priority: 'normal',
    });
    return;
  }

  const currentCommunication = await supabase
    .from('communications')
    .select('metadata')
    .eq('id', input.communicationId)
    .single();

  const metadata = currentCommunication.data?.metadata &&
    typeof currentCommunication.data.metadata === 'object' &&
    !Array.isArray(currentCommunication.data.metadata)
      ? currentCommunication.data.metadata as Record<string, unknown>
      : {};

  await supabase.from('communications').update({
    metadata: {
      ...metadata,
      ai_analysis: {
        summary: analysis.summary,
        supplier_intent: analysis.supplierIntent,
        has_actionable_information: analysis.hasActionableInformation,
        customer_action_required: analysis.customerActionRequired,
        customer_question: analysis.customerQuestion ?? null,
        confidence: analysis.confidence,
      },
    },
  }).eq('id', input.communicationId);

  const notificationMessage = analysis.customerActionRequired && analysis.customerQuestion
    ? `Supplier replied to ${input.rfqCode}. AI: ${analysis.summary} Customer clarification required: ${analysis.customerQuestion}`
    : `Supplier replied to ${input.rfqCode}. AI: ${analysis.summary}`;

  const { data: admins } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('role', 'admin')
    .eq('status', 'active');

  if (admins?.length) {
    await supabase.from('notifications').insert(admins.map((admin) => ({
      user_id: admin.user_id,
      category: analysis.customerActionRequired ? 'customer' : 'supplier',
      priority: analysis.customerActionRequired ? 'urgent' : 'normal',
      title: analysis.customerActionRequired ? 'Customer clarification required' : 'Supplier reply received',
      message: notificationMessage,
      record_type: 'rfq',
      record_id: input.rfqId,
      action_url: `/rfqs?rfq=${input.rfqId}`,
    })));
  }

  if (!analysis.customerActionRequired || !analysis.customerQuestion || !input.customerEmail) {
    return;
  }

  const provider = getEmailProvider();
  const customerSubject = `Action required | ${input.inquiryReference} | ${input.rfqCode}`;
  const customerHtml =
    `<p>Dear ${escapeHtml(input.customerName || 'Customer')},</p>` +
    `<p>To complete your request, we need the following information:</p>` +
    `<p><strong>${escapeHtml(analysis.customerQuestion)}</strong></p>` +
    `<p>Please reply to this email with the requested information. You may also use your ARAT customer portal.</p>` +
    `<p>Best regards,<br/>Arya Automation</p>`;

  try {
    const sent = await provider.send({
      to: [input.customerEmail],
      subject: customerSubject,
      html: customerHtml,
      text: customerHtml.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim(),
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'purchase-dep@aryaautomation.com',
      idempotencyKey: `supplier-clarification:${input.communicationId}`,
    });

    await supabase.from('communications').insert({
      inquiry_id: input.inquiryId,
      customer_id: customerRecord?.id ?? null,
      rfq_id: input.rfqId,
      direction: 'outgoing',
      channel: 'email',
      provider_message_id: sent.providerMessageId ?? null,
      thread_id: sent.threadId ?? null,
      subject: customerSubject,
      body: customerHtml,
      sent_at: sent.sentAt ?? new Date().toISOString(),
      metadata: {
        type: 'supplier_clarification_to_customer',
        source_communication_id: input.communicationId,
        customer_question: analysis.customerQuestion,
      },
    });

    if (input.customerUserId) {
      await supabase.from('notifications').insert({
        user_id: input.customerUserId,
        category: 'customer',
        priority: 'urgent',
        title: 'More information is needed for your request',
        message: analysis.customerQuestion,
        record_type: 'rfq',
        record_id: input.rfqId,
        action_url: `/customer/inquiries/${input.inquiryId}`,
      });
    }

    await supabase.from('timeline_events').insert({
      inquiry_id: input.inquiryId,
      event_type: 'supplier_clarification_sent_to_customer',
      visibility: 'customer',
      actor_type: 'ai',
      agent_id: 'email_response',
      metadata: {
        rfq_id: input.rfqId,
        source_communication_id: input.communicationId,
        customer_question: analysis.customerQuestion,
      },
    });
  } catch (error) {
    await supabase.from('ai_alerts').insert({
      inquiry_id: input.inquiryId,
      agent_id: 'email_response',
      alert_type: 'CUSTOMER_CLARIFICATION_EMAIL_FAILED',
      message: error instanceof Error ? error.message : 'Could not send customer clarification email.',
      priority: 'urgent',
    });
  }
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

  const { data: inquiryContext } = await supabase
    .from('inquiries')
    .select('reference,customers(id,user_id,email,name,company_name)')
    .eq('id', supplierMatch.inquiryId)
    .single();

  const customerRecord = Array.isArray(inquiryContext?.customers)
    ? inquiryContext?.customers[0]
    : inquiryContext?.customers;
  const supplierRecord = await supabase
    .from('suppliers')
    .select('legal_name')
    .eq('id', supplierMatch.supplierId)
    .single();

  await analyzeSupplierEmailAndNotify({
    inquiryId: supplierMatch.inquiryId,
    rfqId: supplierMatch.rfq.id,
    communicationId: communication!.id,
    rfqCode: supplierMatch.rfq.rfq_code,
    inquiryReference: inquiryContext?.reference ?? supplierMatch.rfq.subject ?? 'Inquiry',
    supplierName: supplierRecord.data?.legal_name ?? 'Supplier',
    supplierEmail: extractCustomerEmail(email.from),
    subject,
    body,
    customerId: customerRecord?.id ?? null,
    customerUserId: customerRecord?.user_id ?? null,
    customerEmail: customerRecord?.email ?? null,
    customerName: customerRecord?.company_name || customerRecord?.name || 'Customer',
  });

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
