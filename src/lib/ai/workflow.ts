import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';
import { getResearchProvider, type ResearchResult } from './research/provider';
import { runAgent } from './agent-runner';
import { documentOutputSchema, intakeOutputSchema, intakeRepairOutputSchema, clarificationOutputSchema, clarificationRepairOutputSchema, quoteExtractionOutputSchema, comparisonOutputSchema, customerQuoteOutputSchema, supplierContactResearchOutputSchema, supplierDiscoveryOutputSchema } from './agent-schemas';
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

async function createAlert(
  inquiryId: string,
  agentId: string,
  alertType: string,
  message: string,
  priority: 'normal' | 'urgent' = 'normal',
) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('ai_alerts').insert({
    inquiry_id: inquiryId,
    agent_id: agentId,
    alert_type: alertType,
    message,
    priority,
  });
  if (error) throw new ToolError('TRANSIENT', error.message);
}

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
                'This is the primary AI understanding step for a procurement request.',
                'Read the complete customer request and identify every distinct requested product/item before creating requirements.',
                'For each item, extract product, brand, model/part number, quantity and unit when supported by the customer wording.',
                'Normalize obvious typos and spacing when the intended term is clear. For example, treat "temprature sensor" as "temperature sensor" but do not invent a model.',
                'A brand or manufacturer can be inferred from the wording only when the relationship is strongly supported; record that field in inferredFields and lower confidence if needed.',
                'Never invent a missing quantity, brand, model, part number, specification, delivery term, or supplier.',
                'Return one item per requested product. If customer text contains procurement items, items must not be empty.',
                'Preserve the exact customer line/phrase in requestedText and use it as evidence.',
                'Material ambiguity must be reported in ambiguities, but ambiguity does not mean ignoring an otherwise identifiable product.',
                'Document-derived requirements are already persisted separately. In this Intake pass, create only new requirements sourced from customer_text. Do not recreate or modify document-derived requirements.',
              ],
            },
            intakeOutputSchema,
          );
          let result = ai.output;

          // Some models may partially follow the extraction contract when a PDF
          // contains many technical lines. Do not silently accept incomplete
          // items: run a focused AI repair pass using the customer request as
          // the authoritative product source.
          const incompleteItems = result.items.some((item) =>
            !item.product?.trim() || !item.evidence?.trim()
          );
          if (incompleteItems) {
            const repair = await runAgent(
              { agentId: 'intake', executionId: running.id, inquiryId },
              {
                original_customer_text: originalText ?? '',
                current_items: result.items,
                document_context: documentText,
                instructions: [
                  'Repair the procurement item extraction. Use the customer text as the primary source.',
                  'Return one item for every distinct product explicitly requested by the customer.',
                  'For this request, "temprature sensor handsfor 50 pcs" is one product item and "powerstation GMI 2 pcs" is another.',
                  'Normalize obvious spelling errors such as temprature -> temperature, but preserve the original phrase in requestedText.',
                  'Extract brand when explicitly stated or strongly supported by wording; do not invent model or part number.',
                  'Quantity and unit must come from the customer request unless explicitly supported elsewhere.',
                  'Do not turn individual PDF specification lines into separate products.',
                  'Every item must have a concrete product field and evidence explaining the customer text that supports it.',
                  'Never return an empty items array when the customer request contains procurement items.',
                ],
              },
              intakeRepairOutputSchema,
            );
            result = {
              ...result,
              items: repair.output.items,
            };
          }

          // Intake is allowed to add only customer-text requirements. The model
          // can still echo document context despite the instruction, so do not
          // fail the whole workflow for a recoverable source-label mismatch.
          // Keep only customer-text items; the sourceRef here identifies the
          // AI-extracted item group so Research can keep brand/model/specs scoped
          // to the correct product.
          const extractedRequirements = result.items.flatMap((item, itemIndex) => {
            const requirements: Array<{
              type: 'product'|'model_part_number'|'quantity'|'specification'|'delivery'|'other';
              value: string;
              source: 'customer_text';
              sourceRef?: string;
            }> = [];
            const sourceRef = `intake:item:${itemIndex}`;

            requirements.push({
              type: 'product',
              value: item.product.trim(),
              source: 'customer_text',
              sourceRef,
            });

            if (item.brand?.trim()) {
              requirements.push({
                type: 'specification',
                value: `Brand: ${item.brand.trim()}`,
                source: 'customer_text',
                sourceRef,
              });
            }

            if (item.model?.trim()) {
              requirements.push({
                type: 'model_part_number',
                value: item.model.trim(),
                source: 'customer_text',
                sourceRef,
              });
            }

            if (item.partNumber?.trim()) {
              requirements.push({
                type: 'model_part_number',
                value: item.partNumber.trim(),
                source: 'customer_text',
                sourceRef,
              });
            }

            if (item.quantity !== undefined) {
              requirements.push({
                type: 'quantity',
                value: item.unit?.trim()
                  ? `${item.quantity} ${item.unit.trim()}`
                  : String(item.quantity),
                source: 'customer_text',
                sourceRef,
              });
            }

            for (const specification of item.specifications) {
              if (specification.trim()) {
                requirements.push({
                  type: 'specification',
                  value: specification.trim(),
                  source: 'customer_text',
                  sourceRef,
                });
              }
            }

            if (item.deliveryRequirement?.trim()) {
              requirements.push({
                type: 'delivery',
                value: item.deliveryRequirement.trim(),
                source: 'customer_text',
                sourceRef,
              });
            }

            return requirements;
          });

          const customerTextRequirements = extractedRequirements.map((item) => ({
            ...item,
            source: 'customer_text' as const,
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
              source_ref: item.sourceRef ?? null,
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
                    items: result.items,
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
              extracted_items: result.items.length,
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

      if (rows.length === 0) {
        throw new ToolError(
          'AI_PROCESSING',
          'AI intake extracted no procurement requirements from the customer request.',
        );
      }

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

      // Some models return clarification questions as plain strings even when
      // the structured contract asks for requirement IDs. Repair that output
      // once with the concrete requirement IDs before allowing the workflow to
      // fail. Never guess IDs in application code.
      let clarificationOutput = ai.output;
      const missingQuestionIds = clarificationOutput.needsClarification &&
        clarificationOutput.questions.some((question) => !question.requirementId);
      if (missingQuestionIds) {
        const repair = await runAgent(
          { agentId: 'clarification', executionId: running.id, inquiryId },
          {
            original_customer_text: sourceContext.original_customer_text ?? '',
            requirements: unresolvedForAI.map((item) => ({
              id: item.id,
              type: item.type,
              value: item.value,
            })),
            current_output: clarificationOutput,
            instructions: [
              'Repair the clarification decision without changing its meaning.',
              'Every clarification question MUST be an object with a valid requirementId copied exactly from one of the supplied requirements.',
              'Never invent or alter a requirementId.',
              'If a question is not materially necessary, remove it rather than assigning an arbitrary requirement.',
              'If needsClarification is false, return an empty questions array.',
              'Return only the requested structured output.',
            ],
          },
          clarificationRepairOutputSchema,
        );
        clarificationOutput = repair.output;
      }

      const questionIds = new Set<string>();
      for (const question of clarificationOutput.questions) {
        if (!question.requirementId) continue;
        const requirement = unresolvedForAI.find((item) => item.id === question.requirementId);
        if (!requirement || existingRequirementIds.has(requirement.id)) continue;
        if (questionIds.has(requirement.id)) continue;
        questionIds.add(requirement.id);

        const { error: insertError } = await supabase.from('clarifications').insert({
          inquiry_id: inquiryId,
          requirement_id: requirement.id,
          question: question.question,
          status: 'sent',
        });
        if (insertError) throw new ToolError('CONFLICT', insertError.message);
      }

      if (clarificationOutput.needsClarification && questionIds.size === 0) {
        throw new ToolError('AI_PROCESSING', 'Clarification agent reported material ambiguity but returned no targeted question.');
      }

      if (clarificationOutput.needsClarification) {
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
        await markExecutionSuccess(running.id, { blocked: true, reason: 'no_suppliers_available' });
        await createAlert(inquiryId, 'rfq', 'NO_SUPPLIERS_AVAILABLE', 'RFQ cannot be prepared because no supplier record is available.', 'normal');
        return { execution: running, outcome: 'blocked' as const };
      }

      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('id,legal_name,verification_status')
        .in('id', supplierIds);

      // Verification is informational at this stage. The RFQ is still a draft
      // and cannot be sent until Admin explicitly approves the email action.
      const rfqSuppliers = suppliers ?? [];

      if (!rfqSuppliers.length) {
        await markExecutionSuccess(running.id, { blocked: true, reason: 'supplier_records_not_found' });
        await createAlert(inquiryId, 'rfq', 'SUPPLIER_RECORDS_NOT_FOUND', 'RFQ cannot be prepared because supplier records could not be loaded.', 'normal');
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
      for (const supplier of rfqSuppliers) {
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

      const discoveryProvider = getResearchProvider();

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
      const discoveryCandidates = new Map<string, { name: string; country?: string; website?: string; evidence: string[]; requirementId?: string; matchType?: 'exact_product' | 'same_brand_distributor' | 'same_brand_similar' | 'related_alternative'; matchScore?: number; matchNote?: string }>();

      let selectedResults = results ?? [];
      if (process.env.OPENAI_API_KEY && results?.length) {
        const confirmedRequirements = await supabase
          .from('requirements')
          .select('id,type,value,source_ref')
          .eq('inquiry_id', inquiryId)
          .eq('status', 'confirmed');

        const productRequirements = (confirmedRequirements.data ?? []).filter((item) => item.type === 'product');
        const allowedUrls = new Set((results ?? []).map((item) => item.sourceUrl));

        // Validate each product independently. Research evidence carries the exact
        // product requirement id so candidates cannot be accidentally attributed to
        // another requested item.
        for (const productRequirement of productRequirements) {
          const productResults = (results ?? []).filter((item) =>
            (item.structuredData?.arat_requirement_id as string | undefined) === productRequirement.id
          );
          if (!productResults.length) continue;

          const discoveryAi = await runAgent(
            { agentId: 'supplier_discovery', executionId: running.id, inquiryId },
            {
              requirements: (confirmedRequirements.data ?? []).filter((item) => item.source_ref === productRequirement.source_ref),
              target_product: productRequirement,
              research_results: productResults.map((item) => ({
                source_name: item.sourceName,
                source_url: item.sourceUrl,
                finding: item.finding,
                structured_data: item.structuredData,
                relevance: item.relevance,
                confidence: item.confidence,
                evidence: item.evidence,
              })),
              instructions: [
                'Research and validate suppliers for THIS PRODUCT ONLY. Never mix evidence from another product.',
                'Identify manufacturers, official distributors, distributors, dealers, or credible commercial suppliers that can supply the requested product/brand/model.',
                'Prioritize Turkey/Türkiye suppliers first. If no valid Turkish supplier is supported by evidence, include credible international suppliers.',
                'Prefer official manufacturer/distributor evidence over generic directories or marketplaces.',
                'Reject marketplaces, government sites, banks, dictionaries, documentation sites, generic directories, media, research portals, and unrelated information pages.',
                'Every candidate must have an explicit company name supported by the supplied evidence.',
                'Never invent a company name, website, email, phone, contact person, job title, or supplier relationship.',
                'Use only an exact source URL from the supplied research results as sourceUrl.',
                'Return the exact target product requirement id in requirementId.',
                'Classify the candidate using exactly one matchType: exact_product, same_brand_distributor, same_brand_similar, or related_alternative.',
                'Use matchScore as a 0-100 fit score: exact_product 95-100; same_brand_distributor 80-94; same_brand_similar 65-79; related_alternative 50-64.',
                'matchScore must reflect evidence, not optimism. If the exact requested model is not confirmed, do not call it exact_product.',
                'Write matchNote as a short factual explanation of what is confirmed and what is not confirmed.',
              ],
            },
            supplierDiscoveryOutputSchema,
          );

          const allowedUrls = new Set(productResults.map((item) => item.sourceUrl));
          for (const candidate of discoveryAi.output.candidates) {
            if (!allowedUrls.has(candidate.sourceUrl)) continue;
            const name = candidate.name?.trim();
            // A schema-tolerant AI response may omit the company name. Do not let
            // an empty candidate suppress the fallback for this product.
            if (!name) continue;
            discoveryCandidates.set(`${candidate.sourceUrl}::${productRequirement.id}`, {
              name,
              country: candidate.country?.trim() || undefined,
              website: candidate.website?.trim() || undefined,
              evidence: candidate.evidence ?? [],
              requirementId: productRequirement.id,
              matchType: candidate.matchType,
              matchScore: candidate.matchScore,
              matchNote: candidate.matchNote,
            });
          }
        }
        // Evidence-first recovery: if the ranking pass returns too few candidates
        // for a product, run a second extraction pass instead of treating the whole
        // supplier-discovery stage as empty.
        if (results.length > 0) {
          for (const productRequirement of productRequirements) {
            const productResults = results.filter((item) =>
              (item.structuredData?.arat_requirement_id as string | undefined) === productRequirement.id
            );
            const currentCount = [...discoveryCandidates.values()].filter(
              (candidate) => candidate.requirementId === productRequirement.id,
            ).length;
            if (!productResults.length || currentCount >= 3) continue;

            const extractionAi = await runAgent(
              { agentId: 'supplier_discovery', executionId: running.id, inquiryId },
              {
                target_product: productRequirement,
                research_results: productResults.slice(0, 80).map((item) => ({
                  source_name: item.sourceName,
                  source_url: item.sourceUrl,
                  finding: item.finding,
                  structured_data: item.structuredData,
                  relevance: item.relevance,
                  confidence: item.confidence,
                  evidence: item.evidence,
                })),
                instructions: [
                  'Extract supplier/manufacturer/distributor candidates for THIS product only.',
                  'Return up to 10 candidates, strongest evidence first.',
                  'The company name must be explicitly present in source_name, page title, finding, or evidence.',
                  'Use the exact supplied source_url supporting that company and product relationship.',
                  'Official manufacturer pages are valid even when they do not say supplier or distributor.',
                  'Prefer Turkey/Türkiye suppliers when evidence is comparable; include international suppliers when needed.',
                  'Exact product/model gets the highest score. Official brand distributors may be same_brand_distributor when the exact model is not confirmed.',
                  'Never return marketplaces, generic directories, government pages, documentation portals, media, or unrelated companies.',
                  'Never invent email, phone, contact person, website, country, or availability.',
                  'Return requirementId exactly as the target product requirement id.',
                ],
              },
              supplierDiscoveryOutputSchema,
            );

            const allowedProductUrls = new Set(productResults.map((item) => item.sourceUrl));
            for (const candidate of extractionAi.output.candidates) {
              const name = candidate.name?.trim();
              if (!name || !allowedProductUrls.has(candidate.sourceUrl)) continue;
              const source = productResults.find((item) => item.sourceUrl === candidate.sourceUrl);
              const key = productRequirement.id + '::' + name.toLowerCase();
              discoveryCandidates.set(key, {
                name,
                country: candidate.country?.trim() || undefined,
                website: candidate.website?.trim() || undefined,
                evidence: candidate.evidence ?? (source?.finding ? [source.finding] : []),
                requirementId: productRequirement.id,
                matchType: candidate.matchType,
                matchScore: candidate.matchScore,
                matchNote: candidate.matchNote,
              });
            }
          }
        }

        // Deterministic evidence recovery from research evidence.
        if (results.length > 0) {
          const confirmedRequirementsForRecovery = confirmedRequirements.data ?? [];
          for (const productRequirement of productRequirements) {
            const scoped = results.filter((item) =>
              String(item.structuredData?.arat_requirement_id ?? '') === productRequirement.id
            );
            const brandValues = confirmedRequirementsForRecovery
              .filter((item) => item.source_ref === productRequirement.source_ref && item.type === 'specification')
              .map((item) => item.value.match(/brand\s*:\s*(.+)/i)?.[1]?.trim())
              .filter((value): value is string => Boolean(value));
            const brandPattern = brandValues.length
              ? new RegExp(brandValues.map((v) => v.replace(/[.*+?^{}()|[\]\\]/g, '\\$&')).join('|'), 'i')
              : null;

            for (const item of scoped) {
              const evidenceText = [item.sourceName, item.finding, item.structuredData?.title, ...(item.evidence ?? [])]
                .filter(Boolean).join(' ');
              if (!evidenceText.trim()) continue;

              let host = '';
              try { host = new URL(item.sourceUrl).hostname.replace(/^www\./, ''); } catch { continue; }
              if (/(wikipedia|facebook|instagram|ebay|walmart|alibaba|manuals\.plus|researchgate|academia|britannica|\.gov\b)/i.test(host)) continue;

              const companyMatches = [
                evidenceText.match(/\b([A-Z][A-Za-z0-9&.,'()\- ]{2,100}?(?:Ltd|Limited|Inc|LLC|GmbH|S\.?A\.?S?\.?|Co\.|Corporation|Corp\.|Sensors|Energy))\b/),
                evidenceText.match(/\b([A-Z][A-Za-z0-9&.'()\- ]{2,80}?)\s+(?:supplies|supply|manufactures|manufacture|distributes|distributor|represents|offers|sells)\b/i),
              ];
              let name = companyMatches.find((m) => m?.[1])?.[1]?.trim();

              if (!name && brandPattern) {
                const brandMatch = evidenceText.match(brandPattern);
                if (brandMatch && /(supplier|distributor|manufacturer|official|sales|products?|supply|sells|temperature|sensor|power station|energy)/i.test(evidenceText)) {
                  name = brandMatch[0].trim();
                }
              }
              if (!name) continue;

              const key = productRequirement.id + '::' + name.toLowerCase();
              if (blockedNames.has(name.toLowerCase())) continue;

              const exactModel = confirmedRequirementsForRecovery
                .filter((item) => item.source_ref === productRequirement.source_ref && item.type === 'model_part_number')
                .some((item) => evidenceText.toLowerCase().includes(item.value.toLowerCase()));
              const sameBrand = Boolean(brandPattern?.test(evidenceText));
              const score = exactModel ? 96 : sameBrand ? 86 : 70;
              const matchType = exactModel ? 'exact_product' : sameBrand ? 'same_brand_distributor' : 'related_alternative';

              discoveryCandidates.set(key, {
                name,
                website: item.sourceUrl,
                evidence: [item.finding, ...(item.evidence ?? [])].filter(Boolean).slice(0, 5),
                requirementId: productRequirement.id,
                matchType,
                matchScore: score,
                matchNote: exactModel
                  ? 'Exact requested model is present in the research evidence.'
                  : sameBrand
                    ? 'Requested brand is explicitly represented in the research evidence.'
                    : 'Commercial company identity is explicitly present in the research evidence; exact product requires confirmation.',
              });
            }
          }
        }

        // If one product did not yield a usable candidate, run a focused
        // extraction pass for that product only. Product A must never mask Product B.
        if (results.length > 0) {
          for (const productRequirement of productRequirements) {
            const alreadyHasCandidate = [...discoveryCandidates.values()]
              .some((candidate) => candidate.requirementId === productRequirement.id);
            if (alreadyHasCandidate) continue;

            const productResults = results.filter((item) =>
              (item.structuredData?.arat_requirement_id as string | undefined) === productRequirement.id
            );
            if (!productResults.length) continue;

            const focusedAi = await runAgent(
              { agentId: 'supplier_discovery', executionId: running.id, inquiryId },
              {
                target_product: productRequirement,
                research_results: productResults.map((item) => ({
                  source_name: item.sourceName,
                  source_url: item.sourceUrl,
                  finding: item.finding,
                  structured_data: item.structuredData,
                  relevance: item.relevance,
                  confidence: item.confidence,
                  evidence: item.evidence,
                })),
                instructions: [
                  'Find supplier candidates for THIS PRODUCT ONLY.',
                  'Use the exact product, brand, model/part number and specifications in the target product.',
                  'Prefer Turkey/Türkiye suppliers first; if none are supported, use credible international suppliers.',
                  'An exact product match is preferred, but an official manufacturer, representative or distributor of the requested brand may also be returned when the exact model is not confirmed.',
                  'A similar product from the requested brand may also be returned, but mark it same_brand_similar, never exact_product unless the exact model is supported.',
                  'Never invent a company name, relationship, website, contact, email or phone.',
                  'The company name and supplier relationship must be supported by the supplied evidence.',
                  'Every sourceUrl must exactly match a supplied research result.',
                  'Return requirementId exactly as the target product requirement id.',
                  'Return matchType and an evidence-bound matchScore using the existing supplier matching rules.',
                ],
              },
              supplierDiscoveryOutputSchema,
            );

            const productAllowedUrls = new Set(productResults.map((item) => item.sourceUrl));
            for (const candidate of focusedAi.output.candidates) {
              const name = candidate.name?.trim();
              if (!name || !productAllowedUrls.has(candidate.sourceUrl)) continue;
              discoveryCandidates.set(`${candidate.sourceUrl}::${productRequirement.id}`, {
                name,
                country: candidate.country?.trim() || undefined,
                website: candidate.website?.trim() || undefined,
                evidence: candidate.evidence ?? [],
                requirementId: productRequirement.id,
                matchType: candidate.matchType,
                matchScore: candidate.matchScore,
                matchNote: candidate.matchNote,
              });
            }
          }
        }

        // If the broad discovery pass was overly conservative, run a focused
        // extraction pass over the strongest evidence instead of concluding that
        // no supplier exists. This is still evidence-bound: every sourceUrl must
        // come from research_results and every name must be extracted from evidence.
        if (discoveryCandidates.size === 0 && results.length > 0) {
          const strongResults = results.filter((item) => {
            const haystack = [
              item.source_name ?? '',
              item.finding ?? '',
              item.source_url ?? '',
            ].join(' ').toLowerCase();

            return (
              /(manufacturer|supplier|distributor|official|sales|contact|products?)/i.test(haystack) ||
              /hansford|gmi/i.test(haystack)
            );
          }).slice(0, 20);

          if (strongResults.length > 0) {
            const repairAi = await runAgent(
              { agentId: 'supplier_discovery', executionId: running.id, inquiryId },
              {
                requirements: confirmedRequirements.data ?? [],
                research_results: strongResults.map((item) => ({
                  source_name: item.sourceName,
                  source_url: item.sourceUrl,
                  finding: item.finding,
                  structured_data: item.structuredData,
                  confidence: item.confidence,
                  evidence: item.evidence,
                })),
                instructions: [
                  'This is a focused supplier-name extraction pass.',
                  'Identify real supplier/manufacturer/distributor companies explicitly named in the supplied evidence.',
                  'If an official company domain or official company page clearly identifies the company, select it.',
                  'Extract the exact company name from source_name, page title, finding, or evidence into name.',
                  'Do not require the page to contain the literal word supplier if it is clearly the official manufacturer/company page for the requested product.',
                  'Do not invent names. Do not use marketplaces, social media, directories, government sites, or unrelated companies.',
                  'Every sourceUrl must exactly match one of the supplied research_results.',
                  'Return every supported supplier candidate, not an empty list merely because some results are weak.',
                ],
              },
              supplierDiscoveryOutputSchema,
            );

            for (const candidate of repairAi.output.candidates) {
              if (!candidate.name?.trim()) continue;
              if (!allowedUrls.has(candidate.sourceUrl)) continue;
              const matchingResult = results.find((item) => item.source_url === candidate.sourceUrl);
              const requirementId = String(matchingResult?.structuredData?.arat_requirement_id ?? candidate.requirementId ?? '');
              if (!requirementId) continue;
              discoveryCandidates.set(`${candidate.sourceUrl}::${requirementId}`, {
                name: candidate.name.trim(),
                country: candidate.country?.trim() || undefined,
                website: candidate.website?.trim() || undefined,
                evidence: candidate.evidence ?? [],
                requirementId,
                matchType: candidate.matchType,
                matchScore: candidate.matchScore,
                matchNote: candidate.matchNote,
              });
            }
          }
        }

        // Final evidence-bound fallback: if AI still returns no candidates,
        // extract an explicitly named company from the research finding itself.
        // This is not supplier invention: the name must appear in the evidence
        // and the result must match one of the confirmed requested brands.
        if (discoveryCandidates.size === 0 && results.length > 0) {
          const confirmedBrands = (confirmedRequirements.data ?? [])
            .filter((item) => item.type === 'specification')
            .map((item) => item.value.match(/brand\s*:\s*(.+)/i)?.[1]?.trim())
            .filter((value): value is string => Boolean(value))
            .map((value) => value.toLowerCase());

          const companyNameFromFinding = (finding: string, brand?: string) => {
            const sentences = finding
              .split(/[.!?\\n]+/)
              .map((sentence) => sentence.trim())
              .filter(Boolean);

            const verbPattern =
              /\s+(?:is|are|offers|offer|specialises|specializes|manufactures|manufacture|supplies|supply|designs|design|provides|provide)\s+/i;

            for (const sentence of sentences) {
              const match = sentence.match(new RegExp(
                '^(.{2,120}?)' + verbPattern.source,
                'i',
              ));
              if (match?.[1]) {
                const name = match[1].trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
                if (
                  name.length >= 2 &&
                  (!brand || name.toLowerCase().includes(brand) || brand.includes(name.toLowerCase()))
                ) {
                  return name;
                }
              }
            }

            return undefined;
          };

          for (const result of results) {
            const haystack = [
              result.source_name ?? '',
              result.finding ?? '',
              result.source_url ?? '',
            ].join(' ').toLowerCase();

            const matchedBrand = confirmedBrands.find((brand) => haystack.includes(brand));
            if (!matchedBrand) continue;

            const name = companyNameFromFinding(result.finding ?? '', matchedBrand);
            if (!name) continue;

            const requirementId = String(result.structuredData?.arat_requirement_id ?? '');
            if (!requirementId) continue;
            discoveryCandidates.set(`${result.sourceUrl}::${requirementId}`, {
              name,
              website: /^https?:\/\//i.test(result.sourceUrl) ? result.sourceUrl : undefined,
              evidence: [result.finding].filter(Boolean),
              requirementId,
              matchType: /\bmanufacturer\b|\bofficial\b|\bproduct\b/i.test(result.finding ?? '') ? 'exact_product' : 'same_brand_distributor',
              matchScore: /\bmanufacturer\b|\bofficial\b|\bproduct\b/i.test(result.finding ?? '') ? 96 : 86,
              matchNote: 'Candidate derived directly from the research evidence; exactness should be confirmed from the cited source.',
            });
          }
        }

        // Keep the strongest 10 candidates per requested product.
        // IMPORTANT: candidate.website may be the supplier homepage while the
        // evidence source is a different research URL. Do not lose a valid
        // candidate just because those URLs differ.
        const selectedByRequirement = new Map<string, { result: ResearchResult; score: number }[]>();
        for (const candidate of discoveryCandidates.values()) {
          if (!candidate.requirementId || !candidate.name) continue;
          const candidateSource = results.find((item) =>
            String(item.structuredData?.arat_requirement_id ?? '') === candidate.requirementId &&
            (
              item.source_url === candidate.website ||
              candidate.evidence.some((e) => Boolean(e) && (
                item.finding?.includes(e) ||
                e.includes(item.finding ?? '')
              ))
            )
          );
          if (!candidateSource) {
            // Fall back to the strongest research result for this product. The
            // candidate itself is already evidence-bound by the discovery pass.
            const fallback = results.find((item) =>
              String(item.structuredData?.arat_requirement_id ?? '') === candidate.requirementId
            );
            if (!fallback) continue;
            const list = selectedByRequirement.get(candidate.requirementId) ?? [];
            list.push({ result: fallback, score: candidate.matchScore ?? 50 });
            selectedByRequirement.set(candidate.requirementId, list);
            continue;
          }
          const list = selectedByRequirement.get(candidate.requirementId) ?? [];
          list.push({ result: candidateSource, score: candidate.matchScore ?? ((candidateSource.relevance ?? 0) * 100) });
          selectedByRequirement.set(candidate.requirementId, list);
        }
        selectedResults = [...selectedByRequirement.values()].flatMap((items) =>
          items
            .sort((a, b) => b.score - a.score)
            .filter((item, index, arr) => index === arr.findIndex((x) => x.result.source_url === item.result.source_url))
            .slice(0, 10)
            .map((item) => item.result)
        );
      }

      for (const result of selectedResults) {
        if (!result.source_url) continue;

        let hostname = '';
        try {
          hostname = new URL(result.source_url).hostname.replace(/^www\./, '');
        } catch {
          continue;
        }

        const text = `${result.source_name ?? ''} ${result.finding ?? ''} ${result.structuredData?.title ?? ''}`.toLowerCase();
        const blockedSource = /(scribd|manualslib|manualmachine|pdfcoffee|researchgate|academia\\.edu|merriam-webster|newyorkfed|irs|sba|developer\\.android|arenasolutions)/i.test(hostname);
        const supplierSignal = /(manufacturer|supplier|distributor|fabricat|official dealer|official distributor|industrial|machinery|components?|electronics|sensor|instrumentation|power station|portable power|battery|energy storage|inverter|brand|product)/i.test(text);
        const commercialSignal = /(sales|contact|products?|catalog|quote|quotation|rfq|buy|stock|inventory|dealer|distributor|manufacturer)/i.test(text);
        const genericInformationSource = /(dictionary|survey|government|regulation|documentation|glossary|reference)/i.test(text);
        const resultRequirementId = String(result.structuredData?.arat_requirement_id ?? '');
        const validatedCandidate = [...discoveryCandidates.values()].find((candidate) => candidate.requirementId === resultRequirementId && (candidate.website === result.source_url || candidate.evidence.includes(result.finding ?? '')));
        if (blockedSource || (!supplierSignal && !validatedCandidate?.name) || (!commercialSignal && genericInformationSource)) continue;

        const requirementId = String(result.structuredData?.arat_requirement_id ?? '');
        const aiCandidate = discoveryCandidates.get(`${result.source_url}::${requirementId}`) ?? [...discoveryCandidates.values()].find((candidate) => candidate.website === result.source_url && candidate.requirementId === requirementId);
        if (!aiCandidate?.name) continue;

        const proposedName = aiCandidate.name.slice(0, 240);
        const key = `${requirementId}::${proposedName.toLowerCase()}`;
        if (seen.has(key) || blockedNames.has(proposedName.toLowerCase())) continue;
        seen.add(key);

        const website = aiCandidate.website || `https://${hostname}`;
        const country = aiCandidate.country ||
          (result.structuredData?.country as string | undefined)?.trim() ||
          null;

        // Supplier discovery is an AI preparation step, not an Admin approval
        // gate. Create the supplier record immediately so it is available in
        // the Suppliers section. Admin approval is reserved for the RFQ/email
        // send action.
        let supplierId: string | null = null;
        const { data: existingSupplier, error: supplierLookupError } = await supabase
          .from('suppliers')
          .select('id')
          .ilike('legal_name', proposedName.slice(0, 240))
          .limit(1)
          .maybeSingle();

        if (supplierLookupError) throw new ToolError('TRANSIENT', supplierLookupError.message);

        if (existingSupplier?.id) {
          supplierId = existingSupplier.id;
        } else {
          const { data: createdSupplier, error: supplierError } = await supabase
            .from('suppliers')
            .insert({
              legal_name: proposedName.slice(0, 240),
              primary_country: country ?? 'Unknown',
              supplier_type: 'unknown',
              verification_status: 'pending',
              description: [
              result.finding?.slice(0, 1600) || '',
              aiCandidate.evidence.join(' ').slice(0, 400),
            ].filter(Boolean).join(' ').slice(0, 2000) || null,
            })
            .select('id')
            .single();

          if (supplierError || !createdSupplier) {
            throw new ToolError('CONFLICT', supplierError?.message ?? 'Failed to create supplier record');
          }

          supplierId = createdSupplier.id;
        }

        const { data: existingWebsite, error: websiteLookupError } = await supabase
          .from('supplier_websites')
          .select('id')
          .eq('supplier_id', supplierId)
          .eq('url', website)
          .maybeSingle();

        if (websiteLookupError) throw new ToolError('TRANSIENT', websiteLookupError.message);

        let websiteId = existingWebsite?.id ?? null;
        if (!websiteId) {
          const { data: createdWebsite, error: websiteError } = await supabase
            .from('supplier_websites')
            .insert({
              supplier_id: supplierId,
              url: website,
              is_primary: true,
            })
            .select('id')
            .single();

          if (websiteError || !createdWebsite) {
            throw new ToolError('CONFLICT', websiteError?.message ?? 'Failed to create supplier website');
          }

          websiteId = createdWebsite.id;
        }

        await supabase
          .from('suppliers')
          .update({
            primary_website_id: websiteId,
            description: [
              result.finding?.slice(0, 1600) || '',
              aiCandidate.evidence.join(' ').slice(0, 400),
            ].filter(Boolean).join(' ').slice(0, 2000) || null,
            ...(country ? { primary_country: country } : {}),
          })
          .eq('id', supplierId);

        // Before a supplier can be used for RFQ, research its real contact channels.
        // Search specifically for the supplier's own domain and let the AI extract only
        // contact facts supported by the returned evidence.
        let contactResearch: {
          contacts: Array<{
            name?: string;
            email?: string;
            phone?: string;
            jobTitle?: string;
            department?: string;
            country?: string;
            professionalProfile?: string;
            evidence: string[];
          }>;
          emails: Array<{ email: string; evidence: string }>;
        } = { contacts: [], emails: [] };

        if (discoveryProvider) {
          const contactResults = await discoveryProvider.search({
            inquiryId,
            query: `site:${hostname} (contact OR sales OR "sales email" OR "email us" OR distributor OR "request a quote")`,
            limit: 8,
          });

          if (contactResults.length > 0) {
            const contactAi = await runAgent(
              { agentId: 'contact_research', executionId: running.id, inquiryId },
              {
                supplier: {
                  name: proposedName,
                  website,
                  country,
                },
                search_results: contactResults.map((item) => ({
                  source_name: item.sourceName,
                  source_url: item.sourceUrl,
                  finding: item.finding,
                  structured_data: item.structuredData,
                  evidence: item.evidence,
                })),
                instructions: [
                  'Verify contact information for this supplier using only the supplied search evidence.',
                  'Prefer contact pages, official sales pages, official distributor pages, and official supplier domains.',
                  'Extract email addresses only when explicitly present in the evidence. Never guess an email pattern.',
                  'Extract contact person, department, job title, phone, country, and professional profile only when explicitly supported.',
                  'Ignore generic directories and unrelated websites even if they mention the supplier.',
                  'Return empty arrays when the evidence does not support a contact fact.',
                ],
              },
              supplierContactResearchOutputSchema,
            );
            contactResearch = contactAi.output;
          }
        }

        const uniqueEmails = new Set<string>();
        for (const item of contactResearch.emails) {
          const emailValue = item.email.trim().toLowerCase();
          if (uniqueEmails.has(emailValue)) continue;
          uniqueEmails.add(emailValue);

          const { data: existingEmail } = await supabase
            .from('supplier_emails')
            .select('id')
            .eq('supplier_id', supplierId)
            .eq('email', emailValue)
            .maybeSingle();

          if (!existingEmail) {
            const { data: createdEmail, error: emailError } = await supabase
              .from('supplier_emails')
              .insert({
                supplier_id: supplierId,
                email: emailValue,
                is_primary: false,
                status: 'active',
              })
              .select('id')
              .single();

            if (emailError) throw new ToolError('CONFLICT', emailError.message);

            if (createdEmail) {
              const { data: primaryEmail } = await supabase
                .from('supplier_emails')
                .select('id')
                .eq('supplier_id', supplierId)
                .eq('status', 'active')
                .order('is_primary', { ascending: false })
                .order('created_at', { ascending: true })
                .limit(1)
                .maybeSingle();

              if (primaryEmail?.id) {
                await supabase
                  .from('supplier_emails')
                  .update({ is_primary: true })
                  .eq('id', primaryEmail.id);
                await supabase
                  .from('suppliers')
                  .update({ primary_email_id: primaryEmail.id })
                  .eq('id', supplierId);
              }
            }
          }
        }

        for (const contact of contactResearch.contacts) {
          if (!contact.email && !contact.name && !contact.phone && !contact.professionalProfile) continue;

          const { data: existingContact } = await supabase
            .from('supplier_contacts')
            .select('id')
            .eq('supplier_id', supplierId)
            .eq('email', contact.email ?? '')
            .maybeSingle();

          if (!existingContact) {
            const { data: createdContact, error: contactError } = await supabase
              .from('supplier_contacts')
              .insert({
                supplier_id: supplierId,
                name: contact.name ?? null,
                email: contact.email ?? null,
                phone: contact.phone ?? null,
                job_title: contact.jobTitle ?? null,
                department: contact.department ?? null,
                country: contact.country ?? country,
                professional_profile: contact.professionalProfile ?? null,
                notes: contact.evidence.join(' | ').slice(0, 2000) || null,
                status: 'active',
                is_primary: false,
              })
              .select('id')
              .single();

            if (contactError || !createdContact) {
              throw new ToolError('CONFLICT', contactError?.message ?? 'Failed to create supplier contact');
            }
          }
        }

        const { error } = await supabase.from('supplier_candidates').upsert({
          inquiry_id: inquiryId,
          requirement_id: aiCandidate.requirementId ?? null,
          supplier_id: supplierId,
          proposed_name: proposedName.slice(0, 240),
          proposed_country: country,
          proposed_website: website,
          match_evidence: {
            research_result_id: result.id,
            finding: result.finding,
            relevance: result.relevance,
            confidence: result.confidence,
            match_type: aiCandidate.matchType ?? 'same_brand_distributor',
            match_score: aiCandidate.matchScore ?? 75,
            match_note: aiCandidate.matchNote ?? null,
            coverage_count: 1,
            coverage_total: 1,
          },
          availability_evidence: {},
          verification_evidence: {
            source_url: result.source_url,
            source_name: result.source_name,
          },
          status: 'finalized',
        }, { onConflict: 'inquiry_id,proposed_name,requirement_id', ignoreDuplicates: false });

        if (!error) createdCount++;
      }

      // Rank suppliers higher when the same supplier can cover multiple requested products.
      // Each product still keeps its own candidate row, so separate suppliers are fully valid.
      const { data: rankedCandidates } = await supabase
        .from('supplier_candidates')
        .select('id,supplier_id,requirement_id,match_evidence')
        .eq('inquiry_id', inquiryId)
        .not('supplier_id', 'is', null)
        .not('requirement_id', 'is', null);

      const totalProductRequirements = new Set(
        (await supabase.from('requirements').select('id').eq('inquiry_id', inquiryId).eq('status', 'confirmed').eq('type', 'product')).data?.map((row) => row.id) ?? [],
      ).size;
      const coverageBySupplier = new Map<string, Set<string>>();
      for (const candidate of rankedCandidates ?? []) {
        if (!candidate.supplier_id || !candidate.requirement_id) continue;
        const set = coverageBySupplier.get(candidate.supplier_id) ?? new Set<string>();
        set.add(candidate.requirement_id);
        coverageBySupplier.set(candidate.supplier_id, set);
      }

      console.log('\n[ARAT][supplier-discovery] ===== SUPPLIER CANDIDATES =====');
      console.table((rankedCandidates ?? []).map((candidate) => {
        const evidence = (candidate.match_evidence ?? {}) as Record<string, unknown>;
        return {
          supplier_id: candidate.supplier_id,
          requirement_id: candidate.requirement_id,
          match_type: evidence.match_type ?? '-',
          score: evidence.match_score ?? '-',
          coverage: evidence.coverage_count ?? '-',
          name: evidence.supplier_name ?? '-',
        };
      }));
      console.log('[ARAT][supplier-discovery] candidate rows:', rankedCandidates?.length ?? 0);
      console.log('[ARAT][supplier-discovery] ================================\n');

      for (const candidate of rankedCandidates ?? []) {
        if (!candidate.supplier_id) continue;
        const coverageCount = coverageBySupplier.get(candidate.supplier_id)?.size ?? 1;
        const evidence = (candidate.match_evidence ?? {}) as Record<string, unknown>;
        const baseScore = typeof evidence.match_score === 'number' ? evidence.match_score : 75;
        const coverageBonus = Math.min(10, Math.max(0, coverageCount - 1) * 5);
        const rankScore = Math.min(100, baseScore + coverageBonus);
        await supabase
          .from('supplier_candidates')
          .update({
            match_evidence: {
              ...evidence,
              match_score: rankScore,
              coverage_count: coverageCount,
              coverage_total: totalProductRequirements,
              coverage_bonus: coverageBonus,
            },
          })
          .eq('id', candidate.id);
      }

      if (createdCount === 0) {
        await markExecutionSuccess(running.id, {
          research_case_id: research.id,
          candidate_count: 0,
          blocked: true,
          reason: 'no_supplier_candidates_supported_by_research',
        });

        await setInquiryStatus(inquiryId, 'researching');
        await supabase.from('ai_alerts').insert({
          inquiry_id: inquiryId,
          agent_id: 'supplier_discovery',
          alert_type: 'NO_SUPPLIER_CANDIDATES',
          message: 'Supplier discovery found no supplier candidate supported by the current research evidence. No RFQ was queued.',
          priority: 'normal',
        });
        await timeline(inquiryId, 'workflow_supplier_candidates_not_found', {
          research_case_id: research.id,
          candidate_count: 0,
          reason: 'no_supplier_candidates_supported_by_research',
        }, 'supplier_discovery');

        return { execution: running, outcome: 'no_supplier_candidates' as const };
      }

      await markExecutionSuccess(running.id, {
        research_case_id: research.id,
        candidate_count: createdCount,
        next_stage: 'rfq',
        blocked: false,
      });

      await setInquiryStatus(inquiryId, 'researching');
      await supabase.from('ai_alerts').insert({
        inquiry_id: inquiryId,
        agent_id: 'supplier_discovery',
        alert_type: 'SUPPLIER_CANDIDATES_READY',
        message: `${createdCount} supplier(s) were discovered and added to Suppliers. RFQ drafts will be prepared automatically; Admin approval is required only before sending supplier email.`,
        priority: 'normal',
      });
      await timeline(inquiryId, 'workflow_supplier_candidates_ready', {
        research_case_id: research.id,
        candidate_count: createdCount,
        admin_approval_required_at: 'rfq_send',
      }, 'supplier_discovery');

      const rfq = await enqueueWorkflow(inquiryId, 'rfq');
      await timeline(inquiryId, 'workflow_rfq_queued', {
        rfq_execution_id: rfq.id,
        approval_required: true,
      }, 'supplier_discovery');

      return { execution: running, outcome: 'rfq_queued' as const };
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
          .select('id,type,value,source_ref')
          .eq('inquiry_id', inquiryId)
          .eq('status', 'confirmed')
          .order('created_at', { ascending: true });

        const confirmedRequirements = requirements ?? [];
        const productItems = confirmedRequirements
          .filter((item) => item.type === 'product')
          .map((product) => {
            const relatedRows = confirmedRequirements
              .filter((item) =>
                item.source_ref === product.source_ref &&
                (item.type === 'specification' || item.type === 'model_part_number')
              )
              .filter((item) => item.value?.trim() && item.value.trim().toLowerCase() !== 'null');

            const brand = relatedRows
              .find((item) => /^brand\s*:/i.test(item.value))
              ?.value.replace(/^brand\s*:\s*/i, '').trim();

            const model = relatedRows
              .find((item) => item.type === 'model_part_number')
              ?.value.trim();

            const specifications = relatedRows
              .filter((item) => item.type === 'specification' && !/^brand\s*:/i.test(item.value))
              .map((item) => item.value.trim());

            return {
              requirementId: product.id,
              product: product.value.trim(),
              brand,
              model,
              specifications,
            };
          });

        if (productItems.length === 0) {
          throw new ToolError(
            'CONFLICT',
            'Product research cannot start because no confirmed AI-extracted product requirements are available.',
          );
        }

        // Search each requested product independently. Include the exact model/part
        // number and technical specifications so generic brand queries cannot drown
        // out exact commercial product pages.
        const productQueries = productItems.map((item) => {
          const identity = [
            item.brand,
            item.model,
            item.product,
            ...item.specifications,
          ].filter(Boolean).join(' ');

          const commercial = [
            [item.model, item.brand, item.product, 'supplier Turkey'].filter(Boolean).join(' '),
            [item.model, item.brand, item.product, 'distributor Turkey'].filter(Boolean).join(' '),
            [item.model, item.brand, item.product, 'official distributor'].filter(Boolean).join(' '),
            [item.model, item.brand, item.product, 'manufacturer'].filter(Boolean).join(' '),
            [item.model, item.brand, 'supplier'].filter(Boolean).join(' '),
            [item.model, item.brand, 'distributor'].filter(Boolean).join(' '),
            [item.model, item.brand, 'official'].filter(Boolean).join(' '),
            identity,
            [item.brand, item.model, 'exact product'].filter(Boolean).join(' '),
            [item.brand, item.model, 'official website'].filter(Boolean).join(' '),
            [item.brand, item.model, 'Turkey'].filter(Boolean).join(' '),
            [item.brand, item.product, 'supplier Turkey'].filter(Boolean).join(' '),
            [item.brand, item.product, 'distributor Turkey'].filter(Boolean).join(' '),
            [item.product, 'manufacturer Turkey'].filter(Boolean).join(' '),
            [item.product, 'supplier Turkey'].filter(Boolean).join(' '),
            [item.brand, item.product, 'manufacturer distributor'].filter(Boolean).join(' '),
          ];

          return {
            requirementId: item.requirementId,
            product: item.product,
            brand: item.brand,
            model: item.model,
            specifications: item.specifications,
            queries: [...new Set(commercial.map((query) => query.trim()).filter(Boolean))],
          };
        });

        const queryJobs = productQueries.flatMap((item) =>
          item.queries.map((query) => ({ ...item, query })),
        );

        const resultBatches = await Promise.all(
          queryJobs.map((job) =>
            provider.search({ inquiryId, query: job.query, limit: 8 }).then((results) => ({ job, results })),
          ),
        );

        const resultMap = new Map<string, { result: ResearchResult; requirementId: string | null; product: string; query: string }>();
        for (const batch of resultBatches) {
          for (const result of batch.results) {
            if (!result.sourceUrl) continue;
            const key = `${batch.job.requirementId ?? batch.job.product}::${result.sourceUrl}`;
            if (!resultMap.has(key)) {
              resultMap.set(key, {
                result,
                requirementId: batch.job.requirementId,
                product: batch.job.product,
                query: batch.job.query,
              });
            }
          }
        }
        // Keep a fair evidence budget for every requested product. A global slice can
        // starve the second product when the first product returns many duplicates.
        const perRequirement = new Map<string, Array<{ result: ResearchResult; requirementId: string | null; product: string; query: string }>>();
        for (const entry of resultMap.values()) {
          const key = entry.requirementId ?? entry.product;
          const bucket = perRequirement.get(key) ?? [];
          if (bucket.length < 80) bucket.push(entry);
          perRequirement.set(key, bucket);
        }
        const balancedResults = [...perRequirement.values()].flat();
        const results = balancedResults.map((entry) => ({
          ...entry.result,
          structuredData: {
            ...(entry.result.structuredData ?? {}),
            arat_product: entry.product,
            arat_requirement_id: entry.requirementId,
            arat_query: entry.query,
          },
        }));

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

        let discovery = await enqueueWorkflow(inquiryId, 'supplier_discovery');

        // A previous discovery run may have completed successfully with zero
        // candidates. Reopen it after fresh research so the new evidence is
        // actually evaluated instead of enqueueWorkflow returning the old
        // succeeded execution unchanged.
        const previousCandidateCount = Number(
          (discovery.output_ref as { candidate_count?: number } | null)?.candidate_count ?? 0,
        );
        if (discovery.status === 'succeeded' && previousCandidateCount === 0) {
          const reopened = await supabase
            .from('ai_executions')
            .update({
              status: 'queued',
              error_code: null,
              error_message: null,
              completed_at: null,
              started_at: null,
            })
            .eq('id', discovery.id)
            .eq('status', 'succeeded')
            .select('*')
            .single();

          if (reopened.error || !reopened.data) {
            throw new ToolError(
              'CONFLICT',
              reopened.error?.message ?? 'Failed to requeue supplier discovery after fresh research',
            );
          }
          discovery = reopened.data;
        }

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
    // Recover the legacy Intake behavior where the AI execution was marked
    // successful even though it extracted zero procurement requirements.
    const { count: requirementCount, error: requirementCountError } = await supabase
      .from('requirements')
      .select('id', { count: 'exact', head: true })
      .eq('inquiry_id', inquiryId);

    if (requirementCountError) throw new ToolError('TRANSIENT', requirementCountError.message);

    if ((requirementCount ?? 0) === 0) {
      const { data: intakeExecution } = await supabase
        .from('ai_executions')
        .select('id,status')
        .eq('inquiry_id', inquiryId)
        .eq('task_key', `inquiry:${inquiryId}:stage:intake`)
        .maybeSingle();

      if (intakeExecution?.status === 'succeeded') {
        const { data: recoveredIntake, error: recoveryError } = await supabase
          .from('ai_executions')
          .update({
            status: 'queued',
            error_code: null,
            error_message: null,
            completed_at: null,
            started_at: null,
          })
          .eq('id', intakeExecution.id)
          .eq('status', 'succeeded')
          .select('*')
          .single();

        if (recoveryError || !recoveredIntake) {
          throw new ToolError('TRANSIENT', recoveryError?.message ?? 'Failed to requeue legacy Intake execution');
        }

        await timeline(inquiryId, 'workflow_intake_requeued_for_recovery', {
          execution_id: recoveredIntake.id,
          reason: 'intake_succeeded_with_zero_requirements',
        }, 'intake');

        return {
          execution: recoveredIntake,
          outcome: 'intake_requeued_for_recovery' as const,
        };
      }
    }

    // The document stage is already complete. If a downstream stage failed
    // before reaching the next stage, an Admin Start should recover that
    // queued workflow instead of becoming a no-op.
    const { data: failedDownstream } = await supabase
      .from('ai_executions')
      .select('id,task_key,status,attempt_count')
      .eq('inquiry_id', inquiryId)
      .eq('status', 'failed')
      .lt('attempt_count', 3)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (failedDownstream) {
      const match = failedDownstream.task_key.match(/^inquiry:[^:]+:stage:(.+)$/);
      const failedStage = match?.[1] as WorkflowStage | undefined;
      if (failedStage && stageAgentExists(failedStage)) {
        const { data: recovered, error: recoveryError } = await supabase
          .from('ai_executions')
          .update({
            status: 'queued',
            error_code: null,
            error_message: null,
            completed_at: null,
          })
          .eq('id', failedDownstream.id)
          .eq('status', 'failed')
          .select('*')
          .single();

        if (recoveryError || !recovered) {
          throw new ToolError('TRANSIENT', recoveryError?.message ?? 'Failed to requeue downstream workflow stage');
        }

        await timeline(inquiryId, 'workflow_stage_requeued', {
          execution_id: recovered.id,
          stage: failedStage,
          trigger,
        }, stageAgentForTimeline(failedStage));
      }
    }

    return {
      execution: existing.data,
      outcome: failedDownstream ? 'workflow_downstream_requeued' as const : 'workflow_already_started' as const,
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

      if (discovery?.status === 'queued' || discovery?.status === 'running') {
        const { data: researchExecution } = await supabase
          .from('ai_executions')
          .select('status')
          .eq('inquiry_id', inquiryId)
          .eq('task_key', `inquiry:${inquiryId}:stage:research`)
          .maybeSingle();

        if (researchExecution?.status === 'queued' || researchExecution?.status === 'running') {
          return runStage(inquiryId, 'research');
        }

        return runStage(inquiryId, 'supplier_discovery');
      }

      if (discovery?.status === 'succeeded') {
        const { data: finalized } = await supabase
          .from('supplier_candidates')
          .select('id,supplier_id')
          .eq('inquiry_id', inquiryId)
          .eq('status', 'finalized');

        if ((finalized ?? []).some((candidate) => candidate.supplier_id)) {
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

        const { data: discoveryExecution } = await supabase
          .from('ai_executions')
          .select('id,status,output_ref')
          .eq('inquiry_id', inquiryId)
          .eq('task_key', `inquiry:${inquiryId}:stage:supplier_discovery`)
          .maybeSingle();

        const candidateCount = Number((discoveryExecution?.output_ref as { candidate_count?: number } | null)?.candidate_count ?? 0);

        if (discoveryExecution?.status === 'succeeded' && candidateCount === 0) {
          const { data: researchExecution } = await supabase
            .from('ai_executions')
            .select('id,status,attempt_count')
            .eq('inquiry_id', inquiryId)
            .eq('task_key', `inquiry:${inquiryId}:stage:research`)
            .maybeSingle();

          // Supplier discovery can legitimately finish with zero candidates when
          // the research execution that produced its evidence failed part-way
          // through. In that case, do not surface the misleading
          // "no supplier candidate" error. Requeue the failed research execution
          // so the corrected research code can rebuild the evidence and then
          // supplier discovery will be reopened automatically by the research
          // stage.
          if (
            researchExecution?.id &&
            ['failed', 'succeeded'].includes(researchExecution.status)
          ) {
            const { error: requeueError } = await supabase
              .from('ai_executions')
              .update({
                status: 'queued',
                error_code: null,
                error_message: null,
                completed_at: null,
                started_at: null,
              })
              .eq('id', researchExecution.id)
              .in('status', ['failed', 'succeeded']);

            if (requeueError) {
              throw new ToolError(
                'TRANSIENT',
                requeueError.message ?? 'Failed to requeue product research',
              );
            }

            await timeline(inquiryId, 'workflow_research_requeued_after_supplier_discovery', {
              research_execution_id: researchExecution.id,
              previous_status: researchExecution.status,
              reason: 'supplier_discovery_completed_with_zero_candidates',
            }, 'product_research');

            return runStage(inquiryId, 'research');
          }
        }

        throw new ToolError('CONFLICT', 'Supplier discovery completed but no supplier candidate could be created');
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
