'use server';
import {getSupplierLanguage} from '@/lib/email/supplier-language';

import {createHash} from 'node:crypto';
import {getInquiryDisplayReference} from '@/lib/ui/inquiry-reference';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/ai/guards';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getEmailProvider } from '@/lib/email/provider';
import { ToolError } from '@/lib/errors';
import { oneRelated } from '@/lib/data/relations';
import { recordVerifiedSupplierBrands } from '@/lib/ai/supplier-brand-routes';
import { productBrand,isExclusiveBrand,isAryaWebsite } from '@/lib/ai/supplier-policy';



function candidateEvidenceEmail(...roots: unknown[]): string | null {
  const seen = new Set<object>();
  const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

  function walk(value: unknown, depth = 0): string | null {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value as object)) return null;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of ['email', 'contact_email', 'sales_email', 'email_address', 'public_email']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && emailPattern.test(candidate.trim())) return candidate.trim().toLowerCase();
    }
    for (const child of Object.values(record)) {
      const found = walk(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const root of roots) {
    const found = walk(root);
    if (found) return found;
  }
  return null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char] ?? char));
}

function buildEmail(
  language: 'tr' | 'en',
  inquiryReference: string,
  productLines: Array<{ product: string; model: string; quantity: string; specifications: string[] }>,
) {
  const rows = productLines.map((line, index) => {
    const details = [
      line.model ? `<strong>Model:</strong> ${escapeHtml(line.model)}` : '',
      line.quantity ? `<strong>${language === 'tr' ? 'Miktar' : 'Quantity'}:</strong> ${escapeHtml(line.quantity)}` : '',
      ...line.specifications.map((item) => {
        return escapeHtml(item);
      }),
    ].filter(Boolean);

    return `<p><strong>${index + 1}. ${escapeHtml(line.product)}</strong><br/>${details.join('<br/>')}</p>`;
  }).join('');

  const subject = language === 'tr'
    ? `Fiyat Teklifi Talebi | ${inquiryReference}`
    : `Request for Quotation | ${inquiryReference}`;

  const html = language === 'tr'
    ? `<p>Merhaba,</p><p>Aşağıdaki ürün için fiyat teklifinizi rica ederiz.</p>${rows}<p>Teklifinizde birim fiyatı, mevcut stok/tedarik durumunu ve tahmini teslim süresini belirtmenizi rica ederiz.</p><p>Teşekkür eder, iyi çalışmalar dileriz.<br/>Arya Automation</p>`
    : `<p>Dear Sales Team,</p><p>Please provide your quotation for the following item:</p>${rows}<p>Kindly include your unit price, current availability and estimated lead time.</p><p>Thank you for your support.<br/>Best regards,<br/>Arya Automation</p>`;

  return { subject, html };
}

