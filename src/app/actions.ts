'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin, requireCustomerAccess, requireCustomerInquiryAccess } from '@/lib/ai/guards';
import { ToolError } from '@/lib/errors';
import { continueInquiryWorkflow, startInquiryWorkflow } from '@/lib/ai/workflow';
import { getEmailProvider } from '@/lib/email/provider';

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
    const subject = `ARAT needs more information — ${inquiry.reference}`;
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
    <p><a href="${inquiryUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:white;text-decoration:none;border-radius:6px">Open request and answer</a></p>
    <p style="color:#6b7280;font-size:13px">Request reference: ${inquiry.reference}</p>
  </body>
</html>`;

    const text = `Hello ${safeCustomerName},

We need one clarification before we can continue processing your procurement request.

Question:
${clarification.question}

Open your request and answer:
${inquiryUrl}

Request reference: ${inquiry.reference}`;

    const provider = getEmailProvider();
    const result = await provider.send({
      from,
      to: [customer.email],
      subject,
      html,
      text,
    });

    const { data, error } = await supabase
      .from('clarifications')
      .update({ status: 'sent', sent_at: result.sentAt })
      .eq('id', clarification.id)
      .eq('inquiry_id', parsed.inquiryId)
      .eq('status', 'pending_approval')
      .select('id')
      .single();

    if (error || !data) {
      await supabase.from('ai_alerts').insert({
        inquiry_id: parsed.inquiryId,
        agent_id: 'orchestrator',
        alert_type: 'CLARIFICATION_EMAIL_STATE_CONFLICT',
        message: `Clarification email was accepted by the provider but the clarification state could not be updated. Provider message: ${result.providerMessageId}`,
        priority: 'urgent',
      });
      throw new ToolError('CONFLICT', 'Email was sent, but the clarification state could not be updated. Check the inquiry before retrying.');
    }

    await supabase.from('communications').insert({
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

    if (customer.user_id) {
      await supabase.from('notifications').insert({
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
    const { supabase, user } = await requireCustomerInquiryAccess(parsed.inquiryId);

    const { data: clarification, error: clarificationError } = await supabase
      .from('clarifications')
      .select('id,inquiry_id,requirement_id,status')
      .eq('id', parsed.clarificationId)
      .eq('inquiry_id', parsed.inquiryId)
      .single();

    if (clarificationError || !clarification) throw new ToolError('NOT_FOUND', 'Clarification not found');
    if (!clarification.requirement_id) throw new ToolError('VALIDATION', 'Clarification is not linked to a requirement');
    if (!['sent'].includes(clarification.status)) throw new ToolError('CONFLICT', 'Only sent clarifications can be answered');

    const { data: requirement, error: requirementError } = await supabase
      .from('requirements')
      .select('id,value,status,current_version,admin_edited')
      .eq('id', clarification.requirement_id)
      .eq('inquiry_id', parsed.inquiryId)
      .single();

    if (requirementError || !requirement) throw new ToolError('NOT_FOUND', 'Requirement not found');
    if (requirement.admin_edited) throw new ToolError('AUTHORIZATION', 'Admin-edited Requirement is authoritative');

    const { data: updated, error: updateError } = await supabase
      .from('requirements')
      .update({
        value: parsed.answer,
        source: 'clarification',
        source_ref: clarification.id,
        status: 'confirmed',
        current_version: requirement.current_version + 1,
      })
      .eq('id', requirement.id)
      .eq('current_version', requirement.current_version)
      .eq('admin_edited', false)
      .select('id,status,current_version')
      .single();

    if (updateError || !updated) throw new ToolError('CONFLICT', 'Requirement changed before the customer answer was applied');

    const { error: clarificationUpdateError } = await supabase
      .from('clarifications')
      .update({
        answer: parsed.answer,
        status: 'answered',
        answered_at: new Date().toISOString(),
      })
      .eq('id', clarification.id)
      .eq('status', 'sent');

    if (clarificationUpdateError) throw new ToolError('CONFLICT', clarificationUpdateError.message);

    await supabase.from('requirement_history').insert({
      requirement_id: requirement.id,
      old_value: requirement.value,
      new_value: parsed.answer,
      old_status: requirement.status,
      new_status: 'confirmed',
      actor_type: 'customer',
      actor_user_id: user.id,
      reason: 'Customer clarification answer applied',
    });

    await supabase.from('timeline_events').insert({
      inquiry_id: parsed.inquiryId,
      event_type: 'clarification_answer_applied',
      visibility: 'customer',
      actor_type: 'customer',
      actor_user_id: user.id,
      metadata: {
        clarification_id: clarification.id,
        requirement_id: requirement.id,
      },
    });

    await continueInquiryWorkflow(parsed.inquiryId);

    revalidatePath('/inquiries');
    revalidatePath(`/inquiries/${parsed.inquiryId}`);
    revalidatePath(`/customer/inquiries/${parsed.inquiryId}`);
    return { ok: true, requirementId: requirement.id };
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

export async function requestQuoteApprovalAction(quoteId: string) {
  try {
    const parsed = idSchema.parse(quoteId);
    const { supabase } = await requireAdmin();
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

export async function approveCustomerQuoteAction(quoteId: string) {
  try {
    const parsed = idSchema.parse(quoteId);
    const { supabase, user } = await requireAdmin();
    const { data, error } = await supabase.from('customer_quotes')
      .update({ status: 'sent', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', parsed)
      .eq('status', 'pending_approval')
      .select('id,inquiry_id')
      .single();

    if (error || !data) throw new ToolError('CONFLICT', 'Quote is not awaiting approval');
    revalidatePath('/quotes');
    revalidatePath(`/inquiries/${data.inquiry_id}`);
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}
