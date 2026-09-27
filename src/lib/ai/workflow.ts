import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import { getResearchProvider } from './research/provider';
import {
  enqueueWorkflow,
  markExecutionRunning,
  markExecutionSuccess,
  markExecutionFailure,
  type WorkflowStage,
} from './orchestrator';

type RequirementRow = {
  id: string;
  type: string;
  value: string;
  status: 'open' | 'clarification_required' | 'confirmed' | 'rejected';
};

async function timeline(
  inquiryId: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
  agentId = 'orchestrator',
) {
  const supabase = createSupabaseAdminClient();
  await supabase.from('timeline_events').insert({
    inquiry_id: inquiryId,
    event_type: eventType,
    visibility: 'admin',
    actor_type: 'ai',
    agent_id: agentId,
    metadata,
  });
}

async function setInquiryStatus(inquiryId: string, status: string) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from('inquiries')
    .update({ status })
    .eq('id', inquiryId);
  if (error) throw new ToolError('TRANSIENT', error.message);
}

async function createClarificationDrafts(
  inquiryId: string,
  requirements: RequirementRow[],
) {
  const supabase = createSupabaseAdminClient();
  const unresolved = requirements.filter(
    (r) => r.status === 'open' || r.status === 'clarification_required',
  );

  for (const requirement of unresolved) {
    const { data: existing } = await supabase
      .from('clarifications')
      .select('id')
      .eq('inquiry_id', inquiryId)
      .eq('requirement_id', requirement.id)
      .in('status', ['draft', 'pending_approval', 'sent'])
      .limit(1)
      .maybeSingle();

    if (existing) continue;

    await supabase.from('clarifications').insert({
      inquiry_id: inquiryId,
      requirement_id: requirement.id,
      question: `Please confirm the ${requirement.type.replaceAll('_', ' ')}: ${requirement.value}`,
      status: 'draft',
    });
  }
}

