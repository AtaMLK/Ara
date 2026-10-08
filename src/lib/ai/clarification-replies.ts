import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import { continueInquiryWorkflow } from './workflow';

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '');
}

export function cleanEmailReply(text?: string | null, html?: string | null) {
  let value = (text ?? '').trim();
  if (!value && html) value = stripHtml(html).trim();

  value = value
    .replace(/\r/g, '')
    .replace(/^\s*On .+?wrote:\s*$/gim, '\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .trim();

  const quoted = value.search(/\n\s*(On .+?wrote:|From:\s|Sent:\s|-----Original Message-----)/i);
  if (quoted > 0) value = value.slice(0, quoted).trim();

  return value.slice(0, 20000);
}

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

export async function applyCustomerClarificationAnswer(input: {
  inquiryId: string;
  clarificationId: string;
  answer: string;
  customerUserId?: string | null;
  communicationId?: string | null;
}) {
  const answer = input.answer.trim();
  if (!answer) throw new ToolError('VALIDATION', 'Customer answer is empty');

  const supabase = createSupabaseAdminClient();

  const { data: clarification, error: clarificationError } = await supabase
    .from('clarifications')
    .select('id,inquiry_id,requirement_id,status,question')
    .eq('id', input.clarificationId)
    .eq('inquiry_id', input.inquiryId)
    .single();

  if (clarificationError || !clarification) throw new ToolError('NOT_FOUND', 'Clarification not found');

  if (clarification.status === 'answered') {
    await continueInquiryWorkflow(input.inquiryId);
    return { ok: true, duplicate: true, requirementId: clarification.requirement_id };
  }

  if (clarification.status !== 'sent') {
    throw new ToolError('CONFLICT', 'Only sent clarifications can be answered');
  }

  if (!clarification.requirement_id) {
    const { data: clarificationUpdated, error: clarificationUpdateError } = await supabase
      .from('clarifications')
      .update({
        answer,
        status: 'answered',
        answered_at: new Date().toISOString(),
      })
      .eq('id', clarification.id)
      .eq('status', 'sent')
      .select('id')
      .single();

    if (clarificationUpdateError || !clarificationUpdated) {
      throw new ToolError('CONFLICT', 'Clarification could not be updated. Refresh and try again.');
    }

    await supabase.from('timeline_events').insert({
      inquiry_id: input.inquiryId,
      event_type: input.communicationId ? 'clarification_answer_received_by_email' : 'clarification_answer_applied',
      visibility: 'customer',
      actor_type: 'customer',
      actor_user_id: input.customerUserId ?? null,
      metadata: {
        clarification_id: clarification.id,
        communication_id: input.communicationId ?? null,
        channel: input.communicationId ? 'email' : 'portal',
        generic_supplier_clarification: true,
      },
    });

    await continueInquiryWorkflow(input.inquiryId);
    return { ok: true, duplicate: false, requirementId: null };
  }

  const { data: requirement, error: requirementError } = await supabase
    .from('requirements')
    .select('id,type,value,status,current_version,admin_edited,source_ref')
    .eq('id', clarification.requirement_id)
    .eq('inquiry_id', input.inquiryId)
    .single();

  if (requirementError || !requirement) throw new ToolError('NOT_FOUND', 'Requirement not found');
  if (requirement.admin_edited) throw new ToolError('AUTHORIZATION', 'Admin-edited Requirement is authoritative');

  const isModelClarification =
    requirement.type === 'product' &&
    /(model|part\s*number|part\s*no\.?)/i.test(clarification.question ?? '');

  let appliedRequirementId = requirement.id;

  if (isModelClarification) {
    // A model/part-number answer must never replace the product itself.
    // Keep the product requirement intact and store the answer as a dedicated
    // model_part_number requirement linked to the same source item.
    const { data: existingModel } = await supabase
      .from('requirements')
      .select('id,value,status,current_version,admin_edited')
      .eq('inquiry_id', input.inquiryId)
      .eq('type', 'model_part_number')
      .eq('source_ref', requirement.source_ref)
      .maybeSingle();

    if (existingModel) {
      const { data: updatedModel, error: modelError } = await supabase
        .from('requirements')
        .update({
          value: answer,
          source: 'clarification',
          source_ref: requirement.source_ref,
          status: 'confirmed',
          current_version: existingModel.current_version + 1,
        })
        .eq('id', existingModel.id)
        .eq('current_version', existingModel.current_version)
        .eq('admin_edited', false)
        .select('id')
        .single();

      if (modelError || !updatedModel) {
        throw new ToolError('CONFLICT', 'Model/part number requirement changed before the customer answer was applied');
      }
      appliedRequirementId = updatedModel.id;
    } else {
      const { data: createdModel, error: modelError } = await supabase
        .from('requirements')
        .insert({
          inquiry_id: input.inquiryId,
          type: 'model_part_number',
          value: answer,
          source: 'clarification',
          source_ref: requirement.source_ref,
          status: 'confirmed',
          admin_edited: false,
        })
        .select('id')
        .single();

      if (modelError || !createdModel) {
        throw new ToolError('CONFLICT', modelError?.message ?? 'Could not save model/part number');
      }
      appliedRequirementId = createdModel.id;

      await supabase.from('requirement_history').insert({
        requirement_id: createdModel.id,
        old_value: null,
        new_value: answer,
        old_status: 'open',
        new_status: 'confirmed',
        actor_type: 'customer',
        actor_user_id: input.customerUserId ?? null,
        reason: 'Customer clarification answer applied as model/part number',
      });
    }

    // The product itself is now sufficiently specified.
    await supabase
      .from('requirements')
      .update({ status: 'confirmed' })
      .eq('id', requirement.id)
      .eq('inquiry_id', input.inquiryId)
      .eq('admin_edited', false);
  } else {
    const { data: updated, error: updateError } = await supabase
      .from('requirements')
      .update({
        value: answer,
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
  }

  const { data: clarificationUpdated, error: clarificationUpdateError } = await supabase
    .from('clarifications')
    .update({
      answer,
      status: 'answered',
      answered_at: new Date().toISOString(),
    })
    .eq('id', clarification.id)
    .eq('status', 'sent')
    .select('id')
    .single();

  if (clarificationUpdateError || !clarificationUpdated) {
    await supabase.from('ai_alerts').insert({
      inquiry_id: input.inquiryId,
      agent_id: 'orchestrator',
      alert_type: 'CLARIFICATION_ANSWER_STATE_CONFLICT',
      message: 'The customer answer was applied to the requirement but the clarification state could not be updated. Manual review is required.',
      priority: 'urgent',
    });
    throw new ToolError('CONFLICT', 'Answer was received but the clarification state could not be updated. Check the inquiry.');
  }

  await supabase.from('requirement_history').insert({
    requirement_id: requirement.id,
    old_value: requirement.value,
    new_value: answer,
    old_status: requirement.status,
    new_status: 'confirmed',
    actor_type: 'customer',
    actor_user_id: input.customerUserId ?? null,
    reason: input.communicationId ? 'Customer clarification answer received by email' : 'Customer clarification answer applied',
  });

  await supabase.from('timeline_events').insert({
    inquiry_id: input.inquiryId,
    event_type: input.communicationId ? 'clarification_answer_received_by_email' : 'clarification_answer_applied',
    visibility: 'customer',
    actor_type: 'customer',
    actor_user_id: input.customerUserId ?? null,
    metadata: {
      clarification_id: clarification.id,
      requirement_id: requirement.id,
      communication_id: input.communicationId ?? null,
      channel: input.communicationId ? 'email' : 'portal',
    },
  });

  await continueInquiryWorkflow(input.inquiryId);

  return { ok: true, duplicate: false, requirementId: appliedRequirementId };
}

export async function findCustomerClarificationForEmail(input: {
  sender: string;
  subject: string;
}) {
  const supabase = createSupabaseAdminClient();
  const senderEmail = extractEmailAddress(input.sender);

  const { data: customer } = await supabase
    .from('customers')
    .select('id,user_id,email,name,company_name')
    .ilike('email', senderEmail)
    .eq('status', 'active')
    .maybeSingle();

  if (!customer) return { matched: false as const, reason: 'customer_not_found' as const };

  const normalizedSubject = input.subject.trim().replace(/^re:\s*/i, '');
  const prefix = 'ARAT needs more information — ';
  const reference = normalizedSubject.toLowerCase().startsWith(prefix.toLowerCase())
    ? normalizedSubject.slice(prefix.length).split(' — ')[0].trim()
    : null;

  let inquiryId: string | null = null;
  if (reference) {
    const { data: inquiry } = await supabase
      .from('inquiries')
      .select('id,reference')
      .eq('reference', reference)
      .eq('customer_id', customer.id)
      .maybeSingle();
    inquiryId = inquiry?.id ?? null;
  }

  if (!inquiryId) {
    const { data: communications } = await supabase
      .from('communications')
      .select('inquiry_id,metadata,subject,created_at')
      .eq('customer_id', customer.id)
      .eq('direction', 'outgoing')
      .eq('channel', 'email')
      .order('created_at', { ascending: false })
      .limit(50);

    const candidate = (communications ?? []).find((row) => {
      const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const type = String(metadata.type ?? '');
      const subject = (row.subject ?? '').trim().toLowerCase().replace(/^re:\s*/i, '');
      return ['clarification', 'supplier_clarification_to_customer'].includes(type) && subject === normalizedSubject;
    });
    inquiryId = candidate?.inquiry_id ?? null;
  }

  if (!inquiryId) return { matched: false as const, reason: 'inquiry_not_found' as const };

  const { data: communications } = await supabase
    .from('communications')
    .select('metadata,created_at')
    .eq('customer_id', customer.id)
    .eq('inquiry_id', inquiryId)
    .eq('direction', 'outgoing')
    .eq('channel', 'email')
    .order('created_at', { ascending: false })
    .limit(50);

  const sent = (communications ?? [])
    .filter((row) => {
      const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      return ['clarification', 'supplier_clarification_to_customer'].includes(String(metadata.type ?? ''));
    })
    .map((row) => ({
      clarificationId: typeof row.metadata?.clarification_id === 'string' ? row.metadata.clarification_id : null,
      createdAt: row.created_at,
    }))
    .filter((row) => row.clarificationId);

  if (sent.length === 0) return { matched: false as const, reason: 'clarification_email_not_found' as const };

  const activeIds = [...new Set(sent.map((row) => row.clarificationId!))];

  const { data: clarifications } = await supabase
    .from('clarifications')
    .select('id,question,status,created_at')
    .eq('inquiry_id', inquiryId)
    .in('id', activeIds)
    .eq('status', 'sent');

  if (!clarifications?.length) return { matched: false as const, reason: 'no_pending_clarification' as const };
  if (clarifications.length > 1) {
    return { matched: false as const, reason: 'multiple_pending_clarifications' as const };
  }

  return {
    matched: true as const,
    customer,
    inquiryId,
    clarification: clarifications[0],
  };
}

export { extractEmailAddress };
