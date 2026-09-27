'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin, requireCustomerAccess, requireCustomerInquiryAccess } from '@/lib/ai/guards';
import { ToolError } from '@/lib/errors';
import { continueInquiryWorkflow, startInquiryWorkflow } from '@/lib/ai/workflow';
import { getEmailProvider } from '@/lib/email/provider';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { applyCustomerClarificationAnswer } from '@/lib/ai/clarification-replies';

const idSchema = z.string().uuid();

function fail(error: unknown): never {
  if (error instanceof ToolError) throw new Error(error.message);
  if (error instanceof z.ZodError) throw new Error('Invalid input');
  throw error instanceof Error ? error : new Error('Action failed');
}

export async function createCustomerInquiryAction(input: {
  title?: string;
  description?: string;
  originalCustomerText: string;
  priority?: 'normal' | 'urgent';
  files?: File[];
}) {
  try {
    const parsed = z.object({
      title: z.string().trim().max(200).optional(),
      description: z.string().trim().max(5000).optional(),
      originalCustomerText: z.string().trim().min(1).max(20000),
      priority: z.enum(['normal', 'urgent']).default('normal'),
      files: z.array(z.instanceof(File)).max(10).default([]),
    }).parse(input);

    const { supabase, user, customer } = await requireCustomerAccess();
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const title = parsed.title || 'New procurement request';

    let inquiry: { id: string; reference: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const reference = `${customer.customer_code}-${date}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const { data, error } = await supabase.from('inquiries').insert({
        customer_id: customer.id,
        reference,
        title,
        description: parsed.description || null,
        status: 'processing',
        priority: parsed.priority,
        original_customer_text: parsed.originalCustomerText,
      }).select('id,reference').single();
      if (data) { inquiry = data; break; }
      if (attempt === 2) throw new ToolError('CONFLICT', error?.message ?? 'Inquiry creation failed');
    }

    if (!inquiry) throw new ToolError('CONFLICT', 'Inquiry creation failed');

    await supabase.from('timeline_events').insert({
      inquiry_id: inquiry.id,
      event_type: 'customer_inquiry_created',
      visibility: 'customer',
      actor_type: 'customer',
      actor_user_id: user.id,
      metadata: { reference: inquiry.reference },
    });

    if (parsed.files.length) {
      await uploadInquiryFilesAction({ inquiryId: inquiry.id, files: parsed.files });
    }

    try {
      await startInquiryWorkflow(inquiry.id);
    } catch (workflowError) {
      await supabase.from('timeline_events').insert({
        inquiry_id: inquiry.id,
        event_type: 'workflow_start_failed',
        visibility: 'admin',
        actor_type: 'system',
        metadata: { message: workflowError instanceof Error ? workflowError.message : 'Workflow start failed' },
      });
    }

    revalidatePath('/customer');
    revalidatePath(`/customer/inquiries/${inquiry.id}`);
    revalidatePath('/inquiries');
    return { ok: true, inquiryId: inquiry.id, reference: inquiry.reference };
  } catch (error) {
    fail(error);
  }
}

const INQUIRY_FILE_LIMIT = 10 * 1024 * 1024;
const INQUIRY_TOTAL_FILE_LIMIT = 25 * 1024 * 1024;
const ALLOWED_INQUIRY_FILES = new Map([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'excel'],
  ['application/vnd.ms-excel', 'excel'],
  ['text/csv', 'excel'],
  ['image/png', 'image'],
  ['image/jpeg', 'image'],
  ['image/webp', 'image'],
]);

export async function uploadInquiryFilesAction(input: {
  inquiryId: string;
  files: File[];
}) {
  try {
    const parsed = z.object({
      inquiryId: idSchema,
      files: z.array(z.instanceof(File)).min(1).max(10),
    }).parse(input);

    const { supabase, user } = await requireCustomerInquiryAccess(parsed.inquiryId);
    const { data: inquiry } = await supabase
      .from('inquiries')
      .select('id,reference')
      .eq('id', parsed.inquiryId)
      .single();

    if (!inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');

    const totalSize = parsed.files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > INQUIRY_TOTAL_FILE_LIMIT) throw new ToolError('VALIDATION', 'Total attachment size must not exceed 25 MB');

    const uploaded: Array<{ id: string; name: string }> = [];

    for (const file of parsed.files) {
      const category = ALLOWED_INQUIRY_FILES.get(file.type);
      if (!category) throw new ToolError('VALIDATION', `Unsupported file type: ${file.name}`);
      if (file.size <= 0 || file.size > INQUIRY_FILE_LIMIT) {
        throw new ToolError('VALIDATION', `File must be between 1 byte and 10 MB: ${file.name}`);
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
      const storagePath = `${inquiry.id}/${crypto.randomUUID()}-${safeName}`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      const { error: uploadError } = await supabase.storage
        .from('inquiry-files')
        .upload(storagePath, bytes, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) throw new ToolError('CONFLICT', `File upload failed: ${file.name}`);

      const { data: row, error: rowError } = await supabase
        .from('inquiry_files')
        .insert({
          inquiry_id: inquiry.id,
          storage_path: storagePath,
          original_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          status: 'uploaded',
          uploaded_by: user.id,
          metadata: { category },
        })
        .select('id,original_name')
        .single();

      if (rowError || !row) {
        await supabase.storage.from('inquiry-files').remove([storagePath]);
        throw new ToolError('CONFLICT', `Could not register file: ${file.name}`);
      }

      const { error: processingError } = await supabase
        .from('document_processing')
        .insert({
          file_id: row.id,
          processor: 'document_agent',
          status: 'processing',
          attempt_count: 0,
        });

      if (processingError) {
        await supabase.storage.from('inquiry-files').remove([storagePath]);
        await supabase.from('inquiry_files').delete().eq('id', row.id);
        throw new ToolError('CONFLICT', `Could not queue document processing: ${file.name}`);
      }

      await supabase.from('inquiry_files')
        .update({ status: 'processing' })
        .eq('id', row.id);

      await supabase.from('timeline_events').insert({
        inquiry_id: inquiry.id,
        event_type: 'customer_file_uploaded',
        visibility: 'customer',
        actor_type: 'customer',
        actor_user_id: user.id,
        metadata: { file_id: row.id, file_name: file.name, category },
      });

      uploaded.push({ id: row.id, name: row.original_name });
    }

    revalidatePath(`/customer/inquiries/${inquiry.id}`);
    revalidatePath('/inquiries');
    return { ok: true, uploaded };
  } catch (error) {
    fail(error);
  }
}

export async function getCustomerInquiryFileUrlAction(input: { inquiryId: string; fileId: string }) {
  try {
    const parsed = z.object({ inquiryId: idSchema, fileId: idSchema }).parse(input);
    const { supabase } = await requireCustomerInquiryAccess(parsed.inquiryId);

    const { data: file, error } = await supabase
      .from('inquiry_files')
      .select('id,storage_path,original_name,mime_type')
      .eq('id', parsed.fileId)
      .eq('inquiry_id', parsed.inquiryId)
      .single();

    if (error || !file) throw new ToolError('NOT_FOUND', 'File not found');

    const { data, error: signedError } = await supabase.storage
      .from('inquiry-files')
      .createSignedUrl(file.storage_path, 300);

    if (signedError || !data?.signedUrl) {
      throw new ToolError('TRANSIENT', 'Could not create file access link');
    }

    return {
      ok: true,
      url: data.signedUrl,
      fileName: file.original_name,
      mimeType: file.mime_type,
    };
  } catch (error) {
    fail(error);
  }
}

export async function startInquiryWorkflowAction(inquiryId: string) {
  try {
    const parsed = idSchema.parse(inquiryId);
    await requireAdmin();
    const result = await startInquiryWorkflow(parsed);
    revalidatePath('/inquiries');
    revalidatePath(`/inquiries/${parsed}`);
    return { ok: true, outcome: result.outcome };
  } catch (error) {
    fail(error);
  }
}

export async function continueInquiryWorkflowAction(inquiryId: string) {
  try {
    const parsed = idSchema.parse(inquiryId);
    await requireAdmin();
    const result = await continueInquiryWorkflow(parsed);
    revalidatePath('/inquiries');
    revalidatePath(`/inquiries/${parsed}`);
    return { ok: true, outcome: result.outcome };
  } catch (error) {
    fail(error);
  }
}

export async function approveSupplierCandidateAction(input: { inquiryId: string; candidateId: string }) {
  try {
    const parsed = z.object({ inquiryId: idSchema, candidateId: idSchema }).parse(input);
    const { supabase, user } = await requireAdmin();

    const { data: candidate, error: readError } = await supabase
      .from('supplier_candidates')
      .select('id,status,supplier_id,proposed_name,proposed_country,proposed_website')
      .eq('id', parsed.candidateId)
      .eq('inquiry_id', parsed.inquiryId)
      .single();

    if (readError || !candidate) throw new ToolError('NOT_FOUND', 'Supplier candidate not found');
    if (candidate.status !== 'finalized') throw new ToolError('CONFLICT', 'Candidate must be finalized before adding a supplier');
    if (candidate.supplier_id) throw new ToolError('CONFLICT', 'Supplier is already attached to this candidate');
    if (!candidate.proposed_country) throw new ToolError('VALIDATION', 'Supplier country is required before adding the supplier');

    const { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .insert({
        legal_name: candidate.proposed_name,
        primary_country: candidate.proposed_country,
        supplier_type: 'unknown',
        verification_status: 'pending',
        status: 'active',
      })
      .select('id')
      .single();

    if (supplierError || !supplier) throw new ToolError('CONFLICT', supplierError?.message ?? 'Supplier creation failed');

    const { error: candidateError } = await supabase
      .from('supplier_candidates')
      .update({ supplier_id: supplier.id })
      .eq('id', candidate.id)
      .eq('status', 'finalized')
      .is('supplier_id', null);

    if (candidateError) throw new ToolError('CONFLICT', candidateError.message);

    await supabase.from('supplier_sources').insert({
      supplier_id: supplier.id,
      source_type: 'AI Research',
      source_url: candidate.proposed_website,
      source_name: candidate.proposed_name,
      evidence: { candidate_id: candidate.id },
    });

    await supabase.from('supplier_verification_history').insert({
      supplier_id: supplier.id,
      old_status: 'unverified',
      new_status: 'pending',
      reason: 'Admin approved supplier candidate',
      changed_by: user.id,
      agent_id: 'supplier_discovery',
    });

    await supabase.from('timeline_events').insert({
      inquiry_id: parsed.inquiryId,
      event_type: 'supplier_candidate_approved',
      visibility: 'admin',
      actor_type: 'admin',
      actor_user_id: user.id,
      metadata: { candidate_id: candidate.id, supplier_id: supplier.id },
    });

    revalidatePath(`/inquiries/${parsed.inquiryId}`);
    revalidatePath('/suppliers');
    return { ok: true, supplierId: supplier.id };
  } catch (error) {
    fail(error);
  }
}


export async function finalizeSupplierCandidateAction(input: { inquiryId: string; candidateId: string }) {
  try {
    const parsed = z.object({ inquiryId: idSchema, candidateId: idSchema }).parse(input);
    const { supabase, user } = await requireAdmin();

    const { data: candidate, error: readError } = await supabase
      .from('supplier_candidates')
      .select('id,status,proposed_name,proposed_country,proposed_website')
      .eq('id', parsed.candidateId)
      .eq('inquiry_id', parsed.inquiryId)
      .single();

    if (readError || !candidate) throw new ToolError('NOT_FOUND', 'Supplier candidate not found');
    if (candidate.status !== 'proposed') throw new ToolError('CONFLICT', 'Only proposed candidates can be finalized');

    const { data, error } = await supabase
      .from('supplier_candidates')
      .update({ status: 'finalized' })
      .eq('id', parsed.candidateId)
      .eq('inquiry_id', parsed.inquiryId)
      .eq('status', 'proposed')
      .select('id')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Candidate changed. Refresh and try again.');

    await supabase.from('timeline_events').insert({
      inquiry_id: parsed.inquiryId,
      event_type: 'supplier_candidate_finalized',
      visibility: 'admin',
      actor_type: 'admin',
      actor_user_id: user.id,
      metadata: { candidate_id: parsed.candidateId },
    });

    revalidatePath(`/inquiries/${parsed.inquiryId}`);
    revalidatePath('/suppliers');
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}

export async function approveClarificationAction(input: { inquiryId: string; clarificationId: string }) {
  try {
    const parsed = z.object({ inquiryId: idSchema, clarificationId: idSchema }).parse(input);
    const { supabase, user } = await requireAdmin();
    const { data, error } = await supabase
      .from('clarifications')
      .update({ status: 'pending_approval', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', parsed.clarificationId)
      .eq('inquiry_id', parsed.inquiryId)
      .eq('status', 'draft')
      .select('id')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Clarification is not in Draft state');
    await supabase.from('timeline_events').insert({
      inquiry_id: parsed.inquiryId,
      event_type: 'clarification_pending_approval',
      visibility: 'admin',
      actor_type: 'admin',
      actor_user_id: user.id,
      metadata: { clarification_id: parsed.clarificationId },
    });
    revalidatePath(`/inquiries/${parsed.inquiryId}`);
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}

export async function sendClarificationAction(input: { inquiryId: string; clarificationId: string }) {
  try {
    const parsed = z.object({
      inquiryId: idSchema,
      clarificationId: idSchema,
    }).parse(input);
    const { supabase, user } = await requireAdmin();

    const { data: clarification, error: readError } = await supabase
      .from('clarifications')
      .select('id,requirement_id,question,status')
      .eq('id', parsed.clarificationId)
      .eq('inquiry_id', parsed.inquiryId)
      .single();

    if (readError || !clarification) throw new ToolError('NOT_FOUND', 'Clarification not found');
    if (!clarification.requirement_id) throw new ToolError('VALIDATION', 'Clarification is not linked to a requirement');
    if (clarification.status !== 'pending_approval') {
      throw new ToolError('CONFLICT', 'Only approved clarifications can be sent');
    }

    const { data: inquiry } = await supabase
      .from('inquiries')
      .select('id,reference,title,customer_id')
      .eq('id', parsed.inquiryId)
      .single();

    if (!inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');

    const { data: customer } = await supabase
      .from('customers')
      .select('id,email,name,company_name,user_id')
      .eq('id', inquiry.customer_id)
      .single();

    if (!customer?.email) throw new ToolError('VALIDATION', 'Customer email is not configured');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const from = process.env.EMAIL_FROM;
    if (!appUrl || !from) {
      throw new ToolError('VALIDATION', 'NEXT_PUBLIC_APP_URL and EMAIL_FROM must be configured');
    }

    const customerName = customer.company_name || customer.name;
    const safeCustomerName = customerName
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

    const { data: previousSend } = await supabase
      .from('communications')
      .select('id,provider_message_id')
      .eq('inquiry_id', inquiry.id)
      .eq('customer_id', customer.id)
      .eq('direction', 'outgoing')
      .eq('channel', 'email')
      .contains('metadata', { type: 'clarification', clarification_id: clarification.id })
      .limit(1)
      .maybeSingle();

    if (previousSend?.provider_message_id) {
      throw new ToolError('CONFLICT', 'This clarification email has already been sent');
    }

    const inquiryUrl = `${appUrl.replace(/\/$/, '')}/customer/inquiries/${inquiry.id}`;
    const subject = `ARAT needs more information — ${inquiry.reference} — ${clarification.id.slice(0, 8)}`;
    const safeQuestion = clarification.question
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

    const html = `<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
    <h2>More information is required</h2>
    <p>Hello ${safeCustomerName},</p>
    <p>We need one clarification before we can continue processing your procurement request.</p>
    <div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;margin:20px 0">
      <strong>${safeQuestion}</strong>
    </div>
    <p><strong>You can reply directly to this email with your answer, or use the button below.</strong></p>
    <p><a href="${inquiryUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:white;text-decoration:none;border-radius:6px">Open request and answer</a></p>
    <p style="color:#6b7280;font-size:13px">Request reference: ${inquiry.reference}</p>
  </body>
</html>`;

    const text = `Hello ${safeCustomerName},

We need one clarification before we can continue processing your procurement request.

Question:
${clarification.question}

You can reply directly to this email with your answer, or open your request here:
${inquiryUrl}

Request reference: ${inquiry.reference}`;

    const provider = getEmailProvider();
    const result = await provider.send({
      from,
      to: [customer.email],
      subject,
      html,
      text,
      idempotencyKey: `clarification-${clarification.id}`,
    });

    const adminSupabase = createSupabaseAdminClient();

    // Persist the provider message before changing the clarification state.
    // If the state update fails after the provider accepted the message, a retry
    // will still see this communication and cannot send the same email again.
    const { error: communicationError } = await adminSupabase.from('communications').insert({
      inquiry_id: parsed.inquiryId,
      customer_id: customer.id,
      direction: 'outgoing',
      channel: 'email',
      provider_message_id: result.providerMessageId,
      thread_id: result.threadId ?? null,
      subject,
      body: text,
      sent_at: result.sentAt,
      metadata: {
        type: 'clarification',
        clarification_id: clarification.id,
      },
    });

    if (communicationError) {
      await adminSupabase.from('ai_alerts').insert({
        inquiry_id: parsed.inquiryId,
        agent_id: 'orchestrator',
        alert_type: 'CLARIFICATION_EMAIL_LOG_CONFLICT',
        message: `Clarification email was accepted by the provider but could not be recorded. Provider message: ${result.providerMessageId}`,
        priority: 'urgent',
      });
      throw new ToolError('CONFLICT', 'Email was sent, but could not be recorded. Check the inquiry before retrying.');
    }

    const { data, error } = await adminSupabase
      .from('clarifications')
      .update({ status: 'sent', sent_at: result.sentAt })
      .eq('id', clarification.id)
      .eq('inquiry_id', parsed.inquiryId)
      .eq('status', 'pending_approval')
      .select('id')
      .single();

    if (error || !data) {
      await adminSupabase.from('ai_alerts').insert({
        inquiry_id: parsed.inquiryId,
        agent_id: 'orchestrator',
        alert_type: 'CLARIFICATION_EMAIL_STATE_CONFLICT',
        message: `Clarification email was accepted by the provider and recorded, but the clarification state could not be updated. Provider message: ${result.providerMessageId}`,
        priority: 'urgent',
      });
      throw new ToolError('CONFLICT', 'Email was sent and recorded, but the clarification state could not be updated. Check the inquiry.');
    }

    if (customer.user_id) {
      await adminSupabase.from('notifications').insert({
        user_id: customer.user_id,
        category: 'customer',
        priority: 'normal',
        title: 'More information required',
        message: `Please answer the clarification for request ${inquiry.reference}.`,
        record_type: 'inquiry',
        record_id: inquiry.id,
        action_url: `/customer/inquiries/${inquiry.id}`,
      });
    }

    await supabase.from('timeline_events').insert({
      inquiry_id: parsed.inquiryId,
      event_type: 'clarification_sent',
      visibility: 'customer',
      actor_type: 'admin',
      actor_user_id: user.id,
      metadata: { clarification_id: clarification.id },
    });

    revalidatePath('/inquiries');
    revalidatePath(`/inquiries/${parsed.inquiryId}`);
    revalidatePath(`/customer/inquiries/${parsed.inquiryId}`);
    return { ok: true, providerMessageId: result.providerMessageId };
  } catch (error) {
    fail(error);
  }
}

export async function answerClarificationAction(input: { inquiryId: string; clarificationId: string; answer: string }) {
  try {
    const parsed = z.object({
      inquiryId: idSchema,
      clarificationId: idSchema,
      answer: z.string().trim().min(1),
    }).parse(input);

    const { customer, user } = await requireCustomerInquiryAccess(parsed.inquiryId);
    const result = await applyCustomerClarificationAnswer({
      inquiryId: parsed.inquiryId,
      clarificationId: parsed.clarificationId,
      answer: parsed.answer,
      customerUserId: user.id,
    });

    if (result.duplicate) {
      throw new ToolError('CONFLICT', 'This clarification has already been answered');
    }

    await createSupabaseAdminClient().from('notifications').insert({
      user_id: customer.user_id ?? user.id,
      category: 'customer',
      priority: 'normal',
      title: 'Clarification answer received',
      message: 'Your clarification answer was received and processing has resumed.',
      record_type: 'inquiry',
      record_id: parsed.inquiryId,
      action_url: `/customer/inquiries/${parsed.inquiryId}`,
    });

    revalidatePath('/inquiries');
    revalidatePath(`/inquiries/${parsed.inquiryId}`);
    revalidatePath(`/customer/inquiries/${parsed.inquiryId}`);
    return { ok: true, requirementId: result.requirementId };
  } catch (error) {
    fail(error);
  }
}

export async function updateInquiryAction(input: {
  inquiryId: string;
  title: string;
  description: string;
  expectedVersion: number;
}) {
  try {
    const parsed = z.object({
      inquiryId: idSchema,
      title: z.string().min(1),
      description: z.string(),
      expectedVersion: z.number().int().positive(),
    }).parse(input);

    const { supabase } = await requireAdmin();
    const { data: current, error: readError } = await supabase
      .from('inquiries').select('id,current_version').eq('id', parsed.inquiryId).single();

    if (readError || !current) throw new ToolError('NOT_FOUND', 'Inquiry not found');
    if (current.current_version !== parsed.expectedVersion) throw new ToolError('CONFLICT', 'Inquiry changed. Refresh and try again.');

    const { data, error } = await supabase.from('inquiries')
      .update({
        title: parsed.title,
        description: parsed.description,
        current_version: current.current_version + 1,
      })
      .eq('id', parsed.inquiryId)
      .eq('current_version', current.current_version)
      .select('id')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Inquiry update conflict');
    revalidatePath('/inquiries');
    revalidatePath(`/inquiries/${parsed.inquiryId}`);
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}

export async function updateRequirementAction(input: {
  inquiryId: string;
  requirementId: string;
  value: string;
  status: 'open' | 'clarification_required' | 'confirmed' | 'rejected';
}) {
  try {
    const parsed = z.object({
      inquiryId: idSchema,
      requirementId: idSchema,
      value: z.string().min(1),
      status: z.enum(['open', 'clarification_required', 'confirmed', 'rejected']),
    }).parse(input);

    const { supabase, user } = await requireAdmin();
    const { data: current, error: readError } = await supabase
      .from('requirements')
      .select('id,inquiry_id,value,status,current_version')
      .eq('id', parsed.requirementId)
      .eq('inquiry_id', parsed.inquiryId)
      .single();

    if (readError || !current) throw new ToolError('NOT_FOUND', 'Requirement not found');

    const { data, error } = await supabase.from('requirements')
      .update({
        value: parsed.value,
        status: parsed.status,
        admin_edited: true,
        current_version: current.current_version + 1,
      })
      .eq('id', current.id)
      .eq('current_version', current.current_version)
      .select('id')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Requirement update conflict');

    await supabase.from('requirement_history').insert({
      requirement_id: current.id,
      old_value: current.value,
      new_value: parsed.value,
      old_status: current.status,
      new_status: parsed.status,
      actor_type: 'admin',
      actor_user_id: user.id,
      reason: 'Admin edit',
    });

    revalidatePath(`/inquiries/${parsed.inquiryId}`);
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}

export async function approveRfqAction(rfqId: string) {
  try {
    const parsed = idSchema.parse(rfqId);
    const { supabase, user } = await requireAdmin();
    const { data, error } = await supabase.from('rfqs')
      .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', parsed)
      .eq('status', 'pending_approval')
      .select('id,inquiry_id')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'RFQ is not awaiting approval');
    revalidatePath('/rfqs');
    revalidatePath(`/inquiries/${data.inquiry_id}`);
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}

export async function createExchangeRateAction(input: {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  validFrom: string;
  validUntil?: string;
  source?: string;
}) {
  try {
    const parsed = z.object({
      fromCurrency: z.string().trim().toUpperCase().length(3),
      toCurrency: z.string().trim().toUpperCase().length(3),
      rate: z.number().positive(),
      validFrom: z.string().date(),
      validUntil: z.string().date().optional(),
      source: z.string().trim().max(200).optional(),
    }).refine((v) => v.fromCurrency !== v.toCurrency, {
      message: 'Currencies must be different',
      path: ['toCurrency'],
    }).refine((v) => !v.validUntil || v.validUntil >= v.validFrom, {
      message: 'Valid until must be on or after valid from',
      path: ['validUntil'],
    }).parse(input);

    const { supabase, user } = await requireAdmin();
    const { data, error } = await supabase
      .from('exchange_rates')
      .insert({
        from_currency: parsed.fromCurrency,
        to_currency: parsed.toCurrency,
        rate: parsed.rate,
        valid_from: parsed.validFrom,
        valid_until: parsed.validUntil ?? null,
        source: parsed.source || null,
        status: 'proposed',
        approved_by: null,
        approved_at: null,
      })
      .select('id,status')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', error?.message ?? 'Exchange rate creation failed');

    await supabase.from('audit_logs').insert({
      actor_type: 'admin',
      actor_user_id: user.id,
      action: 'exchange_rate_created',
      record_type: 'exchange_rate',
      record_id: data.id,
      after_data: {
        from_currency: parsed.fromCurrency,
        to_currency: parsed.toCurrency,
        rate: parsed.rate,
        valid_from: parsed.validFrom,
        valid_until: parsed.validUntil ?? null,
        source: parsed.source || null,
        status: 'proposed',
      },
    });

    revalidatePath('/settings');
    return { ok: true, id: data.id };
  } catch (error) {
    fail(error);
  }
}

export async function approveExchangeRateAction(rateId: string) {
  try {
    const parsed = idSchema.parse(rateId);
    const { supabase, user } = await requireAdmin();

    const { data: rate, error: readError } = await supabase
      .from('exchange_rates')
      .select('id,status,from_currency,to_currency,rate,valid_from,valid_until')
      .eq('id', parsed)
      .single();

    if (readError || !rate) throw new ToolError('NOT_FOUND', 'Exchange rate not found');
    if (rate.status !== 'proposed') throw new ToolError('CONFLICT', 'Only proposed exchange rates can be approved');

    const { data: approvedRates, error: approvedRatesError } = await supabase
      .from('exchange_rates')
      .select('id,valid_from,valid_until')
      .eq('status', 'approved')
      .eq('from_currency', rate.from_currency)
      .eq('to_currency', rate.to_currency)
      .neq('id', rate.id);

    if (approvedRatesError) throw new ToolError('TRANSIENT', approvedRatesError.message);

    const proposedStart = new Date(rate.valid_from + 'T00:00:00Z').getTime();
    const proposedEnd = rate.valid_until ? new Date(rate.valid_until + 'T00:00:00Z').getTime() : Number.POSITIVE_INFINITY;
    const overlaps = (approvedRates ?? []).some((existing) => {
      const existingStart = new Date(existing.valid_from + 'T00:00:00Z').getTime();
      const existingEnd = existing.valid_until
        ? new Date(existing.valid_until + 'T00:00:00Z').getTime()
        : Number.POSITIVE_INFINITY;
      return existingStart <= proposedEnd && proposedStart <= existingEnd;
    });

    if (overlaps) {
      throw new ToolError('CONFLICT', 'An approved exchange rate overlaps this currency pair and validity period');
    }

    const { data, error } = await supabase
      .from('exchange_rates')
      .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', parsed)
      .eq('status', 'proposed')
      .select('id,status')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Exchange rate changed. Refresh and try again.');

    await supabase.from('audit_logs').insert({
      actor_type: 'admin',
      actor_user_id: user.id,
      action: 'exchange_rate_approved',
      record_type: 'exchange_rate',
      record_id: rate.id,
      before_data: { status: rate.status },
      after_data: { status: 'approved' },
    });

    revalidatePath('/settings');
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}

export async function rejectExchangeRateAction(rateId: string) {
  try {
    const parsed = idSchema.parse(rateId);
    const { supabase, user } = await requireAdmin();

    const { data, error } = await supabase
      .from('exchange_rates')
      .update({ status: 'rejected', approved_by: null, approved_at: null })
      .eq('id', parsed)
      .eq('status', 'proposed')
      .select('id,status')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Exchange rate is not in Proposed state');

    await supabase.from('audit_logs').insert({
      actor_type: 'admin',
      actor_user_id: user.id,
      action: 'exchange_rate_rejected',
      record_type: 'exchange_rate',
      record_id: rateId,
      before_data: { status: 'proposed' },
      after_data: { status: 'rejected' },
    });

    revalidatePath('/settings');
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}

export async function createCustomerPricingRuleAction(input: {
  name: string;
  markupPercent: number;
  roundingIncrement?: number;
}) {
  try {
    const parsed = z.object({
      name: z.string().trim().min(1).max(200),
      markupPercent: z.number().min(0),
      roundingIncrement: z.number().positive().optional(),
    }).parse(input);
    const { supabase, user } = await requireAdmin();
    const { data, error } = await supabase
      .from('customer_pricing_rules')
      .insert({
        name: parsed.name,
        markup_percent: parsed.markupPercent,
        rounding_increment: parsed.roundingIncrement ?? null,
        status: 'pending_approval',
        created_by: user.id,
      })
      .select('id,status')
      .single();
    if (error || !data) throw new ToolError('CONFLICT', error?.message ?? 'Pricing rule creation failed');
    revalidatePath('/settings');
    return { ok: true, id: data.id };
  } catch (error) {
    fail(error);
  }
}

export async function approveCustomerPricingRuleAction(ruleId: string) {
  try {
    const parsed = idSchema.parse(ruleId);
    const { supabase, user } = await requireAdmin();
    const { data: existing } = await supabase
      .from('customer_pricing_rules')
      .select('id,status')
      .eq('status', 'approved')
      .maybeSingle();
    if (existing) throw new ToolError('CONFLICT', 'An approved customer pricing rule already exists');
    const { data, error } = await supabase
      .from('customer_pricing_rules')
      .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', parsed)
      .eq('status', 'pending_approval')
      .select('id,status')
      .single();
    if (error || !data) throw new ToolError('CONFLICT', 'Pricing rule is not awaiting approval');
    revalidatePath('/settings');
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}

export async function confirmCustomerQuoteItemPriceAction(itemId: string, unitPrice: number) {
  try {
    const parsed = idSchema.parse(itemId);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ToolError('VALIDATION', 'Customer price must be a non-negative number');
    const { supabase } = await requireAdmin();
    const { data: item, error: itemError } = await supabase
      .from('customer_quote_items')
      .select('id,customer_quote_id,unit_price,price_status')
      .eq('id', parsed)
      .single();
    if (itemError || !item) throw new ToolError('NOT_FOUND', 'Quote item not found');

    const { data: quote, error: quoteError } = await supabase
      .from('customer_quotes')
      .select('id,status')
      .eq('id', item.customer_quote_id)
      .single();
    if (quoteError || !quote) throw new ToolError('NOT_FOUND', 'Customer quote not found');
    if (!['draft', 'pending_approval'].includes(quote.status)) {
      throw new ToolError('CONFLICT', 'Only Draft or Pending Approval quotes can have their prices edited');
    }

    const { data, error } = await supabase
      .from('customer_quote_items')
      .update({ unit_price: unitPrice, price_status: 'admin_confirmed' })
      .eq('id', parsed)
      .select('id,customer_quote_id')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Quote item price could not be confirmed');

    await supabase.from('audit_logs').insert({
      actor_type: 'admin',
      action: 'customer_quote_item_price_confirmed',
      record_type: 'customer_quote_item',
      record_id: item.id,
      before_data: { unit_price: item.unit_price, price_status: item.price_status },
      after_data: { unit_price: unitPrice, price_status: 'admin_confirmed' },
      metadata: { customer_quote_id: item.customer_quote_id },
    });

    revalidatePath('/quotes');
    revalidatePath('/inquiries');
    return { ok: true, quoteId: data.customer_quote_id };
  } catch (error) {
    fail(error);
  }
}

export async function requestQuoteApprovalAction(quoteId: string) {
  try {
    const parsed = idSchema.parse(quoteId);
    const { supabase } = await requireAdmin();
    const { data: pendingItems, error: itemError } = await supabase
      .from('customer_quote_items')
      .select('id,price_status')
      .eq('customer_quote_id', parsed);

    if (itemError) throw new ToolError('TRANSIENT', itemError.message);
    if (!pendingItems?.length) throw new ToolError('CONFLICT', 'Quote must contain at least one item');
    if (pendingItems.some((item) => item.price_status !== 'admin_confirmed')) {
      throw new ToolError('APPROVAL_REQUIRED', 'Every customer quote item price must be confirmed by Admin');
    }

    const { data, error } = await supabase.from('customer_quotes')
      .update({ status: 'pending_approval' })
      .eq('id', parsed)
      .eq('status', 'draft')
      .select('id,inquiry_id')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Quote is not in Draft state');
    revalidatePath('/quotes');
    revalidatePath(`/inquiries/${data.inquiry_id}`);
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}


function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function approveCustomerQuoteAction(quoteId: string) {
  try {
    const parsed = idSchema.parse(quoteId);
    const { supabase, user } = await requireAdmin();

    const { data: quote, error: quoteError } = await supabase
      .from('customer_quotes')
      .select('id,inquiry_id,reference,revision_number,status,currency,valid_until,subject,body,customer_id')
      .eq('id', parsed)
      .single();

    if (quoteError || !quote) throw new ToolError('NOT_FOUND', 'Customer quote not found');
    if (quote.status !== 'pending_approval') throw new ToolError('CONFLICT', 'Quote is not awaiting approval');

    const { data: pendingItems, error: itemError } = await supabase
      .from('customer_quote_items')
      .select('id,product_id,quantity,unit_price,total,price_status,supplier_products(product_name,model_part_number)')
      .eq('customer_quote_id', parsed)
      .order('created_at', { ascending: true });

    if (itemError) throw new ToolError('TRANSIENT', itemError.message);
    if (!pendingItems?.length || pendingItems.some((item) => item.price_status !== 'admin_confirmed')) {
      throw new ToolError('APPROVAL_REQUIRED', 'Every customer quote item price must be confirmed by Admin');
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id,email,name,company_name,user_id')
      .eq('id', quote.customer_id)
      .single();

    if (customerError || !customer?.email) {
      throw new ToolError('VALIDATION', 'Customer email is not configured');
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const from = process.env.EMAIL_FROM;
    if (!appUrl || !from) {
      throw new ToolError('VALIDATION', 'NEXT_PUBLIC_APP_URL and EMAIL_FROM must be configured');
    }

    const adminSupabase = createSupabaseAdminClient();
    const idempotencyKey = `customer-quote-${quote.id}-r${quote.revision_number}`;

    const { data: previousSend, error: previousSendError } = await adminSupabase
      .from('communications')
      .select('id,provider_message_id,thread_id,sent_at')
      .eq('quote_id', quote.id)
      .eq('direction', 'outgoing')
      .eq('channel', 'email')
      .contains('metadata', { type: 'customer_quote', quote_id: quote.id })
      .limit(1)
      .maybeSingle();

    if (previousSendError) throw new ToolError('TRANSIENT', previousSendError.message);
    if (previousSend?.provider_message_id) {
      throw new ToolError('CONFLICT', 'This customer quote has already been sent');
    }

    const customerName = customer.company_name || customer.name || 'Customer';
    const quoteUrl = `${appUrl.replace(/\/$/, '')}/customer/inquiries/${quote.inquiry_id}`;
    const subject = quote.subject?.trim() || `ARAT quotation — ${quote.reference}`;

    const rows = pendingItems.map((item) => {
      const product = Array.isArray(item.supplier_products) ? item.supplier_products[0] : item.supplier_products;
      const productName = product?.product_name || product?.model_part_number || 'Quoted item';
      const model = product?.model_part_number && product?.product_name ? `<div style="color:#6b7280;font-size:12px">${escapeHtml(product.model_part_number)}</div>` : '';
      return `<tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(productName)}${model}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${escapeHtml(item.quantity)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${escapeHtml(item.unit_price.toFixed ? item.unit_price.toFixed(2) : item.unit_price)} ${escapeHtml(quote.currency)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${escapeHtml(item.total.toFixed ? item.total.toFixed(2) : item.total)} ${escapeHtml(quote.currency)}</td>
      </tr>`;
    }).join('');

    const grandTotal = pendingItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const safeName = escapeHtml(customerName);
    const safeBody = escapeHtml(quote.body || '').replaceAll('\n', '<br />');
    const validUntil = quote.valid_until
      ? `<p><strong>Valid until:</strong> ${escapeHtml(quote.valid_until)}</p>`
      : '';

    const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f7f8fa;font-family:Arial,sans-serif;color:#17202a;line-height:1.6">
    <div style="max-width:720px;margin:0 auto;padding:32px 20px">
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
        <h2 style="margin-top:0">Quotation ${escapeHtml(quote.reference)}</h2>
        <p>Hello ${safeName},</p>
        <p>Please find our quotation below.</p>
        ${safeBody ? `<p>${safeBody}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px">
          <thead>
            <tr>
              <th style="text-align:left;padding:10px 8px;border-bottom:2px solid #d1d5db">Item</th>
              <th style="text-align:right;padding:10px 8px;border-bottom:2px solid #d1d5db">Qty</th>
              <th style="text-align:right;padding:10px 8px;border-bottom:2px solid #d1d5db">Unit price</th>
              <th style="text-align:right;padding:10px 8px;border-bottom:2px solid #d1d5db">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="padding:14px 8px;text-align:right;font-weight:700">Total</td>
              <td style="padding:14px 8px;text-align:right;font-weight:700">${grandTotal.toFixed(2)} ${escapeHtml(quote.currency)}</td>
            </tr>
          </tfoot>
        </table>
        ${validUntil}
        <p><a href="${quoteUrl}" style="display:inline-block;padding:10px 16px;background:#17202a;color:#fff;text-decoration:none;border-radius:7px">Open request in ARAT</a></p>
        <p style="color:#6b7280;font-size:12px">Quotation reference: ${escapeHtml(quote.reference)}</p>
      </div>
    </div>
  </body>
</html>`;

    const textLines = pendingItems.map((item) => {
      const product = Array.isArray(item.supplier_products) ? item.supplier_products[0] : item.supplier_products;
      const productName = product?.product_name || product?.model_part_number || 'Quoted item';
      return `- ${productName} | Qty: ${item.quantity} | Unit: ${Number(item.unit_price).toFixed(2)} ${quote.currency} | Total: ${Number(item.total).toFixed(2)} ${quote.currency}`;
    }).join('\n');

    const text = `Hello ${customerName},

Please find our quotation ${quote.reference} below.

${quote.body || ''}

${textLines}

Total: ${grandTotal.toFixed(2)} ${quote.currency}
${quote.valid_until ? `Valid until: ${quote.valid_until}\n` : ''}
Open your request in ARAT:
${quoteUrl}`;

    const provider = getEmailProvider();
    const result = await provider.send({
      from,
      to: [customer.email],
      subject,
      html,
      text,
      idempotencyKey,
    });

    const { error: communicationError } = await adminSupabase.from('communications').insert({
      inquiry_id: quote.inquiry_id,
      customer_id: quote.customer_id,
      quote_id: quote.id,
      direction: 'outgoing',
      channel: 'email',
      provider_message_id: result.providerMessageId,
      thread_id: result.threadId ?? null,
      subject,
      body: text,
      sent_at: result.sentAt,
      metadata: {
        type: 'customer_quote',
        quote_id: quote.id,
        reference: quote.reference,
        revision_number: quote.revision_number,
        currency: quote.currency,
        item_count: pendingItems.length,
      },
    });

    if (communicationError) {
      await adminSupabase.from('ai_alerts').insert({
        inquiry_id: quote.inquiry_id,
        agent_id: 'orchestrator',
        alert_type: 'CUSTOMER_QUOTE_EMAIL_LOG_CONFLICT',
        message: `Customer quote email was accepted by the provider but could not be recorded. Provider message: ${result.providerMessageId}`,
        priority: 'urgent',
      });
      throw new ToolError('CONFLICT', 'Email was sent, but could not be recorded. Check the quote before retrying.');
    }

    const { data: updatedQuote, error: updateError } = await adminSupabase
      .from('customer_quotes')
      .update({
        status: 'sent',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        sent_at: result.sentAt,
      })
      .eq('id', quote.id)
      .eq('status', 'pending_approval')
      .select('id,inquiry_id')
      .single();

    if (updateError || !updatedQuote) {
      await adminSupabase.from('ai_alerts').insert({
        inquiry_id: quote.inquiry_id,
        agent_id: 'orchestrator',
        alert_type: 'CUSTOMER_QUOTE_EMAIL_STATE_CONFLICT',
        message: `Customer quote email was accepted and recorded, but quote state could not be changed to Sent. Provider message: ${result.providerMessageId}`,
        priority: 'urgent',
      });
      throw new ToolError('CONFLICT', 'Email was sent and recorded, but quote state could not be updated. Check the quote.');
    }

    await adminSupabase.from('audit_logs').insert({
      actor_type: 'admin',
      actor_user_id: user.id,
      action: 'customer_quote_approved_and_sent',
      record_type: 'customer_quote',
      record_id: quote.id,
      before_data: { status: quote.status },
      after_data: { status: 'sent', sent_at: result.sentAt },
      metadata: { provider_message_id: result.providerMessageId, recipient: customer.email },
    });

    await adminSupabase.from('timeline_events').insert({
      inquiry_id: quote.inquiry_id,
      event_type: 'customer_quote_sent',
      visibility: 'customer',
      actor_type: 'admin',
      actor_user_id: user.id,
      metadata: { quote_id: quote.id, reference: quote.reference },
    });

    if (customer.user_id) {
      await adminSupabase.from('notifications').insert({
        user_id: customer.user_id,
        category: 'customer',
        priority: 'normal',
        title: 'Quotation sent',
        message: `Quotation ${quote.reference} has been sent.`,
        record_type: 'customer_quote',
        record_id: quote.id,
        action_url: quoteUrl,
      });
    }

    revalidatePath('/quotes');
    revalidatePath(`/quotes/${quote.id}`);
    revalidatePath(`/inquiries/${quote.inquiry_id}`);
    revalidatePath(`/customer/inquiries/${quote.inquiry_id}`);
    return { ok: true, providerMessageId: result.providerMessageId };
  } catch (error) {
    fail(error);
  }
}