async function runStage(inquiryId: string, stage: WorkflowStage) {
  const execution = await enqueueWorkflow(inquiryId, stage);

  if (execution.status === 'succeeded') {
    const output = execution.output_ref as { blocked?: boolean } | null;
    if (!output?.blocked) return { execution, outcome: 'already_succeeded' as const };
    const reopened = await createSupabaseAdminClient()
      .from('ai_executions')
      .update({ status: 'queued', error_code: null, error_message: null, completed_at: null })
      .eq('id', execution.id)
      .eq('status', 'succeeded')
      .select('*')
      .single();
    if (reopened.error || !reopened.data) throw new ToolError('CONFLICT', 'Blocked workflow execution cannot be resumed');
    execution.status = 'queued';
  }

  const running = await markExecutionRunning(execution.id);
  const supabase = createSupabaseAdminClient();

  try {
    const { data: inquiry, error: inquiryError } = await supabase
      .from('inquiries')
      .select('id,status')
      .eq('id', inquiryId)
      .single();

    if (inquiryError || !inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');

    if (stage === 'intake') {
      const { data: requirements, error } = await supabase
        .from('requirements')
        .select('id,type,value,status')
        .eq('inquiry_id', inquiryId)
        .order('created_at', { ascending: true });

      if (error) throw new ToolError('TRANSIENT', error.message);

      const rows = (requirements ?? []) as RequirementRow[];
      const unresolved = rows.filter(
        (r) => r.status === 'open' || r.status === 'clarification_required',
      );

      if (rows.length === 0 || unresolved.length > 0) {
        await createClarificationDrafts(inquiryId, rows);
        await setInquiryStatus(inquiryId, 'clarification_required');
        await timeline(inquiryId, 'workflow_clarification_required', {
          unresolved_requirement_ids: unresolved.map((r) => r.id),
          reason: rows.length === 0 ? 'no_requirements' : 'unresolved_requirements',
        }, 'intake');

        await markExecutionSuccess(running.id, {
          next_stage: 'clarification',
          blocked: true,
          unresolved_count: unresolved.length,
        });

        return { execution: running, outcome: 'clarification_required' as const };
      }

      await setInquiryStatus(inquiryId, 'researching');
      await timeline(inquiryId, 'workflow_research_ready', {
        confirmed_requirement_count: rows.length,
      }, 'intake');

      const research = await enqueueWorkflow(inquiryId, 'research');
      await markExecutionSuccess(running.id, {
        next_stage: 'research',
        research_execution_id: research.id,
      });

      return { execution: running, outcome: 'research_queued' as const };
    }

    if (stage === 'clarification') {
      const { data: pending } = await supabase
        .from('clarifications')
        .select('id,status')
        .eq('inquiry_id', inquiryId)
        .in('status', ['draft', 'pending_approval', 'sent']);

      const unresolved = await supabase
        .from('requirements')
        .select('id')
        .eq('inquiry_id', inquiryId)
        .in('status', ['open', 'clarification_required']);

      if ((unresolved.data?.length ?? 0) > 0) {
        await setInquiryStatus(inquiryId, 'clarification_required');
        await markExecutionSuccess(running.id, {
          blocked: true,
          reason: 'requirements_not_confirmed',
          pending_clarifications: pending?.length ?? 0,
        });
        return { execution: running, outcome: 'still_blocked' as const };
      }

      await setInquiryStatus(inquiryId, 'researching');
      const research = await enqueueWorkflow(inquiryId, 'research');
      await timeline(inquiryId, 'workflow_research_started', {
        execution_id: research.id,
      });
      await markExecutionSuccess(running.id, { next_stage: 'research' });
      return { execution: running, outcome: 'research_queued' as const };
    }

    if (stage === 'verification') {
      const { data: candidates, error } = await supabase
        .from('supplier_candidates')
        .select('id,supplier_id,status,proposed_name,proposed_country,proposed_website,verification_evidence')
        .eq('inquiry_id', inquiryId)
        .eq('status', 'finalized');

      if (error) throw new ToolError('TRANSIENT', error.message);
      if (!candidates?.length) {
        await markExecutionSuccess(running.id, { blocked: true, reason: 'no_finalized_supplier_candidates' });
        await createAlert(inquiryId, 'supplier_verification', 'NO_FINALIZED_SUPPLIERS', 'No finalized supplier candidates are available for verification', 'normal');
        return { execution: running, outcome: 'blocked' as const };
      }

      let verified = 0;
      let pending = 0;

      for (const candidate of candidates) {
        if (!candidate.supplier_id) continue;

        const evidence = {
          candidate_id: candidate.id,
          supplier_name: candidate.proposed_name,
          country: candidate.proposed_country,
          website: candidate.proposed_website,
          ...((candidate.verification_evidence ?? {}) as Record<string, unknown>),
        };

        const hasIdentity = Boolean(candidate.proposed_name?.trim());
        const hasCountry = Boolean(candidate.proposed_country?.trim());
        const hasWebsite = Boolean(candidate.proposed_website?.trim());

        if (hasIdentity && hasCountry && hasWebsite) {
          const { error: updateError } = await supabase
            .from('suppliers')
            .update({
              legal_name: candidate.proposed_name,
              primary_country: candidate.proposed_country,
              verification_status: 'verified',
              last_verified_at: new Date().toISOString(),
            })
            .eq('id', candidate.supplier_id);

          if (updateError) throw new ToolError('CONFLICT', updateError.message);

          await supabase.from('supplier_sources').insert({
            supplier_id: candidate.supplier_id,
            source_type: 'AI Research',
            source_url: candidate.proposed_website,
            source_name: candidate.proposed_name,
            evidence,
          });

          await supabase.from('supplier_verification_history').insert({
            supplier_id: candidate.supplier_id,
            new_status: 'verified',
            reason: 'Verified from finalized candidate evidence',
            explanation: 'Identity, country, and website evidence were available from the approved research candidate.',
            agent_id: 'supplier_verification',
          });

          verified++;
        } else {
          await supabase
            .from('suppliers')
            .update({ verification_status: 'pending' })
            .eq('id', candidate.supplier_id);

          await supabase.from('supplier_verification_history').insert({
            supplier_id: candidate.supplier_id,
            new_status: 'pending',
            reason: 'Insufficient verification evidence',
            explanation: 'Required supplier identity, country, or website evidence is missing.',
            agent_id: 'supplier_verification',
          });

          pending++;
        }
      }

      const outcome = pending > 0 && verified === 0 ? 'verification_pending' : 'verification_completed';

      await markExecutionSuccess(running.id, {
        verified_count: verified,
        pending_count: pending,
        blocked: pending > 0,
        next_stage: pending > 0 ? null : 'rfq',
      });

      await createAlert(
        inquiryId,
        'supplier_verification',
        pending > 0 ? 'SUPPLIER_VERIFICATION_PENDING' : 'SUPPLIER_VERIFICATION_COMPLETED',
        pending > 0
          ? `${pending} supplier(s) remain pending because verification evidence is incomplete.`
          : `${verified} supplier(s) passed the verification evidence gate.`,
        pending > 0 ? 'normal' : 'normal',
      );

      await timeline(inquiryId, 'workflow_supplier_verification_completed', {
        verified_count: verified,
        pending_count: pending,
      }, 'supplier_verification');

      return { execution: running, outcome };
    }

    if (stage === 'supplier_discovery') {
      const { data: research } = await supabase
        .from('research_cases')
        .select('id,status')
        .eq('inquiry_id', inquiryId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!research || research.status !== 'completed') {
        throw new ToolError('CONFLICT', 'Supplier discovery requires completed research');
      }

      const { data: results, error: resultsError } = await supabase
        .from('research_results')
        .select('id,source_name,source_url,finding,structured_data,relevance,confidence,evidence')
        .eq('research_case_id', research.id)
        .order('confidence', { ascending: false, nullsFirst: false });

      if (resultsError) throw new ToolError('TRANSIENT', resultsError.message);

      const { data: existingCandidates } = await supabase
        .from('supplier_candidates')
        .select('proposed_name,status')
        .eq('inquiry_id', inquiryId);

      const blockedNames = new Set(
        (existingCandidates ?? [])
          .filter((item) => item.status === 'admin_removed' || item.status === 'admin_rejected')
          .map((item) => item.proposed_name.toLowerCase().trim()),
      );

      const seen = new Set<string>();
      let createdCount = 0;

      for (const result of results ?? []) {
        if (!result.source_url) continue;

        let hostname = '';
        try {
          hostname = new URL(result.source_url).hostname.replace(/^www\./, '');
        } catch {
          continue;
        }

        const text = `${result.source_name ?? ''} ${result.finding ?? ''}`.toLowerCase();
        const supplierSignal = /(manufacturer|manufacturer[s]?|supplier|distributor|fabricat|hydraulic|industrial|machinery|components?)/i.test(text);
        if (!supplierSignal) continue;

        const proposedName = result.source_name?.trim() || hostname;
        const key = proposedName.toLowerCase();
        if (seen.has(key) || blockedNames.has(key)) continue;
        seen.add(key);

        const { error } = await supabase.from('supplier_candidates').upsert({
          inquiry_id: inquiryId,
          proposed_name: proposedName.slice(0, 240),
          proposed_website: `https://${hostname}`,
          match_evidence: {
            research_result_id: result.id,
            finding: result.finding,
            relevance: result.relevance,
            confidence: result.confidence,
          },
          availability_evidence: {},
          verification_evidence: {
            source_url: result.source_url,
            source_name: result.source_name,
          },
          status: 'proposed',
        }, { onConflict: 'inquiry_id,proposed_name', ignoreDuplicates: true });

        if (!error) createdCount++;
      }

      await markExecutionSuccess(running.id, {
        research_case_id: research.id,
        candidate_count: createdCount,
        next_stage: 'verification',
        blocked: true,
        reason: 'admin_candidate_finalization_required',
      });

      await setInquiryStatus(inquiryId, 'researching');
      await supabase.from('ai_alerts').insert({
        inquiry_id: inquiryId,
        agent_id: 'supplier_discovery',
        alert_type: 'SUPPLIER_CANDIDATES_READY',
        message: `${createdCount} supplier candidate(s) were discovered from stored research evidence. Admin finalization is required before verification or RFQ.`,
        priority: 'normal',
      });
      await timeline(inquiryId, 'workflow_supplier_candidates_ready', {
        research_case_id: research.id,
        candidate_count: createdCount,
      }, 'supplier_discovery');

      return { execution: running, outcome: 'supplier_candidates_ready' as const };
    }


    if (stage === 'research') {
      const { data: existing } = await supabase
        .from('research_cases')
        .select('id,status')
        .eq('inquiry_id', inquiryId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let researchCase = existing;
      if (!researchCase) {
        const created = await supabase
          .from('research_cases')
          .insert({
            inquiry_id: inquiryId,
            status: 'pending',
            scope: { source_types: ['web', 'public_specialized_sources'] },
          })
          .select('id,status')
          .single();
        if (created.error || !created.data) {
          throw new ToolError('TRANSIENT', created.error?.message ?? 'Failed to create research case');
        }
        researchCase = created.data;
      }

      const provider = getResearchProvider();

      if (provider) {
        const { data: requirements } = await supabase
          .from('requirements')
          .select('type,value')
          .eq('inquiry_id', inquiryId)
          .eq('status', 'confirmed')
          .order('created_at', { ascending: true });

        const query = (requirements ?? [])
          .map((item) => `${item.type}: ${item.value}`)
          .join(' | ');

        const results = await provider.search({
          inquiryId,
          query,
          limit: 10,
        });

        for (const result of results) {
          await supabase.from('research_results').insert({
            research_case_id: researchCase.id,
            source_type: result.sourceType,
            source_name: result.sourceName,
            source_url: result.sourceUrl,
            finding: result.finding,
            structured_data: result.structuredData,
            relevance: result.relevance,
            confidence: result.confidence,
            evidence: result.evidence,
          });
        }

        await supabase.from('research_cases')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', researchCase.id);

        const discovery = await enqueueWorkflow(inquiryId, 'supplier_discovery');
        await markExecutionSuccess(running.id, {
          research_case_id: researchCase.id,
          result_count: results.length,
          next_stage: 'supplier_discovery',
          supplier_discovery_execution_id: discovery.id,
        });

        await timeline(inquiryId, 'workflow_research_completed', {
          research_case_id: researchCase.id,
          result_count: results.length,
        }, 'product_research');

        return { execution: running, outcome: 'research_completed' as const };
      }

      await markExecutionSuccess(running.id, {
        research_case_id: researchCase.id,
        blocked: true,
        reason: 'research_provider_not_connected',
      });
      await supabase.from('ai_alerts').insert({
        inquiry_id: inquiryId,
        agent_id: 'product_research',
        alert_type: 'RESEARCH_PROVIDER_NOT_CONNECTED',
        message: 'Research case is ready, but no external research provider is connected yet. No supplier facts were fabricated.',
        priority: 'normal',
      });
      await timeline(inquiryId, 'workflow_research_waiting_for_provider', {
        research_case_id: researchCase.id,
      }, 'product_research');

      return { execution: running, outcome: 'research_provider_required' as const };
    }

    throw new ToolError('VALIDATION', `Stage ${stage} is not executable by the current workflow runner`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow stage failed';
    await markExecutionFailure(
      running.id,
      error instanceof ToolError ? error.code : 'AI_PROCESSING',
      message,
    );
    throw error;
  }
}

export async function startInquiryWorkflow(inquiryId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: inquiry, error } = await supabase
    .from('inquiries')
    .select('id,status')
    .eq('id', inquiryId)
    .single();

  if (error || !inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');

  if (['converted', 'closed', 'no_suitable_supplier'].includes(inquiry.status)) {
    throw new ToolError('CONFLICT', `Inquiry cannot be started from status ${inquiry.status}`);
  }

  await timeline(inquiryId, 'workflow_started', { previous_status: inquiry.status });
  return runStage(inquiryId, 'intake');
}

export async function continueInquiryWorkflow(inquiryId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: inquiry, error } = await supabase
    .from('inquiries')
    .select('id,status')
    .eq('id', inquiryId)
    .single();

  if (error || !inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');

  if (inquiry.status === 'clarification_required') {
    return runStage(inquiryId, 'clarification');
  }

  if (inquiry.status === 'researching') {
    const { data: research } = await supabase
      .from('research_cases')
      .select('status')
      .eq('inquiry_id', inquiryId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!research || research.status === 'pending') {
      return runStage(inquiryId, 'research');
    }
    if (research.status === 'completed') {
      const { data: discovery } = await supabase
        .from('ai_executions')
        .select('id,status,output_ref')
        .eq('inquiry_id', inquiryId)
        .eq('task_key', `inquiry:${inquiryId}:stage:supplier_discovery`)
        .maybeSingle();

      if (discovery?.status === 'succeeded') {
        const { data: finalized } = await supabase
          .from('supplier_candidates')
          .select('id,supplier_id')
          .eq('inquiry_id', inquiryId)
          .eq('status', 'finalized');

        if ((finalized ?? []).some((candidate) => candidate.supplier_id)) {
          return runStage(inquiryId, 'verification');
        }

        throw new ToolError('APPROVAL_REQUIRED', 'Supplier candidates require Admin finalization and supplier approval before verification');
      }

      return runStage(inquiryId, 'supplier_discovery');
    }
  }

  throw new ToolError('CONFLICT', `No executable workflow stage for inquiry status ${inquiry.status}`);
}

export async function getWorkflowState(inquiryId: string) {
  const supabase = createSupabaseAdminClient();
  const [executions, alerts, clarifications, research] = await Promise.all([
    supabase.from('ai_executions').select('id,task_key,agent_id,status,attempt_count,error_code,error_message,started_at,completed_at,created_at').eq('inquiry_id', inquiryId).order('created_at', { ascending: false }).limit(30),
    supabase.from('ai_alerts').select('id,agent_id,alert_type,message,priority,status,created_at').eq('inquiry_id', inquiryId).eq('status', 'open').order('created_at', { ascending: false }).limit(20),
    supabase.from('clarifications').select('id,requirement_id,question,status,created_at').eq('inquiry_id', inquiryId).order('created_at', { ascending: false }),
    supabase.from('research_cases').select('id,status,scope,started_at,completed_at,created_at').eq('inquiry_id', inquiryId).order('created_at', { ascending: false }).limit(5),
  ]);

  return {
    executions: executions.data ?? [],
    alerts: alerts.data ?? [],
    clarifications: clarifications.data ?? [],
    researchCases: research.data ?? [],
  };
}

export async function setClarificationPendingApproval(inquiryId: string, clarificationId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('clarifications')
    .update({ status: 'pending_approval' })
    .eq('id', clarificationId)
    .eq('inquiry_id', inquiryId)
    .eq('status', 'draft')
    .select('id')
    .single();

  if (error || !data) throw new ToolError('CONFLICT', 'Clarification is not in Draft state');
  await timeline(inquiryId, 'clarification_pending_approval', { clarification_id: clarificationId });
  return data;
}
