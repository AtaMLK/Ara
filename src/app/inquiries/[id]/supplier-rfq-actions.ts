'use server';

import { requireAdmin } from '@/lib/data/admin';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getEmailProvider } from '@/lib/email/provider';
import { ToolError } from '@/lib/errors';

function isDomestic(country: string | null | undefined) {
  const value = (country ?? '').trim().toLowerCase();
  return value === 'turkey' || value === 'türkiye' || value === 'tr' || value.includes('turkey');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char] ?? char));
}

function requirementItemIndex(sourceRef: string | null | undefined) {
  const match = sourceRef?.match(/intake:item:(\d+)/i);
  return match ? Number(match[1]) : null;
}

function buildEmail(
  language: 'tr' | 'en',
  inquiryReference: string,
  productLines: Array<{ product: string; model: string; quantity: string; specifications: string[] }>,
) {
  const rows = productLines.map((line, index) => {
    const details = [
      line.model ? `Model / Part Number: ${escapeHtml(line.model)}` : '',
      line.quantity ? `Quantity: ${escapeHtml(line.quantity)}` : '',
      ...line.specifications.map((item) => escapeHtml(item)),
    ].filter(Boolean);

    return language === 'tr'
      ? `<p><strong>${index + 1}. ${escapeHtml(line.product)}</strong><br/>${details.join('<br/>')}</p>`
      : `<p><strong>${index + 1}. ${escapeHtml(line.product)}</strong><br/>${details.join('<br/>')}</p>`;
  }).join('');

  const subject = language === 'tr'
    ? `Teklif Talebi – ${inquiryReference}`
    : `RFQ – ${inquiryReference}`;

  const html = language === 'tr'
    ? `<p>Merhaba,</p><p>Aşağıdaki ürün(ler) için fiyat teklifinizi ve teslim süresini paylaşmanızı rica ederiz.</p>${rows}<p>Lütfen birim fiyat, stok/uygunluk, teslim süresi, ödeme şartları ve teklif geçerlilik süresini belirtiniz.</p><p>İyi çalışmalar,<br/>Arya Automation</p>`
    : `<p>Dear Sir/Madam,</p><p>We would like to request your quotation for the following item(s).</p>${rows}<p>Please provide unit price, availability, delivery time, payment terms and quotation validity.</p><p>Best regards,<br/>Arya Automation</p>`;

  return { subject, html };
}