export async function verifySupplierCandidateAction(input: { inquiryId: string; candidateId: string }) {
  const { user } = await requireAdmin();
  const admin = createSupabaseAdminClient();

  const { data: candidate, error: candidateError } = await admin
    .from('supplier_candidates')
    .select('id,inquiry_id,supplier_id,status,proposed_name,verification_evidence')
    .eq('id', input.candidateId)
    .eq('inquiry_id', input.inquiryId)
    .single();

  if (candidateError || !candidate) throw new ToolError('NOT_FOUND', 'Supplier candidate not found');
  if (!candidate.supplier_id) throw new Error('This candidate has no supplier record yet.');
  if (['admin_removed', 'admin_rejected'].includes(candidate.status)) throw new ToolError('CONFLICT', 'Removed or rejected candidates cannot be verified');

  const { data: supplier, error: supplierError } = await admin
    .from('suppliers')
    .select('id,legal_name,verification_status')
    .eq('id', candidate.supplier_id)
    .single();

  if (supplierError || !supplier) throw new ToolError('NOT_FOUND', 'Supplier record not found');

  const now = new Date().toISOString();

  if (supplier.verification_status !== 'verified') {
    const { error: supplierUpdateError } = await admin
      .from('suppliers')
      .update({
        verification_status: 'verified',
        last_verified_at: now,
        updated_at: now,
      })
      .eq('id', supplier.id);

    if (supplierUpdateError) throw new ToolError('TRANSIENT', supplierUpdateError.message);
  }

  const { error: candidateUpdateError } = await admin
    .from('supplier_candidates')
    .update({
      status: 'finalized',
      verification_evidence: {
        ...((candidate.verification_evidence ?? {}) as Record<string, unknown>),
        verified_by: user.id,
        verified_at: now,
        verification_status: 'verified',
      },
      updated_at: now,
    })
    .eq('id', candidate.id);

  if (candidateUpdateError) throw new ToolError('TRANSIENT', candidateUpdateError.message);
  const { error: historyError } = await admin.from('supplier_verification_history').insert({
    supplier_id: supplier.id, old_status: supplier.verification_status, new_status: 'verified',
    reason: 'Admin verified the supplier candidate', changed_by: user.id,
  });
  if (historyError) throw new ToolError('TRANSIENT', historyError.message);
  await recordVerifiedSupplierBrands(admin,input.inquiryId);

  await admin.from('timeline_events').insert({
    inquiry_id: input.inquiryId,
    event_type: 'supplier_verified',
    visibility: 'admin',
    actor_type: 'admin',
    actor_user_id: user.id,
    metadata: {
      candidate_id: candidate.id,
      supplier_id: supplier.id,
      supplier_name: supplier.legal_name,
      previous_verification_status: supplier.verification_status,
    },
  });

  // Verification is the explicit gate between supplier discovery and RFQ.
  // Move the inquiry into RFQ state without restarting any previous workflow stage.
  const { error: statusError } = await admin
    .from('inquiries')
    .update({ status: 'rfq', updated_at: now })
    .eq('id', input.inquiryId)
    .in('status', ['researching', 'rfq']);

  if (statusError) throw new ToolError('TRANSIENT', statusError.message);

  // Verification is persisted in Supabase. Revalidate the inquiry page so returning
  // to the page always reflects the persisted supplier/candidate state.
  revalidatePath(`/inquiries/${input.inquiryId}`);
  revalidatePath('/inquiries');

  return { ok: true, supplierId: supplier.id, candidateId: candidate.id };
}

export async function getSupplierRfqRecipientsAction(input: { inquiryId: string; candidateIds: string[] }) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  if (!input.candidateIds?.length) return { recipients: [] as Array<{ candidateId: string; email: string }> };

  const { data: candidates, error: candidateError } = await admin
    .from('supplier_candidates')
    .select('id,supplier_id,match_evidence,verification_evidence')
    .eq('inquiry_id', input.inquiryId)
    .in('id', input.candidateIds);

  if (candidateError) throw new ToolError('TRANSIENT', candidateError.message);

  const supplierIds = [...new Set((candidates ?? []).map((item) => item.supplier_id).filter(Boolean))] as string[];
  if (!supplierIds.length) return { recipients: [] as Array<{ candidateId: string; email: string }> };

  const [{ data: emails }, { data: contacts }] = await Promise.all([
    admin.from('supplier_emails').select('supplier_id,email,is_primary,status').in('supplier_id', supplierIds).eq('status', 'active'),
    admin.from('supplier_contacts').select('supplier_id,email,is_primary,status').in('supplier_id', supplierIds).eq('status', 'active'),
  ]);

  const recipients = (candidates ?? []).flatMap((candidate) => {
    if (!candidate.supplier_id) return [];
    const contact = (contacts ?? []).find((item) => item.supplier_id === candidate.supplier_id && item.email)
      ?? (contacts ?? []).find((item) => item.supplier_id === candidate.supplier_id && item.is_primary && item.email);
    const email = contact?.email
      ?? (emails ?? []).find((item) => item.supplier_id === candidate.supplier_id && item.is_primary)?.email
      ?? (emails ?? []).find((item) => item.supplier_id === candidate.supplier_id)?.email
      ?? candidateEvidenceEmail(candidate.match_evidence, candidate.verification_evidence);
    return email ? [{ candidateId: candidate.id, email }] : [];
  });

  return { recipients };
}

