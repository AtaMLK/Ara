'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/ai/guards';
import { ToolError } from '@/lib/errors';
import { continueInquiryWorkflow, startInquiryWorkflow } from '@/lib/ai/workflow';

const idSchema = z.string().uuid();

function fail(error: unknown): never {
  if (error instanceof ToolError) throw new Error(error.message);
  if (error instanceof z.ZodError) throw new Error('Invalid input');
  throw error instanceof Error ? error : new Error('Action failed');
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
