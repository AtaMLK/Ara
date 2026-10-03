import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import { getResearchProvider } from './research/provider';
import { runAgent } from './agent-runner';
import { documentOutputSchema, intakeOutputSchema, clarificationOutputSchema, quoteExtractionOutputSchema, comparisonOutputSchema, customerQuoteOutputSchema } from './agent-schemas';
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
  source?: 'customer_text' | 'pdf' | 'excel' | 'image' | 'clarification';
  source_ref?: string | null;
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
  const { data: current, error: readError } = await supabase
    .from('inquiries')
    .select('status')
    .eq('id', inquiryId)
    .single();
  if (readError || !current) throw new ToolError('NOT_FOUND', 'Inquiry not found');

  if (current.status === status) return;

  const { error } = await supabase
    .from('inquiries')
    .update({ status })
    .eq('id', inquiryId);
  if (error) throw new ToolError('TRANSIENT', error.message);

  await supabase.from('timeline_events').insert({
    inquiry_id: inquiryId,
    event_type: 'customer_status_changed',
    visibility: 'customer',
    actor_type: 'system',
    metadata: { status },
  });
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

    // Supplier replies can arrive after the original quote-extraction stage
    // succeeded. Reopen the stage when there are new supplier responses.
    if ((stage === 'quote_extraction' || stage === 'comparison') && !output?.blocked) {
      let needsRerun = false;

      if (stage === 'quote_extraction') {
        const { data: pendingResponses } = await createSupabaseAdminClient()
          .from('supplier_responses')
          .select('id')
          .eq('inquiry_id', inquiryId)
          .in('status', ['received', 'processing'])
          .limit(1);
        needsRerun = (pendingResponses ?? []).length > 0;
      } else {
        const { data: processedResponses } = await createSupabaseAdminClient()
          .from('supplier_responses')
          .select('id')
          .eq('inquiry_id', inquiryId)
          .eq('status', 'processed');
        const responseIds = (processedResponses ?? []).map((item) => item.id);
        if (responseIds.length > 0) {
          const { data: findings } = await createSupabaseAdminClient()
            .from('supplier_comparison_findings')
            .select('supplier_response_id')
            .eq('inquiry_id', inquiryId);
          const comparedIds = new Set((findings ?? []).map((item) => item.supplier_response_id));
          needsRerun = responseIds.some((id) => !comparedIds.has(id));
        }
      }

      if (needsRerun) {
        const reopened = await createSupabaseAdminClient()
          .from('ai_executions')
          .update({ status: 'queued', error_code: null, error_message: null, completed_at: null })
          .eq('id', execution.id)
          .eq('status', 'succeeded')
          .select('*')
          .single();

        if (reopened.error || !reopened.data) {
          throw new ToolError('CONFLICT', stage + ' execution cannot be reopened');
        }
        execution.status = 'queued';
      } else {
        return { execution, outcome: 'already_succeeded' as const };
      }
    } else if (!output?.blocked) {
      return { execution, outcome: 'already_succeeded' as const };
    }

    if (output?.blocked) {
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
            if (process.env.OPENAI_API_KEY) {
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
              extraction.qualityFlags = [...parsed.qualityFlags, 'AI_EXTRACTION_PENDING'];
            }
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
          const errorCode = error instanceof ToolError ? error.code : 'AI_PROCESSING';
          console.error('[ARAT][document-processing] failed', {
            inquiryId,
            fileId: file.id,
            fileName: file.original_name,
            mimeType: file.mime_type,
            errorCode,
            message,
            error,
          });
          await supabase.from('document_processing').update({
            status: 'processing_failed',
            error_code: errorCode,
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

      const aiReady = Boolean(process.env.OPENAI_API_KEY);

      await markExecutionSuccess(running.id, {
        processed,
        failed,
        ocr_pending: ocrPending,
        next_stage: aiReady ? 'intake' : null,
        blocked: !aiReady,
        reason: aiReady ? undefined : 'OPENAI_API_KEY_REQUIRED_FOR_AI_EXTRACTION',
      });

      if (!aiReady) {
        await supabase.from('ai_alerts').insert({
          inquiry_id: inquiryId,
          agent_id: 'document',
          alert_type: 'AI_PROVIDER_NOT_CONFIGURED',
          message: 'Document text extraction completed, but AI requirement extraction is waiting for OPENAI_API_KEY.',
          priority: 'normal',
        });
        await timeline(inquiryId, 'workflow_document_waiting_for_ai_provider', {
          processed,
          failed,
          ocr_pending: ocrPending,
        }, 'document');

        return { execution: running, outcome: 'ai_provider_required' as const };
      }

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
        .select('id,type,value,status,source,source_ref')
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
                'Document-derived requirements are already persisted separately. In this Intake pass, create only new requirements sourced from customer_text. Do not recreate or modify document-derived requirements.',
              ],
            },
            intakeOutputSchema,
          );
          const result = ai.output;

          // Intake is allowed to add only customer-text requirements. The model
          // can still echo document context despite the instruction, so do not
          // fail the whole workflow for a recoverable source-label mismatch.
          // Keep only explicitly customer_text items and discard any sourceRef
          // from that pass because document-derived requirements are persisted
          // by the Document stage.
          const customerTextRequirements = result.requirements
            .filter((item) => item.source === 'customer_text')
            .map((item) => ({
              ...item,
              source: 'customer_text' as const,
              sourceRef: undefined,
            }));

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
          const inserts = customerTextRequirements
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

      // Re-read after extraction so the existing clarification gate handles
      // newly extracted requirements in the same workflow execution.
      const { data: currentRequirements, error: currentError } = await supabase
        .from('requirements')
        .select('id,type,value,status')
        .eq('inquiry_id', inquiryId)
        .order('created_at', { ascending: true });
      if (currentError) throw new ToolError('TRANSIENT', currentError.message);
      const rows = (currentRequirements ?? []) as RequirementRow[];

      // Do not treat every open requirement as a clarification request.
      // The clarification agent is the decision gate: it evaluates the
      // complete requirement set and decides whether missing/conflicting
      // information is materially important enough to ask the customer about.
      const clarification = await enqueueWorkflow(inquiryId, 'clarification');
      await markExecutionSuccess(running.id, {
        next_stage: 'clarification',
        clarification_execution_id: clarification.id,
        requirement_count: rows.length,
      });
      await timeline(inquiryId, 'workflow_clarification_check_queued', {
        clarification_execution_id: clarification.id,
        requirement_count: rows.length,
      }, 'intake');

      return { execution: running, outcome: 'clarification_check_queued' as const };
    }

    if (stage === 'clarification') {
      const { data: requirements, error: requirementsError } = await supabase
        .from('requirements')
        .select('id,type,value,status,admin_edited,current_version,source,source_ref')
        .eq('inquiry_id', inquiryId)
        .in('status', ['open', 'clarification_required'])
        .order('created_at', { ascending: true });

      if (requirementsError) throw new ToolError('TRANSIENT', requirementsError.message);

      const activeRequirements = (requirements ?? []).filter((item) => !item.admin_edited);

      if (activeRequirements.length === 0) {
        await setInquiryStatus(inquiryId, 'researching');
        const research = await enqueueWorkflow(inquiryId, 'research');
        await markExecutionSuccess(running.id, { next_stage: 'research', research_execution_id: research.id });
        return { execution: running, outcome: 'research_queued' as const };
      }

      const { data: existing } = await supabase
        .from('clarifications')
        .select('id,requirement_id,question,status')
        .eq('inquiry_id', inquiryId)
        .in('status', ['draft', 'pending_approval', 'sent'])
        .order('created_at', { ascending: true });

      const existingRequirementIds = new Set(
        (existing ?? []).map((item) => item.requirement_id).filter(Boolean),
      );

      const unresolvedForAI = activeRequirements.filter(
        (item) => !existingRequirementIds.has(item.id),
      );

      // If clarification drafts already exist, keep the inquiry blocked and
      // wait for the customer/admin flow rather than asking the model again.
      if (unresolvedForAI.length === 0) {
        await setInquiryStatus(inquiryId, 'clarification_required');
        await markExecutionSuccess(running.id, {
          blocked: true,
          reason: 'pending_clarifications',
          pending_clarifications: existing?.length ?? 0,
        });
        return { execution: running, outcome: 'still_blocked' as const };
      }

      const { data: sourceContext, error: sourceContextError } = await supabase
        .from('inquiries')
        .select('original_customer_text')
        .eq('id', inquiryId)
        .single();

      if (sourceContextError || !sourceContext) {
        throw new ToolError('NOT_FOUND', 'Inquiry source context not found');
      }

      const { data: processedDocuments } = await supabase
        .from('document_processing')
        .select('file_id,extracted_text,source_map,quality_flags')
        .eq('status', 'processed')
        .in(
          'file_id',
          (await supabase.from('inquiry_files').select('id').eq('inquiry_id', inquiryId)).data?.map((file) => file.id) ?? [],
        );

      const evidenceContext = (processedDocuments ?? [])
        .filter((document) => document.extracted_text?.trim())
        .map((document) => ({
          file_id: document.file_id,
          source_map: document.source_map,
          quality_flags: document.quality_flags,
          extracted_text: document.extracted_text,
        }));

      const ai = await runAgent(
        { agentId: 'clarification', executionId: running.id, inquiryId },
        {
          original_customer_text: sourceContext.original_customer_text ?? '',
          document_evidence: evidenceContext,
          requirements: unresolvedForAI.map((item) => ({
            id: item.id,
            type: item.type,
            value: item.value,
            status: item.status,
            source: item.source,
            source_ref: item.source_ref,
            admin_edited: item.admin_edited,
            current_version: item.current_version,
          })),
          instructions: [
            'Evaluate the complete customer requirement set before deciding whether clarification is necessary.',
            'A requirement being open does NOT by itself mean clarification is required.',
            'Preserve the complete customer product phrase. Never drop a meaningful word because it looks like a keyword.',
            'Obvious typos, spacing errors, grammar errors, capitalization differences, and common abbreviations do not require clarification when the intended meaning is clear with high confidence.',
            'Example: "tempereture sensor" can be treated as "temperature sensor" when the intended product is clear; do not ask the customer to confirm the typo.',
            'Use all available evidence already represented in the requirements, including evidence extracted from PDFs, spreadsheets, and images.',
            'Ask clarification only when missing, conflicting, or materially ambiguous information could change the requested product, model, part number, quantity, specification, delivery, price, currency, terms, or supplier identity.',
            'Do not invent missing quantities or specifications. If a required quantity is genuinely absent, ask for it.',
            'If multiple reasonable interpretations remain, ask the minimum targeted question that resolves the ambiguity.',
            'If the request is sufficiently understandable for product research and supplier discovery, return needsClarification=false and no questions.',
            'Do not create or send customer communication.',
          ],
        },
        clarificationOutputSchema,
      );

      const questionIds = new Set<string>();
      for (const question of ai.output.questions) {
        if (!question.requirementId) continue;
        const requirement = unresolvedForAI.find((item) => item.id === question.requirementId);
        if (!requirement || existingRequirementIds.has(requirement.id)) continue;
        if (questionIds.has(requirement.id)) continue;
        questionIds.add(requirement.id);

        const { error: insertError } = await supabase.from('clarifications').insert({
          inquiry_id: inquiryId,
          requirement_id: requirement.id,
          question: question.question,
          status: 'draft',
        });
        if (insertError) throw new ToolError('CONFLICT', insertError.message);
      }

      if (ai.output.needsClarification && questionIds.size === 0) {
        throw new ToolError('AI_PROCESSING', 'Clarification agent reported material ambiguity but returned no targeted question.');
      }

      if (ai.output.needsClarification) {
        // Only requirements actually referenced by clarification questions remain
        // unresolved. Everything else has been judged sufficiently clear.
        const nonQuestionIds = unresolvedForAI
          .filter((item) => !questionIds.has(item.id))
          .map((item) => item.id);

        if (nonQuestionIds.length > 0) {
          const { error: confirmError } = await supabase
            .from('requirements')
            .update({ status: 'confirmed' })
            .in('id', nonQuestionIds)
            .eq('inquiry_id', inquiryId)
            .eq('admin_edited', false)
            .eq('status', 'open');

          if (confirmError) throw new ToolError('CONFLICT', confirmError.message);
        }

        if (questionIds.size > 0) {
          const { error: flagError } = await supabase
            .from('requirements')
            .update({ status: 'clarification_required' })
            .in('id', [...questionIds])
            .eq('inquiry_id', inquiryId)
            .eq('admin_edited', false);

          if (flagError) throw new ToolError('CONFLICT', flagError.message);
        }

        await setInquiryStatus(inquiryId, 'clarification_required');
        await timeline(inquiryId, 'clarification_ai_drafts_created', {
          execution_id: running.id,
          question_count: questionIds.size,
          provider: ai.provider,
          model: ai.model,
        }, 'clarification');

        const { data: drafts } = await supabase
          .from('clarifications')
          .select('id,status')
          .eq('inquiry_id', inquiryId)
          .in('status', ['draft', 'pending_approval', 'sent']);

        await markExecutionSuccess(running.id, {
          blocked: true,
          reason: 'material_ambiguity_requires_customer_clarification',
          pending_clarifications: drafts?.length ?? 0,
        });

        return { execution: running, outcome: 'still_blocked' as const };
      }

      // The request is sufficiently understood. Confirm requirements that
      // were only open because they had not yet passed this semantic gate.
      const { error: confirmError } = await supabase
        .from('requirements')
        .update({ status: 'confirmed' })
        .in('id', unresolvedForAI.map((item) => item.id))
        .eq('inquiry_id', inquiryId)
        .eq('admin_edited', false)
        .in('status', ['open', 'clarification_required']);

      if (confirmError) throw new ToolError('CONFLICT', confirmError.message);

      await setInquiryStatus(inquiryId, 'researching');
      const research = await enqueueWorkflow(inquiryId, 'research');
      await timeline(inquiryId, 'workflow_research_started', {
        execution_id: running.id,
        clarification_required: false,
      }, 'clarification');
      await markExecutionSuccess(running.id, {
        next_stage: 'research',
        research_execution_id: research.id,
        clarification_required: false,
      });
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
        .from('inquiries').select('id,customer_id,reference,title,description').eq('id', inquiryId).single();
      if (inquiryError || !inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');

      const { data: customer } = await supabase.from('customers').select('id,default_currency,name,company_name').eq('id', inquiry.customer_id).single();
      if (!customer) throw new ToolError('NOT_FOUND', 'Customer not found');
      const customerCurrency = customer.default_currency ?? 'EUR';

      const { data: existing } = await supabase.from('customer_quotes').select('id,status,revision_number').eq('inquiry_id', inquiryId).in('status', ['draft','pending_approval','sent']).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (existing) {
        await markExecutionSuccess(running.id, { customer_quote_id: existing.id, status: existing.status, reused_existing_quote: true });
        return { execution: running, outcome: 'existing_quote' };
      }

      const { data: requirements, error: requirementsError } = await supabase.from('requirements').select('id,type,value,status,source,admin_edited').eq('inquiry_id', inquiryId).eq('status', 'confirmed').order('created_at', { ascending: true });
      if (requirementsError) throw new ToolError('TRANSIENT', requirementsError.message);
      const { data: findings } = await supabase.from('supplier_comparison_findings').select('id,supplier_response_id,supplier_quote_id,requirement_id,status,evidence').eq('inquiry_id', inquiryId).order('created_at', { ascending: true });
      const quoteIds = [...new Set((findings ?? []).map((item) => item.supplier_quote_id).filter((id): id is string => Boolean(id)))];
      if (!quoteIds.length) {
        await markExecutionSuccess(running.id, { blocked: true, reason: 'no_comparable_supplier_quotes' });
        await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_QUOTE_NO_COMPARABLE_QUOTES', 'No comparable supplier quote is available.', 'normal');
        return { execution: running, outcome: 'blocked' };
      }

      const { data: supplierQuotes, error: quotesError } = await supabase.from('supplier_quotes').select('id,supplier_response_id,product_id,match_status,currency,quantity,moq,net_price,valid_until,availability,lead_time_text,payment_terms,incoterm,delivery_method,additional_conditions').in('id', quoteIds);
      if (quotesError) throw new ToolError('TRANSIENT', quotesError.message);

      const { data: priceTiers, error: priceTiersError } = await supabase
        .from('supplier_quote_price_tiers')
        .select('id,supplier_quote_id,min_quantity,max_quantity,unit_price,currency,condition_text')
        .in('supplier_quote_id', quoteIds)
        .order('min_quantity', { ascending: true, nullsFirst: true });
      if (priceTiersError) throw new ToolError('TRANSIENT', priceTiersError.message);

      const { data: pricingRule } = await supabase.from('customer_pricing_rules').select('id,name,markup_percent,rounding_increment,status').eq('status', 'approved').maybeSingle();
      if (!pricingRule) {
        await markExecutionSuccess(running.id, { blocked: true, reason: 'approved_pricing_rule_required' });
        await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_PRICING_RULE_REQUIRED', 'Customer quote is waiting for an Admin-approved pricing rule.', 'normal');
        return { execution: running, outcome: 'blocked' };
      }

      const ai = await runAgent(
        { agentId: 'customer_quote', executionId: running.id, inquiryId, customerId: inquiry.customer_id },
        { customer: { id: customer.id, currency: customerCurrency, name: customer.name, company_name: customer.company_name }, requirements: requirements ?? [], comparison_findings: findings ?? [], supplier_quotes: supplierQuotes ?? [], instructions: [
          'Return every supplier quote that can be factually associated with at least one confirmed requirement and is not an explicit mismatch.',
          'Do not rank, score, or choose a supplier. If multiple supplier quotes can satisfy a requirement, include all of them as separate line proposals.',
          'Use supplier quote quantity only when explicitly present; otherwise use an explicitly confirmed requirement quantity when available.',
          'Never produce unitPrice, customerPrice, margin, markup, exchange rate, or currency conversion.',
          'Do not invent product identity or technical data.',
          'If quantity or product identity is unresolved, omit that quote and explain the warning.',
        ] },
        customerQuoteOutputSchema,
      );

      if (!ai.output.lines.length) {
        await markExecutionSuccess(running.id, { blocked: true, reason: 'no_quote_lines_proposed', warnings: ai.output.warnings });
        await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_QUOTE_NO_LINES', 'No customer quote lines could be prepared: ' + ai.output.warnings.join(' '), 'normal');
        return { execution: running, outcome: 'blocked' };
      }

      const reference = 'DRAFT-' + (inquiry.reference ?? inquiryId) + '-' + crypto.randomUUID().slice(0, 8);
      const validUntilValues = ai.output.lines.map((line) => supplierQuotes?.find((quote) => quote.id === line.supplierQuoteId)?.valid_until).filter((value): value is string => Boolean(value)).sort();
      const { data: quote, error: quoteError } = await supabase.from('customer_quotes').insert({ inquiry_id: inquiryId, customer_id: inquiry.customer_id, reference, revision_number: 0, status: 'draft', currency: customerCurrency, valid_until: validUntilValues[0] ?? null, subject: 'Quotation — ' + (inquiry.reference ?? inquiryId), body: 'Dear ' + (customer.name || 'Customer') + ',\n\nPlease find our quotation regarding inquiry ' + (inquiry.reference ?? inquiryId) + '.\n\nThis quotation is a draft and requires Admin price confirmation and approval before it can be sent.\n\nRegards,\nPurchase Department' }).select('id').single();
      if (quoteError || !quote) throw new ToolError('CONFLICT', quoteError?.message ?? 'Customer quote creation failed');

      let createdItems = 0;
      let blockedItems = 0;
      const today = new Date().toISOString().slice(0, 10);
      for (const line of ai.output.lines) {
        const supplierQuote = supplierQuotes?.find((item) => item.id === line.supplierQuoteId);
        if (!supplierQuote || supplierQuote.match_status === 'mismatch') {
          blockedItems++;
          await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_QUOTE_LINE_BLOCKED', 'Supplier quote ' + line.supplierQuoteId + ' is missing or explicitly mismatched.', 'normal');
          continue;
        }

        const tiers = (priceTiers ?? []).filter((tier) => tier.supplier_quote_id === supplierQuote.id);
        const applicableTiers = tiers.filter((tier) =>
          (tier.min_quantity == null || line.quantity >= Number(tier.min_quantity)) &&
          (tier.max_quantity == null || line.quantity <= Number(tier.max_quantity))
        );

        if (applicableTiers.length > 1) {
          blockedItems++;
          await createAlert(
            inquiryId,
            'customer_quote',
            'CUSTOMER_QUOTE_MULTIPLE_APPLICABLE_PRICE_TIERS',
            'Multiple supplier price tiers apply to quantity ' + line.quantity + ' for quote ' + supplierQuote.id + '. Admin review is required; no tier was selected automatically.',
            'normal',
          );
          continue;
        }

        if (tiers.length > 0 && applicableTiers.length === 0) {
          blockedItems++;
          await createAlert(
            inquiryId,
            'customer_quote',
            'CUSTOMER_QUOTE_NO_APPLICABLE_PRICE_TIER',
            'No supplier price tier applies to quantity ' + line.quantity + ' for quote ' + supplierQuote.id + '.',
            'normal',
          );
          continue;
        }

        const selectedTier = applicableTiers[0] ?? null;
        const supplierCost = selectedTier ? Number(selectedTier.unit_price) : supplierQuote.net_price;
        const supplierCurrency = selectedTier?.currency ?? supplierQuote.currency;

        if (supplierCost == null || !supplierCurrency) {
          blockedItems++;
          await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_QUOTE_LINE_BLOCKED', 'Supplier quote ' + line.supplierQuoteId + ' lacks a usable explicit price/currency.', 'normal');
          continue;
        }

        let exchangeRateId: string | null = null;
        let exchangeRate = 1;
        if (supplierCurrency !== customerCurrency) {
          const { data: rate } = await supabase.from('exchange_rates').select('id,rate').eq('from_currency', supplierCurrency).eq('to_currency', customerCurrency).eq('status', 'approved').lte('valid_from', today).or('valid_until.is.null,valid_until.gte.' + today).order('valid_from', { ascending: false }).limit(1).maybeSingle();
          if (!rate) {
            blockedItems++;
            await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_QUOTE_EXCHANGE_RATE_REQUIRED', 'Approved exchange rate required: ' + supplierCurrency + ' → ' + customerCurrency + ' for supplier quote ' + supplierQuote.id + '.', 'normal');
            continue;
          }
          exchangeRateId = rate.id;
          exchangeRate = Number(rate.rate);
        }

        const rawPrice = supplierCost * exchangeRate * (1 + Number(pricingRule.markup_percent) / 100);
        const increment = pricingRule.rounding_increment ? Number(pricingRule.rounding_increment) : 0;
        const suggestedPrice = increment > 0 ? Math.ceil(rawPrice / increment) * increment : rawPrice;
        const { error: itemError } = await supabase.from('customer_quote_items').insert({
          customer_quote_id: quote.id,
          supplier_quote_id: supplierQuote.id,
          product_id: supplierQuote.product_id,
          quantity: line.quantity,
          unit_price: suggestedPrice,
          supplier_cost: supplierCost,
          supplier_currency: supplierCurrency,
          exchange_rate_id: exchangeRateId,
          price_status: 'suggested',
          pricing_rule_id: pricingRule.id,
          price_calculation: {
            source: selectedTier ? 'supplier_price_tier_and_approved_pricing_rule' : 'approved_pricing_rule',
            pricing_rule_id: pricingRule.id,
            markup_percent: pricingRule.markup_percent,
            rounding_increment: pricingRule.rounding_increment,
            exchange_rate_id: exchangeRateId,
            exchange_rate: exchangeRate,
            source_supplier_quote_id: supplierQuote.id,
            selected_price_tier_id: selectedTier?.id ?? null,
            selected_price_tier_condition: selectedTier?.condition_text ?? null,
            source_supplier_unit_price: supplierCost,
            source_supplier_currency: supplierCurrency,
            ai_provider: ai.provider,
            ai_model: ai.model,
          },
        });
        if (itemError) throw new ToolError('CONFLICT', itemError.message);
        createdItems++;
      }

      if (createdItems === 0) {
        await supabase.from('customer_quotes').delete().eq('id', quote.id).eq('status', 'draft');
        await markExecutionSuccess(running.id, { blocked: true, reason: 'all_quote_lines_blocked' });
        await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_QUOTE_BLOCKED', 'No customer quote line could be safely priced. Admin review is required.', 'normal');
        return { execution: running, outcome: 'blocked' };
      }
      await markExecutionSuccess(running.id, { customer_quote_id: quote.id, line_count: createdItems, blocked_line_count: blockedItems, pricing_rule_id: pricingRule.id, customer_currency: customerCurrency, customer_price_policy: 'SUGGESTED_BY_APPROVED_RULE_ADMIN_CONFIRMATION_REQUIRED', ai_provider: ai.provider, ai_model: ai.model });
      await createAlert(inquiryId, 'customer_quote', 'CUSTOMER_QUOTE_REVIEW_REQUIRED', 'Customer quote draft created with ' + createdItems + ' suggested line(s). Admin must confirm each customer price and approve before sending.', 'normal');
      await timeline(inquiryId, 'customer_quote_draft_created', { customer_quote_id: quote.id, line_count: createdItems, blocked_line_count: blockedItems, currency: customerCurrency, pricing_rule_id: pricingRule.id }, 'customer_quote');
      return { execution: running, outcome: 'draft_created' };
    }
    if (stage === 'quote_extraction') {
      const { data: responses, error: responseError } = await supabase
        .from('supplier_responses')
        .select('id,communication_id,supplier_id,inquiry_id,status,raw_extraction,attachments')
        .eq('inquiry_id', inquiryId)
        .in('status', ['received', 'processing'])
        .order('created_at', { ascending: true });

      if (responseError) throw new ToolError('TRANSIENT', responseError.message);

      const { data: requirements, error: requirementError } = await supabase
        .from('requirements')
        .select('id,type,value,status,source,source_ref,admin_edited')
        .eq('inquiry_id', inquiryId)
        .order('created_at', { ascending: true });

      if (requirementError) throw new ToolError('TRANSIENT', requirementError.message);

      let processed = 0;
      let skipped = 0;
      let alerts = 0;

      for (const response of responses ?? []) {
        const { data: communication } = await supabase
          .from('communications')
          .select('id,subject,body,metadata,rfq_id,supplier_id')
          .eq('id', response.communication_id)
          .maybeSingle();

        if (!communication || !response.supplier_id) {
          skipped++;
          continue;
        }

        const { data: existingQuotes } = await supabase
          .from('supplier_quotes')
          .select('id')
          .eq('supplier_response_id', response.id)
          .limit(1);

        if (existingQuotes && existingQuotes.length > 0) {
          await supabase.from('supplier_responses').update({ status: 'processed' }).eq('id', response.id);
          skipped++;
          continue;
        }

        const { data: supplierProducts, error: productsError } = await supabase
          .from('supplier_products')
          .select('id,product_name,model_part_number,description,status')
          .eq('supplier_id', response.supplier_id)
          .eq('status', 'active')
          .order('created_at', { ascending: true });

        if (productsError) throw new ToolError('TRANSIENT', productsError.message);

        const { data: rfqItems } = communication.rfq_id
          ? await supabase
              .from('rfq_items')
              .select('id,requirement_id,product_id,requested_quantity,requested_data')
              .eq('rfq_id', communication.rfq_id)
          : { data: [] };

        const raw = (response.raw_extraction ?? {}) as Record<string, unknown>;
        const body = typeof raw.body === 'string' ? raw.body : (communication.body ?? '');

        await supabase.from('supplier_responses').update({ status: 'processing' }).eq('id', response.id);

        const ai = await runAgent(
          { agentId: 'quote_extraction', executionId: running.id, inquiryId },
          {
            supplier_response_id: response.id,
            supplier_id: response.supplier_id,
            rfq_id: communication.rfq_id,
            subject: communication.subject,
            email_body: body,
            attachments: response.attachments ?? [],
            attachment_text: (Array.isArray(response.attachments) ? response.attachments : [])
              .map((attachment) => {
                const item = (attachment ?? {}) as Record<string, unknown>;
                return {
                  fileName: typeof item.fileName === 'string' ? item.fileName : 'attachment',
                  mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'application/octet-stream',
                  extractedText: typeof item.extractedText === 'string' ? item.extractedText : '',
                  qualityFlags: Array.isArray(item.qualityFlags) ? item.qualityFlags : [],
                  storagePath: typeof item.storagePath === 'string' ? item.storagePath : null,
                };
              })
              .filter((attachment) => attachment.extractedText.length > 0),
            inquiry_requirements: (requirements ?? []).map((item) => ({
              id: item.id,
              type: item.type,
              value: item.value,
              status: item.status,
              source: item.source,
              admin_edited: item.admin_edited,
            })),
            rfq_items: rfqItems ?? [],
            supplier_products: supplierProducts ?? [],
            instructions: [
              'Extract only values explicitly present in the supplier response or supplied attachment text.',
              'Do not infer currency from supplier country, symbol alone, prior quotes, or general knowledge.',
              'Do not calculate net/gross/list prices, discounts, VAT, or conversions unless the response explicitly states the resulting value. Exception: if list price and an explicitly stated percentage discount are present but net price is absent, return discountType=percent so the system can calculate the net price and flag it as AI Calculated. If the discount is a fixed amount, return discountType=amount and do not calculate the net price.',
              'Match each quoted product independently against the inquiry requirements, RFQ items, and supplied supplier product records.',
              'Use productId only when the supplied supplier product record is clearly the quoted product.',
              'If a product cannot be reliably matched, leave productId empty and use partial_match, mismatch, or unknown.',
              'Multiple prices for the same product must be represented as separate quotes or priceTiers exactly as stated; never choose one.',
              'Preserve the supplier wording in originalData and conditions where useful.',
              'Unknown, missing, conflicting, or ambiguous values must remain blank and be listed in uncertainties.',
              'Never create customer pricing, margin, or exchange-rate data.',
            ],
          },
          quoteExtractionOutputSchema,
        );

        if (ai.output.quotes.length === 0) {
          await supabase.from('supplier_responses').update({ status: 'processed' }).eq('id', response.id);
          await createAlert(
            inquiryId,
            'quote_extraction',
            'QUOTE_EXTRACTION_NO_QUOTE',
            `Supplier response ${response.id} contained no reliably extractable quotation line.`,
            'normal',
          );
          alerts++;
          processed++;
          continue;
        }

        for (const quote of ai.output.quotes) {
          if (quote.productId && !supplierProducts?.some((p) => p.id === quote.productId)) {
            throw new ToolError('AI_PROCESSING', 'Quote extraction returned a productId outside the supplier product set');
          }

          const calculatedNetPrice =
            quote.netPrice ??
            (quote.listPrice != null &&
            quote.discount != null &&
            quote.discountType === 'percent' &&
            quote.discount >= 0 &&
            quote.discount <= 100
              ? quote.listPrice * (1 - quote.discount / 100)
              : undefined);
          const aiCalculatedNetPrice = quote.netPrice == null && calculatedNetPrice != null;

          const { data: createdQuote, error: quoteError } = await supabase
            .from('supplier_quotes')
            .insert({
              supplier_response_id: response.id,
              product_id: quote.productId ?? null,
              match_status: quote.matchStatus,
              currency: quote.currency,
              quantity: quote.quantity,
              moq: quote.moq,
              list_price: quote.listPrice,
              discount: quote.discount,
              net_price: calculatedNetPrice,
              vat: quote.vat,
              gross_price: quote.grossPrice,
              validity_from: quote.validityFrom || null,
              valid_until: quote.validUntil || null,
              availability: quote.availability,
              lead_time_text: quote.leadTimeText,
              payment_terms: quote.paymentTerms,
              incoterm: quote.incoterm,
              delivery_method: quote.deliveryMethod,
              ai_calculated: aiCalculatedNetPrice,
              additional_conditions: quote.conditions,
              original_data: {
                ...quote.originalData,
                discount_type: quote.discountType ?? null,
                extraction: {
                  provider: ai.provider,
                  model: ai.model,
                  execution_id: running.id,
                  uncertainties: quote.uncertainties,
                },
              },
            })
            .select('id')
            .single();

          if (quoteError || !createdQuote) {
            throw new ToolError('CONFLICT', quoteError?.message ?? 'Supplier quote creation failed');
          }

          if (aiCalculatedNetPrice) {
            await createAlert(
              inquiryId,
              'quote_extraction',
              'QUOTE_NET_PRICE_AI_CALCULATED',
              `Supplier quote ${createdQuote.id}: net price was calculated from explicit list price and percentage discount.`,
              'normal',
            );
            alerts++;
          }

          if (quote.priceTiers.length > 0) {
            const { error: tierError } = await supabase
              .from('supplier_quote_price_tiers')
              .insert(quote.priceTiers.map((tier) => ({
                supplier_quote_id: createdQuote.id,
                min_quantity: tier.minQuantity,
                max_quantity: tier.maxQuantity,
                unit_price: tier.unitPrice,
                currency: tier.currency,
                condition_text: tier.conditionText,
              })));
            if (tierError) throw new ToolError('CONFLICT', tierError.message);
          }

          if (quote.conditions.length > 0) {
            const { error: conditionError } = await supabase
              .from('supplier_quote_conditions')
              .insert(quote.conditions.map((condition) => ({
                supplier_quote_id: createdQuote.id,
                condition_type: condition.type,
                condition_text: condition.text,
                deadline: condition.deadline || null,
                stackable: condition.stackable ?? null,
              })));
            if (conditionError) throw new ToolError('CONFLICT', conditionError.message);
          }

          if (quote.uncertainties.length > 0) {
            await createAlert(
              inquiryId,
              'quote_extraction',
              'QUOTE_EXTRACTION_UNCERTAINTY',
              `Supplier quote ${createdQuote.id} has unresolved extraction uncertainty: ${quote.uncertainties.join('; ')}`,
              'normal',
            );
            alerts++;
          }

          await timeline(inquiryId, 'supplier_quote_extracted', {
            supplier_response_id: response.id,
            supplier_quote_id: createdQuote.id,
            rfq_id: communication.rfq_id,
            match_status: quote.matchStatus,
            uncertainty_count: quote.uncertainties.length,
          }, 'quote_extraction');
        }

        await supabase
          .from('supplier_responses')
          .update({ status: 'processed', raw_extraction: { ...raw, semantic_extraction: ai.output } })
          .eq('id', response.id);

        processed++;
      }

      await markExecutionSuccess(running.id, {
        response_count: responses?.length ?? 0,
        processed_count: processed,
        skipped_count: skipped,
        alert_count: alerts,
        status: 'completed',
      });

      let comparisonExecutionId: string | null = null;
      if (processed > 0) {
        const comparison = await enqueueWorkflow(inquiryId, 'comparison');
        comparisonExecutionId = comparison.id;
      }

      await timeline(inquiryId, 'quote_extraction_completed', {
        processed_count: processed,
        skipped_count: skipped,
        alert_count: alerts,
        comparison_execution_id: comparisonExecutionId,
      }, 'quote_extraction');

      return { execution: running, outcome: processed > 0 ? 'comparison_queued' : 'completed' };
    }

    if (stage === 'comparison') {
      const { data: requirements, error: requirementsError } = await supabase
        .from('requirements')
        .select('id,type,value,status,source,admin_edited')
        .eq('inquiry_id', inquiryId)
        .eq('status', 'confirmed')
        .order('created_at', { ascending: true });

      if (requirementsError) throw new ToolError('TRANSIENT', requirementsError.message);

      const { data: responses, error: responsesError } = await supabase
        .from('supplier_responses')
        .select('id,supplier_id,inquiry_id,status,raw_extraction,attachments')
        .eq('inquiry_id', inquiryId)
        .eq('status', 'processed')
        .order('created_at', { ascending: true });

      if (responsesError) throw new ToolError('TRANSIENT', responsesError.message);

      let compared = 0;
      let findingCount = 0;
      let alertCount = 0;

      for (const response of responses ?? []) {
        const { data: quotes } = await supabase
          .from('supplier_quotes')
          .select('id,product_id,match_status,currency,quantity,moq,list_price,discount,net_price,vat,gross_price,validity_from,valid_until,availability,lead_time_text,payment_terms,incoterm,delivery_method,additional_conditions,original_data')
          .eq('supplier_response_id', response.id)
          .order('created_at', { ascending: true });

        if (!quotes?.length) continue;

        const { data: supplier } = await supabase
          .from('suppliers')
          .select('id,legal_name,primary_country,verification_status')
          .eq('id', response.supplier_id)
          .maybeSingle();

        const ai = await runAgent(
          { agentId: 'comparison', executionId: running.id, inquiryId },
          {
            supplier_response_id: response.id,
            supplier: supplier ?? { id: response.supplier_id },
            requirements: requirements ?? [],
            supplier_quotes: quotes,
            instructions: [
              'Compare only confirmed inquiry requirements against the supplied supplier quote data.',
              'Produce one factual finding per requirement for this supplier response when evidence exists; use unknown when the quote does not provide enough evidence.',
              'Use match when the supplier quote explicitly satisfies the requirement, partial_match when only part is supported, mismatch when the supplier data explicitly conflicts with it, and unknown when there is insufficient evidence.',
              'Evidence must quote or precisely summarize only data present in the supplied input. Do not invent technical specifications or commercial terms.',
              'Do not convert currencies, calculate margins, normalize prices, rank suppliers, score suppliers, or select a supplier.',
              'Do not change requirements, even if the supplier quote appears to contradict them.',
              'If multiple quotes or price tiers exist, report the factual differences rather than choosing one.',
            ],
          },
          comparisonOutputSchema,
        );

        const comparison = ai.output.comparisons.find((item) => item.supplierResponseId === response.id);
        if (!comparison) {
          await createAlert(
            inquiryId,
            'comparison',
            'COMPARISON_MISSING_RESPONSE',
            `Comparison Agent returned no comparison for supplier response ${response.id}.`,
            'normal',
          );
          alertCount++;
          continue;
        }

        const validRequirementIds = new Set((requirements ?? []).map((item) => item.id));
        const quoteIds = new Set(quotes.map((item) => item.id));
        const findings = comparison.findings.filter((finding) => validRequirementIds.has(finding.requirementId));

        if (findings.length !== comparison.findings.length) {
          throw new ToolError('AI_PROCESSING', 'Comparison Agent returned a requirement outside the confirmed inquiry requirements');
        }
        for (const finding of findings) {
          if (finding.supplierQuoteId && !quoteIds.has(finding.supplierQuoteId)) {
            throw new ToolError('AI_PROCESSING', 'Comparison Agent returned a supplier quote outside the current response');
          }
        }

        for (const finding of findings) {
          const quote = finding.supplierQuoteId
            ? quotes.find((item) => item.id === finding.supplierQuoteId)
            : quotes.length === 1 ? quotes[0] : null;
          const { error: upsertError } = await supabase
            .from('supplier_comparison_findings')
            .upsert({
              inquiry_id: inquiryId,
              supplier_response_id: response.id,
              supplier_quote_id: quote?.id ?? null,
              requirement_id: finding.requirementId,
              status: finding.status,
              evidence: finding.evidence,
              source_data: {
                supplier_response_id: response.id,
                quote_ids: quotes.map((item) => item.id),
                provider: ai.provider,
                model: ai.model,
              },
              ai_execution_id: running.id,
            }, { onConflict: 'supplier_response_id,requirement_id' });

          if (upsertError) throw new ToolError('CONFLICT', upsertError.message);

          findingCount++;

          if (finding.status === 'mismatch' || finding.status === 'unknown') {
            await createAlert(
              inquiryId,
              'comparison',
              finding.status === 'mismatch' ? 'SUPPLIER_REQUIREMENT_MISMATCH' : 'SUPPLIER_REQUIREMENT_UNKNOWN',
              `Supplier response ${response.id}: requirement ${finding.requirementId} is ${finding.status}. Evidence: ${finding.evidence}`,
              'normal',
            );
            alertCount++;
          }
        }

        compared++;
        await timeline(inquiryId, 'supplier_comparison_completed', {
          supplier_response_id: response.id,
          finding_count: findings.length,
          provider: ai.provider,
          model: ai.model,
        }, 'comparison');
      }

      await markExecutionSuccess(running.id, {
        response_count: responses?.length ?? 0,
        compared_count: compared,
        finding_count: findingCount,
        alert_count: alertCount,
        status: 'completed',
      });

      await timeline(inquiryId, 'comparison_completed', {
        compared_count: compared,
        finding_count: findingCount,
        alert_count: alertCount,
      }, 'comparison');

      return { execution: running, outcome: 'completed' };
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

        const rfqToken = `ARAT-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
        const subject = `RFQ — ${inquiry?.reference ?? inquiryId} — ${rfqToken}`;
        const body = [
          `RFQ Reference: ${inquiry?.reference ?? inquiryId}`,
          `RFQ Correlation Token: ${rfqToken}`,
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

export async function startInquiryWorkflow(
  inquiryId: string,
  trigger: 'inquiry_submission' | 'admin_manual' | 'document_retry' = 'inquiry_submission',
) {
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

  const existing = await supabase
    .from('ai_executions')
    .select('id,status,output_ref')
    .eq('task_key', `inquiry:${inquiryId}:stage:document`)
    .maybeSingle();

  if (existing.error) throw new ToolError('TRANSIENT', existing.error.message);

  if (existing.data?.status === 'queued' || existing.data?.status === 'running') {
    return {
      execution: existing.data,
      outcome: 'workflow_already_running' as const,
    };
  }

  if (existing.data?.status === 'succeeded') {
    return {
      execution: existing.data,
      outcome: 'workflow_already_started' as const,
    };
  }

  const execution = await enqueueWorkflow(inquiryId, 'document');

  await timeline(inquiryId, 'workflow_started', {
    previous_status: inquiry.status,
    execution_id: execution.id,
    execution_status: execution.status,
    trigger,
  });

  return {
    execution,
    outcome: execution.status === 'queued'
      ? 'workflow_queued' as const
      : 'workflow_already_running' as const,
  };
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
        const { data: processedResponses } = await supabase
          .from('supplier_responses')
          .select('id')
          .eq('inquiry_id', inquiryId)
          .eq('status', 'processed');

        const responseIds = (processedResponses ?? []).map((item) => item.id);
        let comparisonIsCurrent = responseIds.length === 0;

        if (responseIds.length > 0) {
          const { data: findings } = await supabase
            .from('supplier_comparison_findings')
            .select('supplier_response_id')
            .eq('inquiry_id', inquiryId);

          const comparedIds = new Set((findings ?? []).map((item) => item.supplier_response_id));
          comparisonIsCurrent = responseIds.every((id) => comparedIds.has(id));
        }

        if (!comparisonIsCurrent) {
          return runStage(inquiryId, 'comparison');
        }

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
            .select('status,output_ref')
            .eq('inquiry_id', inquiryId)
            .eq('task_key', `inquiry:${inquiryId}:stage:verification`)
            .maybeSingle();

          if (verification?.status === 'succeeded') {
            const verificationOutput = (verification.output_ref ?? {}) as { blocked?: boolean; pending_count?: number };

            if (verificationOutput.blocked) {
              throw new ToolError(
                'APPROVAL_REQUIRED',
                verificationOutput.pending_count
                  ? `Supplier verification is waiting for Admin review: ${verificationOutput.pending_count} supplier(s) still need verification evidence.`
                  : 'Supplier verification is waiting for Admin review.',
              );
            }

            const { data: rfqExecution } = await supabase
              .from('ai_executions')
              .select('status,output_ref')
              .eq('inquiry_id', inquiryId)
              .eq('task_key', `inquiry:${inquiryId}:stage:rfq`)
              .maybeSingle();

            if (rfqExecution?.status !== 'succeeded') return runStage(inquiryId, 'rfq');

            const rfqOutput = (rfqExecution.output_ref ?? {}) as { status?: string; created_count?: number };
            if (rfqOutput.status === 'pending_approval' || rfqOutput.created_count) {
              throw new ToolError('APPROVAL_REQUIRED', 'RFQ drafts require Admin approval before sending');
            }

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

export async function processQueuedWorkflow(limit = 5, inquiryId?: string) {
  const supabase = createSupabaseAdminClient();
  const maxExecutions = Math.max(1, Math.min(limit, 20));
  const results: Array<{
    executionId: string;
    inquiryId: string;
    stage: WorkflowStage | null;
    outcome?: string;
    error?: string;
  }> = [];
  const processedExecutionIds = new Set<string>();

  // Fetch one job at a time so stages queued by the current stage can be
  // processed in the same worker invocation. This makes the workflow advance
  // end-to-end in local development as well as from the scheduled worker.
  for (let iteration = 0; iteration < maxExecutions; iteration++) {
    let query = supabase
      .from('ai_executions')
      .select('id,inquiry_id,task_key,status,created_at')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(20);

    if (inquiryId) query = query.eq('inquiry_id', inquiryId);

    const { data: queued, error } = await query;
    if (error) throw new ToolError('TRANSIENT', error.message);

    const execution = (queued ?? []).find((item) => !processedExecutionIds.has(item.id));
    if (!execution) break;

    processedExecutionIds.add(execution.id);
    const match = execution.task_key.match(/^inquiry:[^:]+:stage:(.+)$/);
    const stage = match?.[1] as WorkflowStage | undefined;

    if (!stage || !stageAgentExists(stage)) {
      const message = 'Invalid workflow stage in task key';
      const { error: executionError } = await supabase
        .from('ai_executions')
        .update({
          status: 'failed',
          error_code: 'VALIDATION',
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', execution.id)
        .eq('status', 'queued');

      if (!executionError) {
        await supabase.from('ai_alerts').insert({
          inquiry_id: execution.inquiry_id,
          agent_id: 'orchestrator',
          alert_type: 'WORKFLOW_INVALID_STAGE',
          message,
          priority: 'urgent',
        });
        await timeline(execution.inquiry_id, 'workflow_execution_failed', {
          execution_id: execution.id,
          stage: stage ?? null,
          error_code: 'VALIDATION',
          message,
        });
      }

      results.push({
        executionId: execution.id,
        inquiryId: execution.inquiry_id,
        stage: null,
        error: message,
      });
      continue;
    }

    try {
      const result = await runStage(execution.inquiry_id, stage);
      results.push({
        executionId: execution.id,
        inquiryId: execution.inquiry_id,
        stage,
        outcome: result.outcome,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow stage failed';
      const errorCode = error instanceof ToolError ? error.code : 'AI_PROCESSING';

      await timeline(execution.inquiry_id, 'workflow_stage_failed', {
        execution_id: execution.id,
        stage,
        error_code: errorCode,
        message,
      }, stageAgentForTimeline(stage));

      results.push({
        executionId: execution.id,
        inquiryId: execution.inquiry_id,
        stage,
        error: message,
      });
    }
  }

  return {
    processed: results.length,
    results,
  };
}

function stageAgentForTimeline(stage: WorkflowStage) {
  if (stage === 'document') return 'document';
  if (stage === 'intake') return 'intake';
  if (stage === 'clarification') return 'clarification';
  if (stage === 'research') return 'product_research';
  if (stage === 'supplier_discovery') return 'supplier_discovery';
  if (stage === 'verification') return 'supplier_verification';
  if (stage === 'rfq') return 'rfq';
  if (stage === 'quote_extraction') return 'quote_extraction';
  if (stage === 'comparison') return 'comparison';
  if (stage === 'customer_quote') return 'customer_quote';
  if (stage === 'reporting') return 'reporting';
  return 'orchestrator';
}

function stageAgentExists(stage: WorkflowStage) {
  return [
    'document',
    'intake',
    'clarification',
    'research',
    'supplier_discovery',
    'verification',
    'rfq',
    'quote_extraction',
    'comparison',
    'customer_quote',
    'customer_response',
    'email_response',
    'reporting',
    'completed',
  ].includes(stage);
}