export async function sendSupplierRfqAction(input: {
  inquiryId: string;
  candidateIds: string[];
}) {
  const { user } = await requireAdmin();
  const admin = createSupabaseAdminClient();

  if (!input.candidateIds?.length) {
    throw new Error('Select at least one supplier.');
  }

  const { data: inquiry, error: inquiryError } = await admin
    .from('inquiries')
    .select('id,reference,title')
    .eq('id', input.inquiryId)
    .single();

  if (inquiryError || !inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');

  const { data: candidates, error: candidateError } = await admin
    .from('supplier_candidates')
    .select('id,requirement_id,status,supplier_id,proposed_name,proposed_country,suppliers(id,legal_name,primary_country,supplier_type,verification_status)')
    .eq('inquiry_id', input.inquiryId)
    .in('id', input.candidateIds);

  if (candidateError) throw new ToolError('TRANSIENT', candidateError.message);
  if (!candidates?.length) throw new Error('Selected supplier candidates were not found.');

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected = input.candidateIds.map((id) => candidateById.get(id)).filter(Boolean);

  const invalid = selected.filter((candidate) =>
    candidate.status !== 'finalized' ||
    !candidate.supplier_id ||
    !candidate.suppliers ||
    candidate.suppliers.verification_status !== 'verified',
  );
  if (invalid.length) {
    throw new Error('Only finalized and verified suppliers can receive an RFQ.');
  }

  const supplierIds = [...new Set(selected.map((candidate) => candidate.supplier_id).filter(Boolean))];

  const [{ data: emails }, { data: contacts }, { data: requirements }] = await Promise.all([
    admin.from('supplier_emails').select('supplier_id,email,is_primary,status').in('supplier_id', supplierIds).eq('status','active'),
    admin.from('supplier_contacts').select('id,supplier_id,name,email,phone,job_title,department,status,is_primary').in('supplier_id', supplierIds).eq('status','active'),
    admin.from('requirements').select('id,type,value,status,source_ref').eq('inquiry_id', input.inquiryId).eq('status','confirmed').order('created_at',{ascending:true}),
  ]);

  const provider = getEmailProvider();
  const results: Array<{ candidateId: string; supplierId: string; email: string; rfqId: string; providerMessageId?: string }> = [];

  for (const candidate of selected) {
    const supplierId = candidate.supplier_id!;
    const supplier = candidate.suppliers!;
    const contact = (contacts ?? []).find((item) => item.supplier_id === supplierId && item.email) ??
      (contacts ?? []).find((item) => item.supplier_id === supplierId && item.is_primary);
    const recipient = contact?.email ??
      (emails ?? []).find((item) => item.supplier_id === supplierId && item.is_primary)?.email ??
      (emails ?? []).find((item) => item.supplier_id === supplierId)?.email;

    if (!recipient) throw new Error(`No verified supplier email found for ${candidate.proposed_name}.`);

    const productRequirementId = candidate.requirement_id;
    const productRequirement = (requirements ?? []).find((item) => item.id === productRequirementId && item.type === 'product');

    if (!productRequirement) {
      throw new Error(`Supplier ${candidate.proposed_name} is not linked to a product requirement yet.`);
    }

    const itemIndex = requirementItemIndex(productRequirement.source_ref);
    const itemRequirements = (requirements ?? []).filter((item) => {
      const idx = requirementItemIndex(item.source_ref);
      return item.id === productRequirement.id || (itemIndex !== null && idx === itemIndex);
    });

    const product = productRequirement.value;
    const model = itemRequirements.find((item) => item.type === 'model_part_number')?.value ?? '';
    const quantityRow = itemRequirements.find((item) => item.type === 'quantity')?.value ?? '';
    const specifications = itemRequirements.filter((item) => item.type === 'specification').map((item) => item.value);

    const domestic = isDomestic(supplier.primary_country || candidate.proposed_country);
    const language = domestic ? 'tr' : 'en';
    const email = buildEmail(language, inquiry.reference, [{
      product,
      model,
      quantity: quantityRow,
      specifications,
    }]);

    const { data: rfq, error: rfqError } = await admin.from('rfqs').insert({
      inquiry_id: inquiry.id,
      supplier_id: supplierId,
      status: 'pending_approval',
      subject: email.subject,
      body: email.html,
      sender_email: process.env.SMTP_FROM || process.env.SMTP_USER || null,
      recipient_email: recipient,
      approval_required: true,
    }).select('id').single();

    if (rfqError || !rfq) throw new ToolError('TRANSIENT', rfqError?.message ?? 'Could not create RFQ');

    const { error: itemError } = await admin.from('rfq_items').insert({
      rfq_id: rfq.id,
      requirement_id: productRequirement.id,
      requested_quantity: quantityRow ? Number.parseFloat(quantityRow) || null : null,
      requested_data: {
        product,
        model,
        specifications,
        language,
        contact_id: contact?.id ?? null,
        department: contact?.department ?? null,
      },
    });
    if (itemError) throw new ToolError('TRANSIENT', itemError.message);

    const { data: communication, error: communicationError } = await admin.from('communications').insert({
      inquiry_id: inquiry.id,
      supplier_id: supplierId,
      rfq_id: rfq.id,
      direction: 'outgoing',
      channel: 'email',
      subject: email.subject,
      body: email.html,
      metadata: {
        language,
        candidate_id: candidate.id,
        requirement_id: productRequirement.id,
        contact_id: contact?.id ?? null,
      },
    }).select('id').single();

    if (communicationError || !communication) throw new ToolError('TRANSIENT', communicationError?.message ?? 'Could not create communication');

    // Explicit admin action has already happened in the UI. The RFQ is now sent.
    const sent = await provider.send({
      to: [recipient],
      subject: email.subject,
      html: email.html,
      text: email.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'purchase-dep@aryaautomation.com',
      idempotencyKey: `rfq:${rfq.id}`,
    });

    await admin.from('communications').update({
      provider_message_id: sent.providerMessageId ?? null,
      thread_id: sent.threadId ?? null,
      sent_at: sent.sentAt ?? new Date().toISOString(),
    }).eq('id', communication.id);

    await admin.from('rfqs').update({
      status: 'sent',
      sent_at: sent.sentAt ?? new Date().toISOString(),
    }).eq('id', rfq.id);

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
        requirement_id: productRequirement.id,
        language,
        recipient,
      },
    });

    results.push({
      candidateId: candidate.id,
      supplierId,
      email: recipient,
      rfqId: rfq.id,
      providerMessageId: sent.providerMessageId,
    });
  }

  return { ok: true, results };
}
