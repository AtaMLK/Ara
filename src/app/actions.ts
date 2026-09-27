'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/ai/guards';
import { ToolError } from '@/lib/errors';

const idSchema = z.string().uuid();

function fail(error: unknown): never {
  if (error instanceof ToolError) throw new Error(error.message);
  if (error instanceof z.ZodError) throw new Error('Invalid input');
  throw error instanceof Error ? error : new Error('Action failed');
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