type RfqPreview={candidateId:string;candidateIds:string[];recipient:string;subject:string;html:string;language:'tr'|'en';rfqCode:string;fingerprint:string};
export async function getSupplierRfqPreviewAction(input:{inquiryId:string;candidateIds:string[]}) {return executeSupplierRfq(input,true);}
export async function sendSupplierRfqAction(input:{inquiryId:string;candidateIds:string[];previews?:RfqPreview[]}) {return executeSupplierRfq(input,false);}
async function executeSupplierRfq(input: {
  inquiryId: string;
  candidateIds: string[];
  previews?:RfqPreview[];
},previewOnly:boolean) {  const { user } = await requireAdmin();
  const admin = createSupabaseAdminClient();

  if (!input.candidateIds?.length) {
    throw new Error('Select at least one supplier.');
  }

  const { data: inquiry, error: inquiryError } = await admin
    .from('inquiries')
    .select('id,reference,title,status,created_at,current_version,updated_at')
    .eq('id', input.inquiryId)
    .single();

  if (inquiryError || !inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');
  if(['converted','closed','no_suitable_supplier'].includes(inquiry.status))throw new ToolError('CONFLICT','This inquiry is complete and cannot send new RFQs.');

  const { data: candidates, error: candidateError } = await admin
    .from('supplier_candidates')
    .select('id,requirement_id,status,supplier_id,proposed_name,proposed_country,proposed_website,match_evidence,verification_evidence,suppliers(id,legal_name,primary_country,supplier_type,verification_status)')
    .eq('inquiry_id', input.inquiryId)
    .in('id', input.candidateIds);

  if (candidateError) throw new ToolError('TRANSIENT', candidateError.message);
  if (!candidates?.length) throw new Error('Selected supplier candidates were not found.');

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, { ...candidate, suppliers: oneRelated(candidate.suppliers) }]));
  const selected = [...new Set(input.candidateIds)].map((id) => {
    const candidate = candidateById.get(id);
    if (!candidate) throw new ToolError('NOT_FOUND', 'One or more selected candidates do not belong to this inquiry');
    return candidate;
  });

  const invalid = selected.filter((candidate) => {
    const evidence = (candidate.verification_evidence ?? {}) as Record<string, unknown>;
    return candidate.status !== 'finalized' ||
      !candidate.supplier_id ||
      !candidate.suppliers ||
      candidate.suppliers.verification_status !== 'verified' ||
      evidence.rfq_sent === true;
  });
  if (invalid.length) {
    throw new Error('Only finalized and verified suppliers can receive an RFQ.');
  }

  const supplierIds = [...new Set(selected.map((candidate) => candidate.supplier_id).filter(Boolean))];

  const [{ data: emails }, { data: contacts }, { data: requirements }] = await Promise.all([
    admin.from('supplier_emails').select('supplier_id,email,is_primary,status').in('supplier_id', supplierIds).eq('status','active'),
    admin.from('supplier_contacts').select('id,supplier_id,name,email,phone,job_title,department,status,is_primary').in('supplier_id', supplierIds).eq('status','active'),
    admin.from('requirements').select('id,type,value,status,source_ref').eq('inquiry_id', input.inquiryId).eq('status','confirmed').order('created_at',{ascending:true}),
  ]);
  for(const candidate of selected) {
    const product=(requirements ?? []).find(row=>row.id===candidate.requirement_id);
    if(product && isExclusiveBrand(productBrand(product,requirements ?? [])) && !isAryaWebsite(candidate.proposed_website)) throw new ToolError('CONFLICT','Only Arya Automation can supply this brand under the exclusive distributor rule.');
  }
  const supplierGroups=new Map<string,typeof selected>();
  for(const candidate of selected) {const group=supplierGroups.get(candidate.supplier_id!) ?? [];group.push(candidate);supplierGroups.set(candidate.supplier_id!,group);}

  if(!previewOnly){
    if(input.previews?.length!==supplierGroups.size)throw new ToolError('APPROVAL_REQUIRED','Review every selected supplier message before sending.');
    const current=await executeSupplierRfq(input,true);
    if(current.previews.some(message=>input.previews?.find(reviewed=>reviewed.candidateId===message.candidateId)?.fingerprint!==message.fingerprint))throw new ToolError('CONFLICT','Supplier details or request requirements changed. Open the message preview again before sending.');
  }
  const provider = previewOnly?null:getEmailProvider();
  const previews:RfqPreview[]=[];
  const results: Array<{ candidateId: string; candidateIds:string[]; supplierId: string; email: string; rfqId: string; providerMessageId?: string }> = [];

  for (const unsortedGroup of supplierGroups.values()) {
    const group=[...unsortedGroup].sort((a,b)=>(requirements ?? []).findIndex(row=>row.id===a.requirement_id)-(requirements ?? []).findIndex(row=>row.id===b.requirement_id) || String(a.id).localeCompare(String(b.id)));
    const candidate=group[0];
    const candidateIds=group.map(row=>row.id);
    const supplierId = candidate.supplier_id!;
    const supplier = candidate.suppliers!;
    const contact = (contacts ?? []).find((item) => item.supplier_id === supplierId && item.email) ??
      (contacts ?? []).find((item) => item.supplier_id === supplierId && item.is_primary);
    const recipient = contact?.email ??
      (emails ?? []).find((item) => item.supplier_id === supplierId && item.is_primary)?.email ??
      (emails ?? []).find((item) => item.supplier_id === supplierId)?.email ??
      candidateEvidenceEmail(candidate.match_evidence, candidate.verification_evidence);

    if (!recipient) throw new Error(`No public email was found for ${candidate.proposed_name}. Open the supplier website/contact page and add a verified email before sending the RFQ.`);

    // If discovery captured a public email in candidate evidence but failed to
    // normalize it into supplier_emails, repair that data gap before proceeding.
    const knownEmail = (emails ?? []).some((item) => item.supplier_id === supplierId && item.email?.toLowerCase() === recipient.toLowerCase());
    if (!knownEmail&&!previewOnly) {
      const { data: existingPrimary } = await admin.from('supplier_emails')
        .select('id').eq('supplier_id', supplierId).eq('is_primary', true).maybeSingle();
      const { data: savedEmail, error: saveEmailError } = await admin.from('supplier_emails').insert({
        supplier_id: supplierId,
        email: recipient.toLowerCase(),
        is_primary: !existingPrimary,
        status: 'active',
      }).select('id').single();
      if (saveEmailError || !savedEmail) {
        throw new ToolError('TRANSIENT', saveEmailError?.message ?? 'Could not save discovered supplier email');
      }
      if (!existingPrimary) {
        await admin.from('suppliers').update({ primary_email_id: savedEmail.id }).eq('id', supplierId);
      }
    }

    const productLines=group.map(item=>{
    const productRequirementId = item.requirement_id;
    const productRequirement = (requirements ?? []).find((item) => item.id === productRequirementId && item.type === 'product');

    if (!productRequirement) {
      throw new Error(`Supplier ${candidate.proposed_name} is not linked to a product requirement yet.`);
    }

    const itemRequirements = (requirements ?? []).filter((item) => {
      return item.id === productRequirement.id || (Boolean(productRequirement.source_ref) && item.source_ref === productRequirement.source_ref);
    });

    const product = productRequirement.value;
    const model = itemRequirements.filter((item) => item.type === 'model_part_number').map((item) => item.value).join(' / ');
    const quantityRow = itemRequirements.find((item) => item.type === 'quantity')?.value ?? '';
    const specifications = itemRequirements.filter((item) => item.type === 'specification' || item.type === 'delivery' || item.type === 'other').map((item) => item.value);
    return {requirementId:productRequirement.id,product,model,quantity:quantityRow,specifications};
    }).filter((line,index,rows)=>rows.findIndex(other=>other.requirementId===line.requirementId)===index);
    const firstLine=productLines[0];

    const language = await getSupplierLanguage(supplier.id);
    const email = buildEmail(language, getInquiryDisplayReference(inquiry.reference,null,inquiry.created_at), productLines);

    const reviewed=input.previews?.find(preview=>preview.candidateId===candidate.id);
    const rfqCode = reviewed?.rfqCode??`RFQ-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
    const subject = language === 'tr'
      ? `Teklif Talebi | ${getInquiryDisplayReference(inquiry.reference,null,inquiry.created_at)} | ${rfqCode}`
      : `RFQ | ${getInquiryDisplayReference(inquiry.reference,null,inquiry.created_at)} | ${rfqCode}`;

    if(!/^RFQ-\d{8}-[A-Z0-9]{6}$/.test(rfqCode))throw new ToolError('VALIDATION','Invalid RFQ preview reference.');
    const fingerprint=createHash('sha256').update(JSON.stringify([candidateIds,recipient,subject,email.html])).digest('hex');
    previews.push({candidateId:candidate.id,candidateIds,recipient,subject,html:email.html,language,rfqCode,fingerprint});
    if(previewOnly)continue;
    if(!reviewed||reviewed.fingerprint!==fingerprint)throw new ToolError('CONFLICT','Supplier details or request requirements changed. Open the message preview again before sending.');

    // A partially recorded/uncertain send must not be bypassed by making a new
    // RFQ ID from another preview for the same supplier and requested product.
    const {data:priorRfqs,error:priorError}=await admin.from('rfqs').select('id')
      .eq('inquiry_id',inquiry.id).eq('supplier_id',supplierId)
      .in('status',['pending_approval','approved','sent','completed']);
    if(priorError)throw new ToolError('TRANSIENT','RFQ history could not be checked. No email was sent.');
    if(priorRfqs?.length){
      const {data:priorItem,error:priorItemError}=await admin.from('rfq_items').select('id')
        .in('rfq_id',priorRfqs.map(row=>row.id)).in('requirement_id',productLines.map(line=>line.requirementId)).limit(1).maybeSingle();
      if(priorItemError)throw new ToolError('TRANSIENT','RFQ item history could not be checked. No email was sent.');
      if(priorItem)throw new ToolError('CONFLICT','An RFQ already exists for this supplier and requested product. Review its delivery history before creating another.');
    }

    const { data: rfq, error: rfqError } = await admin.from('rfqs').insert({
      inquiry_id: inquiry.id,
      supplier_id: supplierId,
      rfq_code: rfqCode,
      status: 'approved',
      approved_by:user.id,
      approved_at:new Date().toISOString(),
      subject,
      body: email.html,
      sender_email: process.env.SMTP_FROM || process.env.SMTP_USER || null,
      recipient_email: recipient,
      approval_required: true,
    }).select('id').single();

    if (rfqError || !rfq) throw new ToolError('TRANSIENT', rfqError?.message ?? 'Could not create RFQ');

    const { error: itemError } = await admin.from('rfq_items').insert(productLines.map(line=>({
      rfq_id: rfq.id,
      requirement_id: line.requirementId,
      requested_quantity: line.quantity ? Number.parseFloat(line.quantity) || null : null,
      requested_data: {
        product:line.product,
        model:line.model,
        specifications:line.specifications,
        language,
        contact_id: contact?.id ?? null,
        department: contact?.department ?? null,
      },
    })));
    if (itemError) throw new ToolError('TRANSIENT', itemError.message);

    const { data: communication, error: communicationError } = await admin.from('communications').insert({
      inquiry_id: inquiry.id,
      supplier_id: supplierId,
      rfq_id: rfq.id,
      direction: 'outgoing',
      channel: 'email',
      subject,
      body: email.html,
      metadata: {
        language,
        candidate_id: candidate.id,
        requirement_id: firstLine.requirementId,
        requirement_ids: productLines.map(line=>line.requirementId),
        candidate_ids:candidateIds,
        contact_id: contact?.id ?? null,
      },
    }).select('id').single();

    if (communicationError || !communication) throw new ToolError('TRANSIENT', communicationError?.message ?? 'Could not create communication');

    // Explicit admin action has already happened in the UI. The RFQ is now sent.
    let sent;
    try {
      sent = await provider!.send({
        to: [recipient],
        subject,
        html: email.html,
        text: email.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        from: process.env.SMTP_FROM || process.env.SMTP_USER || 'purchase-dep@aryaautomation.com',
        idempotencyKey: `rfq-${rfq.id}`,
        inquiryId:inquiry.id,
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      await admin.from('communications').update({
        metadata: {
          language,
          candidate_id: candidate.id,
          requirement_id: firstLine.requirementId,
          contact_id: contact?.id ?? null,
          delivery_uncertain: true,
          candidate_ids:candidateIds,
          requirement_ids:productLines.map(line=>line.requirementId),
          send_error: message.slice(0, 2000),
        },
      }).eq('id', communication.id);
      await admin.from('ai_alerts').insert({inquiry_id:inquiry.id,record_type:'rfq',record_id:rfq.id,
        agent_id:'rfq',alert_type:'RFQ_DELIVERY_CHECK_REQUIRED',priority:'urgent',
        message:`Check delivery to ${recipient} before any resend or cancellation. ${message}`});
      throw new Error(`RFQ delivery to ${recipient} needs checking. Review the sent mailbox before any resend: ${message}`);
    }

    await admin.from('communications').update({
      provider_message_id: sent.providerMessageId ?? null,
      thread_id: sent.threadId ?? null,
      sent_at: sent.sentAt ?? new Date().toISOString(),
    }).eq('id', communication.id);

    const sentAt = sent.sentAt ?? new Date().toISOString();

    await admin.from('rfqs').update({
      status: 'sent',
      sent_at: sentAt,
    }).eq('id', rfq.id);

    // Persist the successful send on the candidate itself. This makes the UI
    // authoritative after refresh and prevents the same candidate from being
    // accidentally emailed twice.
    for(const item of group) {
    const currentEvidence = (item.verification_evidence ?? {}) as Record<string, unknown>;
    await admin.from('supplier_candidates').update({
      verification_evidence: {
        ...currentEvidence,
        rfq_sent: true,
        rfq_sent_at: sentAt,
        rfq_id: rfq.id,
        rfq_recipient: recipient,
      },
      updated_at: sentAt,
    }).eq('id', item.id);
    }

    await admin.from('timeline_events').insert({
      inquiry_id: inquiry.id,
      event_type: 'supplier_rfq_sent',
      visibility: 'admin',
      actor_type: 'admin',
      actor_user_id: user.id,
      metadata: {
        rfq_id: rfq.id,
        candidate_id: candidate.id,
        supplier_id: supplierId,
        requirement_ids: productLines.map(line=>line.requirementId),
        candidate_ids:candidateIds,
        language,
        recipient,
      },
    });

    await admin.from('inquiries').update({status:'rfq'}).eq('id',inquiry.id).in('status',['processing','open','clarification_required','researching','rfq']);

    results.push({
      candidateId: candidate.id,
      candidateIds,
      supplierId,
      email: recipient,
      rfqId: rfq.id,
      providerMessageId: sent.providerMessageId,
    });
  }

  revalidatePath(`/inquiries/${input.inquiryId}`);
  revalidatePath('/rfqs');
  revalidatePath('/suppliers');

  return { ok: true, results,previews };
}
