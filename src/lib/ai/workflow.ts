import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import { getResearchProvider } from './research/provider';
import { runAgent } from './agent-runner';
import { documentOutputSchema, intakeOutputSchema, clarificationOutputSchema } from './agent-schemas';
import { downloadInquiryFile, parseInquiryFile } from './document-processor';
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

    if (stage === 'document') {
      const { data: files, error: filesError } = await supabase
        .from('inquiry_files')
        .select('id,storage_path,original_name,mime_type,status')
        .eq('inquiry_id', inquiryId)
        .in('status', ['uploaded', 'processing'])
        .order('uploaded_at', { ascending: true });

      if (filesError) throw new ToolError('TRANSIENT', filesError.message);

      let processed = 0;
      let failed = 0;
      let ocrPending = 0;

      for (const file of files ?? []) {
        try {
          const bytes = await downloadInquiryFile(file.storage_path);
          const parsed = await parseInquiryFile(bytes, file.mime_type, file.original_name);

          let extraction = {
            extractedText: parsed.extractedText,
            extractedData: parsed.extractedData,
            qualityFlags: parsed.qualityFlags,
            requirements: [] as Array<{type:'product'|'model_part_number'|'quantity'|'specification'|'delivery'|'other';value:string;sourceRef?:string}>,
          };

          if (parsed.extractedText.trim()) {
            const ai = await runAgent(
              { agentId: 'document', executionId: running.id, inquiryId },
              {
                file_id: file.id,
                file_name: file.original_name,
                mime_type: file.mime_type,
                extracted_text: parsed.extractedText,
                instructions: [
                  'Extract only information explicitly present in the document text.',
                  'Do not infer missing values.',
                  'Return requirements only when the document explicitly supports them.',
                  'Use sourceRef values that identify a useful location such as page number, sheet name, or row range when available.',
                  'Flag ambiguity or unreadable content in qualityFlags.',
                ],
              },
              documentOutputSchema,
            );
            extraction = {
              extractedText: parsed.extractedText,
              extractedData: parsed.extractedData,
              qualityFlags: [...parsed.qualityFlags, ...ai.output.qualityFlags],
              requirements: ai.output.requirements,
            };
          } else {
            ocrPending++;
          }

          const { error: processingError } = await supabase
            .from('document_processing')
            .update({
              status: 'processed',
              extracted_text: extraction.extractedText,
              extracted_data: extraction.extractedData,
              quality_flags: extraction.qualityFlags,
              source_map: { file_name: file.original_name },
              completed_at: new Date().toISOString(),
            })
            .eq('file_id', file.id);

          if (processingError) throw new ToolError('TRANSIENT', processingError.message);

          await supabase.from('inquiry_files')
            .update({ status: 'processed', processed_at: new Date().toISOString() })
            .eq('id', file.id);

          for (const requirement of extraction.requirements) {
            const sourceRef = `${file.id}:${requirement.sourceRef ?? 'document'}`;
            const { data: duplicate } = await supabase
              .from('requirements')
              .select('id')
              .eq('inquiry_id', inquiryId)
              .eq('type', requirement.type)
              .eq('value', requirement.value)
              .eq('source', file.mime_type === 'text/csv' || file.mime_type.includes('spreadsheet') || file.mime_type === 'application/vnd.ms-excel' ? 'excel' : file.mime_type.startsWith('image/') ? 'image' : 'pdf')
              .maybeSingle();

            if (!duplicate) {
              await supabase.from('requirements').insert({
                inquiry_id: inquiryId,
                type: requirement.type,
                value: requirement.value,
                source: file.mime_type === 'text/csv' || file.mime_type.includes('spreadsheet') || file.mime_type === 'application/vnd.ms-excel' ? 'excel' : file.mime_type.startsWith('image/') ? 'image' : 'pdf',
                source_ref: sourceRef,
                status: 'open',
                admin_edited: false,
              });
            }
          }

          processed++;
          await timeline(inquiryId, 'document_processed', {
            file_id: file.id,
            file_name: file.original_name,
            quality_flags: extraction.qualityFlags,
            requirement_count: extraction.requirements.length,
          }, 'document');
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : 'Document processing failed';
          await supabase.from('document_processing').update({
            status: 'processing_failed',
            error_code: error instanceof ToolError ? error.code : 'AI_PROCESSING',
            error_message: message,
            attempt_count: 1,
          }).eq('file_id', file.id);
          await supabase.from('inquiry_files').update({ status: 'processing_failed' }).eq('id', file.id);
          await supabase.from('ai_alerts').insert({
            inquiry_id: inquiryId,
            agent_id: 'document',
            alert_type: 'DOCUMENT_PROCESSING_FAILED',
            message: `${file.original_name}: ${message}`,
            priority: 'normal',
          });
        }
      }

      await markExecutionSuccess(running.id, {
        processed,
        failed,
        ocr_pending: ocrPending,
        next_stage: 'intake',
      });

      const intake = await enqueueWorkflow(inquiryId, 'intake');
      await timeline(inquiryId, 'workflow_document_completed', {
        processed,
        failed,
        ocr_pending: ocrPending,
        intake_execution_id: intake.id,
      }, 'document');

      return { execution: running, outcome: 'intake_queued' as const };
    }

    if (stage === 'intake') {
      const { data: requirements, error } = await supabase
        .from('requirements')
        .select('id,type,value,status')
        .eq('inquiry_id', inquiryId)
        .order('created_at', { ascending: true });

      if (error) throw new ToolError('TRANSIENT', error.message);

      // Intake may augment document-derived requirements with customer-text requirements.
      // Existing requirements, especially Admin-edited rows, remain authoritative.
        const { data: source, error: sourceError } = await supabase
          .from('inquiries')
          .select('id,title,description,original_customer_text,normalized_information,current_version')
          .eq('id', inquiryId)
          .single();
        if (sourceError || !source) throw new ToolError('NOT_FOUND', 'Inquiry source not found');

        const originalText = source.original_customer_text?.trim();
        const { data: documentRows } = await supabase
          .from('document_processing')
          .select('file_id,extracted_text,source_map,quality_flags')
          .eq('status', 'processed')
          .in('file_id', (await supabase.from('inquiry_files').select('id').eq('inquiry_id', inquiryId)).data?.map((f) => f.id) ?? []);

        const documentText = (documentRows ?? [])
          .filter((row) => row.extracted_text?.trim())
          .map((row) => JSON.stringify({
            file_id: row.file_id,
            source_map: row.source_map,
            quality_flags: row.quality_flags,
            text: row.extracted_text,
          }))
          .join('\n\n');

        if (originalText || documentText) {
          const ai = await runAgent(
            { agentId: 'intake', executionId: running.id, inquiryId },
            {
              original_customer_text: originalText ?? '',
              document_text: documentText,
              existing_requirements: (requirements ?? []).map((item) => ({
                type: item.type,
                value: item.value,
                source: item.source,
                source_ref: item.source_ref,
              })),
              existing_title: source.title,
              existing_description: source.description,
              instructions: [
                'Use only explicitly supported customer text facts.',
                'Do not mark material requirements confirmed when ambiguous.',
                'For unclear quantities, model, brand, or specifications, report ambiguity.',
                'Do not invent evidence references or document content.',
                'Requirements may be sourced from customer_text, pdf, excel, or image only when explicitly supported by the supplied source text. For document-derived requirements, include sourceRef and preserve the file_id/location provenance.',
              ],
            },
            intakeOutputSchema,
          );
          const result = ai.output;
          if (result.requirements.some((item) =>
            item.source === 'customer_text' ? Boolean(item.sourceRef) : !Boolean(item.sourceRef)
          )) {
            throw new ToolError('AI_PROCESSING', 'Intake returned invalid source provenance');
          }

          // An execution can be retried after partial persistence; never duplicate
          // the first extraction or overwrite changes made after the model call.
          const { data: latest, error: latestError } = await supabase
            .from('requirements')
            .select('id,type,value,source,source_ref,admin_edited')
            .eq('inquiry_id', inquiryId);
          if (latestError) throw new ToolError('TRANSIENT', latestError.message);

          const existingKeys = new Set(
            (latest ?? []).map((item) => `${item.type}|${item.value.trim().toLowerCase()}`)
          );
          const ambiguityTypes = new Set(result.ambiguities.map((a) => a.requirementType));
          const inserts = result.requirements
            .filter((item) => {
              const key = `${item.type}|${item.value.trim().toLowerCase()}`;
              return !existingKeys.has(key);
            })
            .map((item) => ({
              inquiry_id: inquiryId,
              type: item.type,
              value: item.value,
              source: item.source,
              source_ref: item.source === 'customer_text' ? null : item.sourceRef,
              status: ambiguityTypes.has(item.type) ? 'clarification_required' : 'open',
              admin_edited: false,
            }));
          if (inserts.length) {
            const { error: insertError } = await supabase.from('requirements').insert(inserts);
            if (insertError) throw new ToolError('CONFLICT', insertError.message);
          }
            // Only update AI-generated title/description while the source version
            // remains unchanged. Preserve existing human-authored values.
            await supabase.from('inquiries')
              .update({
                normalized_information: {
                  ...((source.normalized_information ?? {}) as Record<string, unknown>),
                  intake: {
                    title: result.title,
                    description: result.description,
                    ambiguities: result.ambiguities,
                    model: ai.model,
                    provider: ai.provider,
                    execution_id: running.id,
                  },
                },
              })
              .eq('id', inquiryId)
              .eq('current_version', source.current_version);
            await timeline(inquiryId, 'intake_ai_extracted', {
              execution_id: running.id,
              extracted_requirements: inserts.length,
              ambiguity_count: result.ambiguities.length,
              provider: ai.provider,
              model: ai.model,
            }, 'intake');
          }
        }
      }

      // Re-read after extraction so the existing clarification gate handles
      // newly extracted requirements in the same workflow execution.
      const { data: currentRequirements, error: currentError } = await supabase
        .from('requirements')
        .select('id,type,value,status')
        .eq('inquiry_id', inquiryId)
        .order('created_at', { ascending: true });
      if (currentError) throw new ToolError('TRANSIENT', currentError.message);
      const rows = (currentRequirements ?? []) as RequirementRow[];
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
      const { data: requirements, error: requirementsError } = await supabase
        .from('requirements')
        .select('id,type,value,status,admin_edited,current_version')
        .eq('inquiry_id', inquiryId)
        .in('status', ['open', 'clarification_required'])
        .order('created_at', { ascending: true });

      if (requirementsError) throw new ToolError('TRANSIENT', requirementsError.message);

      if ((requirements ?? []).length > 0) {
        const { data: existing } = await supabase
          .from('clarifications')
          .select('id,requirement_id,question,status')
          .eq('inquiry_id', inquiryId)
          .in('status', ['draft', 'pending_approval', 'sent'])
          .order('created_at', { ascending: true });

        const existingRequirementIds = new Set(
          (existing ?? []).map((item) => item.requirement_id).filter(Boolean),
        );

        const unresolvedForAI = (requirements ?? []).filter(
          (item) => !existingRequirementIds.has(item.id),
        );

        if (unresolvedForAI.length > 0) {
          const ai = await runAgent(
            { agentId: 'clarification', executionId: running.id, inquiryId },
            {
              requirements: unresolvedForAI.map((item) => ({
                id: item.id,
                type: item.type,
                value: item.value,
                admin_edited: item.admin_edited,
                current_version: item.current_version,
              })),
              instructions: [
                'Only ask about material ambiguity that can change product, model, part number, quantity, specification, delivery, price, currency, terms, or supplier identity.',
                'Ask the minimum targeted question.',
                'Never ask the customer to repeat information that is already explicit.',
                'Do not resolve the ambiguity yourself.',
                'Do not create or send customer communication.',
              ],
            },
            clarificationOutputSchema,
          );

          for (const question of ai.output.questions) {
            if (!question.requirementId) continue;
            const requirement = unresolvedForAI.find((item) => item.id === question.requirementId);
            if (!requirement || existingRequirementIds.has(requirement.id)) continue;

            const { error: insertError } = await supabase.from('clarifications').insert({
              inquiry_id: inquiryId,
              requirement_id: requirement.id,
              question: question.question,
              status: 'draft',
            });
            if (insertError) throw new ToolError('CONFLICT', insertError.message);
          }

          await timeline(inquiryId, 'clarification_ai_drafts_created', {
            execution_id: running.id,
            question_count: ai.output.questions.length,
            provider: ai.provider,
            model: ai.model,
          }, 'clarification');
        }

        await setInquiryStatus(inquiryId, 'clarification_required');
        const { data: drafts } = await supabase
          .from('clarifications')
          .select('id,status')
          .eq('inquiry_id', inquiryId)
          .in('status', ['draft', 'pending_approval', 'sent']);

        await markExecutionSuccess(running.id, {
          blocked: true,
          reason: 'requirements_not_confirmed',
          pending_clarifications: drafts?.length ?? 0,
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

      if (pending === 0 && verified > 0) {
        await enqueueStage(inquiryId, 'rfq');
      }

      return { execution: running, outcome };
    }

    if (stage === 'reporting') {
      const [
        inquiryResult,
        requirementsResult,
        candidatesResult,
        suppliersResult,
        rfqsResult,
        responsesResult,
        quotesResult,
        customerQuotesResult,
        alertsResult,
      ] = await Promise.all([
        supabase.from('inquiries').select('id,reference,status,priority,title,created_at,updated_at').eq('id', inquiryId).single(),
        supabase.from('requirements').select('id,type,value,status,created_at').eq('inquiry_id', inquiryId),
        supabase.from('supplier_candidates').select('id,proposed_name,status,supplier_id,created_at').eq('inquiry_id', inquiryId),
        supabase.from('supplier_candidates').select('supplier_id').eq('inquiry_id', inquiryId).not('supplier_id','is',null),
        supabase.from('rfqs').select('id,supplier_id,status,created_at,sent_at').eq('inquiry_id', inquiryId),
        supabase.from('supplier_responses').select('id,supplier_id,status,created_at').eq('inquiry_id', inquiryId),
        supabase.from('supplier_quotes').select('id,supplier_response_id,match_status,currency,quantity,moq,net_price,valid_until').in(
          'supplier_response_id',
          (await supabase.from('supplier_responses').select('id').eq('inquiry_id', inquiryId)).data?.map((r) => r.id) ?? [],
        ),
        supabase.from('customer_quotes').select('id,reference,revision_number,status,currency,valid_until,created_at').eq('inquiry_id', inquiryId).order('created_at',{ascending:false}),
        supabase.from('ai_alerts').select('id,alert_type,message,priority,status,created_at').eq('inquiry_id', inquiryId).eq('status','open'),
      ]);

      if (inquiryResult.error || !inquiryResult.data) throw new ToolError('NOT_FOUND','Inquiry not found');
      if (requirementsResult.error) throw new ToolError('TRANSIENT',requirementsResult.error.message);
      if (candidatesResult.error) throw new ToolError('TRANSIENT',candidatesResult.error.message);
      if (rfqsResult.error) throw new ToolError('TRANSIENT',rfqsResult.error.message);
      if (responsesResult.error) throw new ToolError('TRANSIENT',responsesResult.error.message);
      if (customerQuotesResult.error) throw new ToolError('TRANSIENT',customerQuotesResult.error.message);
      if (alertsResult.error) throw new ToolError('TRANSIENT',alertsResult.error.message);

      const report = {
        generated_at: new Date().toISOString(),
        policy: 'factual_current_state_only_no_ranking',
        inquiry: inquiryResult.data,
        requirements: {
          total: requirementsResult.data?.length ?? 0,
          by_status: (requirementsResult.data ?? []).reduce<Record<string,number>>((acc,r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
          }, {}),
        },
        supplier_candidates: {
          total: candidatesResult.data?.length ?? 0,
          by_status: (candidatesResult.data ?? []).reduce<Record<string,number>>((acc,r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
          }, {}),
        },
        rfqs: {
          total: rfqsResult.data?.length ?? 0,
          by_status: (rfqsResult.data ?? []).reduce<Record<string,number>>((acc,r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
          }, {}),
        },
        supplier_responses: {
          total: responsesResult.data?.length ?? 0,
          by_status: (responsesResult.data ?? []).reduce<Record<string,number>>((acc,r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
          }, {}),
        },
        supplier_quotes: {
          total: quotesResult.data?.length ?? 0,
          by_match_status: (quotesResult.data ?? []).reduce<Record<string,number>>((acc,r) => {
            acc[r.match_status] = (acc[r.match_status] ?? 0) + 1; return acc;
          }, {}),
          currencies: [...new Set((quotesResult.data ?? []).map((q) => q.currency).filter(Boolean))],
        },
        customer_quotes: {
          total: customerQuotesResult.data?.length ?? 0,
          latest: customerQuotesResult.data?.[0] ?? null,
        },
        open_ai_alerts: alertsResult.data ?? [],
      };

      await markExecutionSuccess(running.id, report);
      await timeline(inquiryId, 'reporting_completed', {
        requirements: report.requirements.total,
        candidates: report.supplier_candidates.total,
        rfqs: report.rfqs.total,
        supplier_responses: report.supplier_responses.total,
        supplier_quotes: report.supplier_quotes.total,
        customer_quotes: report.customer_quotes.total,
      }, 'reporting_agent');

      return { execution: running, outcome: 'completed', report };
    }

    if (stage === 'customer_response') {
      const { data: quotes, error } = await supabase
        .from('customer_quotes')
        .select('id,inquiry_id,status,reference,decision_reason,decision_text,revision_number')
        .eq('inquiry_id', inquiryId)
        .in('status', ['rejected','revision_requested']);

      if (error) throw new ToolError('TRANSIENT', error.message);

      if (!quotes?.length) {
        await markExecutionSuccess(running.id, { processed_count: 0 });
        return { execution: running, outcome: 'no_customer_response' };
      }

      await createAlert(
        inquiryId,
        'customer_response',
        'CUSTOMER_RESPONSE_REVIEW_REQUIRED',
        `${quotes.length} customer quote response(s) require Admin review before a revision is created.`,
        'normal',
      );

      await timeline(inquiryId, 'customer_quote_response_detected', {
        quote_ids: quotes.map((quote) => quote.id),
        count: quotes.length,
      }, 'customer_response_agent');

      await markExecutionSuccess(running.id, {
        processed_count: quotes.length,
        action: 'admin_review_required',
      });

      return { execution: running, outcome: 'admin_review_required' };
    }

    if (stage === 'customer_quote') {
      const { data: inquiry, error: inquiryError } = await supabase
        .from('inquiries')
        .select('id,customer_id,reference,title,description')
        .eq('id', inquiryId)
        .single();

      if (inquiryError || !inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');

      const { data: existing } = await supabase
        .from('customer_quotes')
        .select('id,status,revision_number')
        .eq('inquiry_id', inquiryId)
        .in('status', ['draft','pending_approval','sent'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        await markExecutionSuccess(running.id, {
          customer_quote_id: existing.id,
          status: existing.status,
          reused_existing_quote: true,
        });
        return { execution: running, outcome: 'existing_quote' };
      }

      const { data: comparisons } = await supabase
        .from('ai_executions')
        .select('output_ref,status')
        .eq('inquiry_id', inquiryId)
        .eq('task_key', `inquiry:${inquiryId}:stage:comparison`)
        .eq('status', 'succeeded')
        .maybeSingle();

      const { data: customer } = await supabase
        .from('customers')
        .select('id,default_currency')
        .eq('id', inquiry.customer_id)
        .single();

      if (!customer) throw new ToolError('NOT_FOUND', 'Customer not found');

      const currency = customer.default_currency ?? 'EUR';
      const reference = `DRAFT-${inquiry.reference ?? inquiryId}-${crypto.randomUUID().slice(0, 8)}`;

      const { data: quote, error: quoteError } = await supabase
        .from('customer_quotes')
        .insert({
          inquiry_id: inquiryId,
          customer_id: inquiry.customer_id,
          reference,
          revision_number: 0,
          status: 'draft',
          currency,
          subject: `Quotation — ${inquiry.reference ?? inquiryId}`,
          body: [
            `Dear Customer,`,
            '',
            `Please find our quotation regarding inquiry ${inquiry.reference ?? inquiryId}.`,
            '',
            'Final customer pricing and commercial terms require Admin review and approval.',
            '',
            'Regards,',
            'Purchase Department',
          ].join('\n'),
        })
        .select('*')
        .single();

      if (quoteError || !quote) throw new ToolError('CONFLICT', quoteError?.message ?? 'Customer quote creation failed');

      await markExecutionSuccess(running.id, {
        customer_quote_id: quote.id,
        comparison_execution: comparisons?.output_ref ?? null,
        customer_price_policy: 'ADMIN_ONLY',
      });

      await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_QUOTE_REVIEW_REQUIRED', 'Customer quote draft created. Admin must set final customer prices and approve before sending.', 'normal');

      await timeline(inquiryId, 'customer_quote_draft_created', {
        customer_quote_id: quote.id,
        currency,
        customer_price_policy: 'ADMIN_ONLY',
      }, 'customer_quote_agent');

      return { execution: running, outcome: 'draft_created' };
    }

    if (stage === 'comparison') {
      const { data: requirements, error: reqError } = await supabase
        .from('requirements')
        .select('id,type,value,status')
        .eq('inquiry_id', inquiryId)
        .eq('status', 'confirmed');

      if (reqError) throw new ToolError('TRANSIENT', reqError.message);

      const { data: responses, error: responseError } = await supabase
        .from('supplier_responses')
        .select('id,supplier_id,inquiry_id,status,raw_extraction,created_at')
        .eq('inquiry_id', inquiryId)
        .in('status', ['received','processed']);

      if (responseError) throw new ToolError('TRANSIENT', responseError.message);

      const responseIds = (responses ?? []).map((r) => r.id);
      const { data: quotes, error: quoteError } = responseIds.length
        ? await supabase
            .from('supplier_quotes')
            .select('id,supplier_response_id,product_id,match_status,currency,quantity,moq,net_price,valid_until,availability,lead_time_text,payment_terms,incoterm,delivery_method,original_data')
            .in('supplier_response_id', responseIds)
        : { data: [], error: null };

      if (quoteError) throw new ToolError('TRANSIENT', quoteError.message);

      const comparisons = (responses ?? []).map((response) => {
        const supplierQuotes = (quotes ?? []).filter((quote) => quote.supplier_response_id === response.id);
        const requirementResults = (requirements ?? []).map((requirement) => {
          const related = supplierQuotes.filter((quote) => quote.product_id === requirement.id);
          const explicit = related.length > 0;
          return {
            requirement_id: requirement.id,
            requirement_type: requirement.type,
            requirement_value: requirement.value,
            quote_count: related.length,
            status: explicit ? 'matched_evidence_available' : 'no_direct_quote_link',
          };
        });

        return {
          supplier_id: response.supplier_id,
          supplier_response_id: response.id,
          requirements: requirementResults,
          quotes: supplierQuotes.map((quote) => ({
            quote_id: quote.id,
            match_status: quote.match_status,
            currency: quote.currency,
            quantity: quote.quantity,
            moq: quote.moq,
            net_price: quote.net_price,
            valid_until: quote.valid_until,
            availability: quote.availability,
            lead_time_text: quote.lead_time_text,
            payment_terms: quote.payment_terms,
            incoterm: quote.incoterm,
            delivery_method: quote.delivery_method,
          })),
        };
      });

      await markExecutionSuccess(running.id, {
        comparison_count: comparisons.length,
        comparisons,
        policy: 'factual_comparison_only_no_supplier_ranking',
      });

      await timeline(inquiryId, 'supplier_quote_comparison_completed', {
        supplier_response_count: responses?.length ?? 0,
        quote_count: quotes?.length ?? 0,
      }, 'comparison_agent');

      return { execution: running, outcome: 'completed' };
    }

    if (stage === 'quote_extraction') {
      const { data: communications, error } = await supabase
        .from('communications')
        .select('id,inquiry_id,supplier_id,rfq_id,subject,body,metadata')
        .eq('inquiry_id', inquiryId)
        .eq('direction', 'incoming')
        .not('rfq_id', 'is', null)
        .order('created_at', { ascending: true });

      if (error) throw new ToolError('TRANSIENT', error.message);

      let extracted = 0;
      let skipped = 0;

      for (const communication of communications ?? []) {
        const { data: existing } = await supabase
          .from('supplier_responses')
          .select('id')
          .eq('communication_id', communication.id)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        if (!communication.supplier_id || !communication.rfq_id) {
          skipped++;
          continue;
        }

        const body = communication.body ?? '';
        const metadata = (communication.metadata ?? {}) as Record<string, unknown>;

        const { data: response, error: responseError } = await supabase
          .from('supplier_responses')
          .insert({
            communication_id: communication.id,
            supplier_id: communication.supplier_id,
            inquiry_id: inquiryId,
            status: 'processing',
            raw_extraction: {
              source: 'supplier_email',
              subject: communication.subject,
              body,
              metadata,
              extraction_policy: 'explicit_values_only',
            },
          })
          .select('id')
          .single();

        if (responseError || !response) throw new ToolError('CONFLICT', responseError?.message ?? 'Supplier response creation failed');

        // The workflow stores the raw response first. Actual semantic extraction is performed by the Quote Extraction agent/model.
        // No price/currency/quantity/lead-time value is inferred from free text at this stage.
        await supabase
          .from('supplier_responses')
          .update({ status: 'received' })
          .eq('id', response.id);

        extracted++;
        await timeline(inquiryId, 'supplier_response_ready_for_extraction', {
          communication_id: communication.id,
          supplier_response_id: response.id,
          rfq_id: communication.rfq_id,
        }, 'quote_extraction_agent');
      }

      await markExecutionSuccess(running.id, {
        response_count: extracted,
        skipped_count: skipped,
        status: 'ready_for_extraction',
      });

      if (extracted > 0) {
        await createAlert(inquiryId, 'quote_extraction', 'QUOTE_EXTRACTION_REQUIRED', `${extracted} supplier response(s) are ready for structured quote extraction.`, 'normal');
      }

      if (extracted === 0) {
        await markExecutionSuccess(running.id, { response_count: 0, skipped_count: skipped, status: 'completed' });
      }



      return { execution: running, outcome: extracted > 0 ? 'ready_for_extraction' : 'completed' };
    }

    if (stage === 'email_response') {
      const { data: incoming, error } = await supabase
        .from('communications')
        .select('id,inquiry_id,supplier_id,rfq_id,subject,body,thread_id,provider_message_id')
        .eq('inquiry_id', inquiryId)
        .eq('direction', 'incoming')
        .order('created_at', { ascending: true });

      if (error) throw new ToolError('TRANSIENT', error.message);

      let matched = 0;
      let unmatched = 0;

      for (const email of incoming ?? []) {
        if (email.rfq_id) {
          matched++;
          continue;
        }

        if (!email.supplier_id) {
          unmatched++;
          await supabase.from('unmatched_emails').upsert({
            communication_id: email.id,
            reason: 'Incoming email has no reliable supplier identity or RFQ reference',
          }, { onConflict: 'communication_id' });
          continue;
        }

        const { data: rfqs } = await supabase
          .from('rfqs')
          .select('id,inquiry_id,supplier_id,subject')
          .eq('inquiry_id', inquiryId)
          .eq('supplier_id', email.supplier_id);

        const normalizedSubject = (email.subject ?? '').trim().toLowerCase();
        const matches = (rfqs ?? []).filter((rfq) =>
          rfq.subject?.trim().toLowerCase() === normalizedSubject
        );

        if (matches.length === 1) {
          await supabase.from('communications').update({
            rfq_id: matches[0].id,
            supplier_id: matches[0].supplier_id,
            inquiry_id: matches[0].inquiry_id,
          }).eq('id', email.id);
          matched++;
        } else {
          unmatched++;
          await supabase.from('unmatched_emails').upsert({
            communication_id: email.id,
            reason: matches.length > 1
              ? 'Multiple RFQs match supplier and subject'
              : 'No unique RFQ match for supplier and subject',
          }, { onConflict: 'communication_id' });
          await createAlert(inquiryId, 'email_response', 'UNMATCHED_SUPPLIER_EMAIL', 'A supplier email could not be uniquely matched to an RFQ.', 'normal');
        }
      }

      await markExecutionSuccess(running.id, {
        matched_count: matched,
        unmatched_count: unmatched,
      });

      await timeline(inquiryId, 'email_response_matching_completed', {
        matched_count: matched,
        unmatched_count: unmatched,
      }, 'email_response_agent');

      return { execution: running, outcome: unmatched > 0 ? 'partial' : 'completed' };
    }

    if (stage === 'rfq') {
      const { data: candidates, error: candidateError } = await supabase
        .from('supplier_candidates')
        .select('id,supplier_id,proposed_name,status')
        .eq('inquiry_id', inquiryId)
        .eq('status', 'finalized');

      if (candidateError) throw new ToolError('TRANSIENT', candidateError.message);

      const supplierIds = (candidates ?? [])
        .map((c) => c.supplier_id)
        .filter((id): id is string => Boolean(id));

      if (!supplierIds.length) {
        await markExecutionSuccess(running.id, { blocked: true, reason: 'no_verified_suppliers' });
        await createAlert(inquiryId, 'rfq', 'NO_VERIFIED_SUPPLIERS', 'RFQ cannot be created until at least one supplier is verified.', 'normal');
        return { execution: running, outcome: 'blocked' as const };
      }

      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('id,legal_name,verification_status')
        .in('id', supplierIds);

      const verifiedSuppliers = (suppliers ?? []).filter((s) => s.verification_status === 'verified');

      if (!verifiedSuppliers.length) {
        await markExecutionSuccess(running.id, { blocked: true, reason: 'suppliers_not_verified' });
        await createAlert(inquiryId, 'rfq', 'SUPPLIERS_NOT_VERIFIED', 'RFQ is waiting for supplier verification.', 'normal');
        return { execution: running, outcome: 'blocked' as const };
      }

      const { data: requirements, error: reqError } = await supabase
        .from('requirements')
        .select('id,type,value,status')
        .eq('inquiry_id', inquiryId)
        .eq('status', 'confirmed');

      if (reqError) throw new ToolError('TRANSIENT', reqError.message);

      const { data: inquiry } = await supabase
        .from('inquiries')
        .select('title,description,reference')
        .eq('id', inquiryId)
        .single();

      let created = 0;
      for (const supplier of verifiedSuppliers) {
        const { data: email } = await supabase
          .from('supplier_emails')
          .select('email')
          .eq('supplier_id', supplier.id)
          .eq('status', 'active')
          .eq('is_primary', true)
          .maybeSingle();

        if (!email?.email) {
          await createAlert(inquiryId, 'rfq', 'SUPPLIER_CONTACT_REQUIRED', `No primary active email is available for ${supplier.legal_name}.`, 'normal');
          continue;
        }

        const subject = `RFQ — ${inquiry?.reference ?? inquiryId}`;
        const body = [
          `Dear ${supplier.legal_name} team,`,
          '',
          'We would like to request your quotation for the following requirements:',
          '',
          ...(requirements ?? []).map((r) => `- ${r.type}: ${r.value}`),
          '',
          'Please provide your unit prices, currency, availability/lead time, MOQ, quotation validity, payment terms, and delivery terms.',
          '',
          'Regards,',
          'Purchase Department',
        ].join('\n');

        const { data: rfq, error: rfqError } = await supabase
          .from('rfqs')
          .insert({
            inquiry_id: inquiryId,
            supplier_id: supplier.id,
            status: 'pending_approval',
            subject,
            body,
            recipient_email: email.email,
            sender_email: process.env.PURCHASE_DEP_EMAIL ?? 'purchase-dep@aryaautomation.com',
            approval_required: true,
          })
          .select('id')
          .single();

        if (rfqError) throw new ToolError('CONFLICT', rfqError.message);

        for (const requirement of requirements ?? []) {
          await supabase.from('rfq_items').insert({
            rfq_id: rfq.id,
            requirement_id: requirement.id,
            requested_data: { type: requirement.type, value: requirement.value },
          });
        }

        created++;
        await timeline(inquiryId, 'rfq_draft_created', {
          rfq_id: rfq.id,
          supplier_id: supplier.id,
          recipient_email: email.email,
        }, 'rfq_agent');
      }

      await markExecutionSuccess(running.id, {
        created_count: created,
        status: 'pending_approval',
      });

      if (created > 0) {
        await createAlert(inquiryId, 'rfq', 'RFQ_APPROVAL_REQUIRED', `${created} RFQ draft(s) are ready for Admin approval.`, 'normal');
      }

      return { execution: running, outcome: created > 0 ? 'rfq_pending_approval' : 'blocked' };
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
  return runStage(inquiryId, 'document');
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

      const { data: rfqExecution } = await supabase
        .from('ai_executions')
        .select('status')
        .eq('inquiry_id', inquiryId)
        .eq('task_key', `inquiry:${inquiryId}:stage:rfq`)
        .maybeSingle();

      const { data: comparisonExecution } = await supabase
        .from('ai_executions')
        .select('status')
        .eq('inquiry_id', inquiryId)
        .eq('task_key', `inquiry:${inquiryId}:stage:comparison`)
        .maybeSingle();

      const { data: customerResponse } = await supabase
        .from('customer_quotes')
        .select('id,status')
        .eq('inquiry_id', inquiryId)
        .in('status', ['rejected','revision_requested'])
        .limit(1)
        .maybeSingle();

      if (customerResponse) {
        return runStage(inquiryId, 'customer_response');
      }

      const { data: customerQuoteExecution } = await supabase
        .from('ai_executions')
        .select('status')
        .eq('inquiry_id', inquiryId)
        .eq('task_key', `inquiry:${inquiryId}:stage:customer_quote`)
        .maybeSingle();

      if (customerQuoteExecution?.status === 'succeeded') {
        return runStage(inquiryId, 'reporting');
      }

      if (comparisonExecution?.status === 'succeeded') {
        return runStage(inquiryId, 'customer_quote');
      }

      const { data: extractionExecution } = await supabase
        .from('ai_executions')
        .select('status')
        .eq('inquiry_id', inquiryId)
        .eq('task_key', `inquiry:${inquiryId}:stage:quote_extraction`)
        .maybeSingle();

      if (extractionExecution?.status === 'succeeded') {
        return runStage(inquiryId, 'comparison');
      }

      if (rfqExecution?.status === 'succeeded') {
        const { data: matchedEmails } = await supabase
          .from('communications')
          .select('id')
          .eq('inquiry_id', inquiryId)
          .eq('direction', 'incoming')
          .not('rfq_id', 'is', null)
          .limit(1);

        if ((matchedEmails ?? []).length) return runStage(inquiryId, 'quote_extraction');
      }

      if (discovery?.status === 'succeeded') {
        const { data: finalized } = await supabase
          .from('supplier_candidates')
          .select('id,supplier_id')
          .eq('inquiry_id', inquiryId)
          .eq('status', 'finalized');

        if ((finalized ?? []).some((candidate) => candidate.supplier_id)) {
          const { data: verification } = await supabase
            .from('ai_executions')
            .select('status')
            .eq('inquiry_id', inquiryId)
            .eq('task_key', `inquiry:${inquiryId}:stage:verification`)
            .maybeSingle();

          if (verification?.status === 'succeeded') {
            const { data: rfqExecution } = await supabase
              .from('ai_executions')
              .select('status')
              .eq('inquiry_id', inquiryId)
              .eq('task_key', `inquiry:${inquiryId}:stage:rfq`)
              .maybeSingle();

            if (rfqExecution?.status !== 'succeeded') return runStage(inquiryId, 'rfq');
            throw new ToolError('APPROVAL_REQUIRED', 'RFQ drafts require Admin approval before sending');
          }

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
