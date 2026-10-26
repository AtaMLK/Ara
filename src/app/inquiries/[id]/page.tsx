import {T,DateText} from '@/components/language';
import SupplierSenderNotice from '@/components/supplier-sender-notice';
import {readableRequest} from '@/lib/ui/inquiry-items';
import AutomationIssues from './automation-issues';
import AutomationRefresh from '@/components/automation-refresh';
import RequestItems from '@/components/request-items';
import {loadInquiryProgress} from '@/lib/data/inquiry-progress';
import { oneRelated } from '@/lib/data/relations';
import Link from 'next/link';
import AdminActivityTimeline from './admin-activity-timeline';
import AdminFilePreview from './admin-file-preview';
import { getInquiryDisplayReference } from '@/lib/ui/inquiry-reference';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/data/admin';
import { InquiryEditForm } from './edit-form';
import { RequirementEdit } from './requirement-edit';
import { CandidatePanel } from './candidate-panel';
import { getSupplierReviewProgress } from '@/lib/ai/supplier-review';
import InquiryProcess, { type InquiryProcessStep } from '@/components/inquiry-process';
import { approveSupplierClarificationReplyAction } from './supplier-clarification-actions';

type Props = { params: Promise<{ id: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function InquiryDetailPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await requireAdminPage();

  const [inquiryResult, requirementsResult, filesResult, timelineResult, executionsResult, alertsResult, clarificationsResult, researchResult, candidatesResult, rfqsResult, communicationsResult] = await Promise.all([
    supabase.from('inquiries').select('id,reference,title,description,status,priority,original_customer_text,normalized_information,current_version,created_at,updated_at,customers(name,company_name,email,country)').eq('id', id).single(),
    supabase.from('requirements').select('id,type,value,status,source,source_ref,admin_edited,updated_at').eq('inquiry_id', id).order('created_at', { ascending: true }),
    supabase.from('inquiry_files').select('id,original_name,mime_type,file_size,status,version,uploaded_at,processed_at').eq('inquiry_id', id).order('uploaded_at', { ascending: false }),
    supabase.from('timeline_events').select('id,event_type,visibility,actor_type,agent_id,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(30),
    supabase.from('ai_executions').select('id,task_key,agent_id,status,attempt_count,error_code,error_message,started_at,completed_at,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('ai_alerts').select('id,agent_id,alert_type,message,priority,status,created_at').eq('inquiry_id', id).eq('status', 'open').order('created_at', { ascending: false }).limit(10),
    supabase.from('clarifications').select('id,requirement_id,question,status,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }),
    supabase.from('research_cases').select('id,status,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(5),
    supabase.from('supplier_candidates').select('id,requirement_id,proposed_name,proposed_country,proposed_website,status,match_evidence,availability_evidence,verification_evidence,created_at,supplier_id,suppliers(id,legal_name,primary_country,supplier_type,verification_status,primary_address_id,primary_phone_id,primary_website_id,primary_email_id,supplier_contacts!supplier_contacts_supplier_id_fkey(id,name,email,phone,job_title,department,professional_profile,status,is_primary),supplier_emails!supplier_emails_supplier_id_fkey(email,is_primary,status),supplier_addresses!supplier_addresses_supplier_id_fkey(id,address,is_primary),supplier_phones!supplier_phones_supplier_id_fkey(id,phone,is_primary,status),supplier_websites!supplier_websites_supplier_id_fkey(id,url,is_primary))').eq('inquiry_id', id).order('created_at', { ascending: true }),
    supabase.from('rfqs').select('id,status,subject,recipient_email,sender_email,approval_required,created_at,sent_at,suppliers(legal_name)').eq('inquiry_id', id).order('created_at', { ascending: false }),
    supabase.from('communications').select('id,direction,channel,subject,body,received_at,sent_at,created_at,supplier_id,customer_id,rfq_id,metadata,suppliers(legal_name)').eq('inquiry_id', id).eq('channel', 'email').order('created_at', { ascending: false }).limit(100),
  ]);

  if (inquiryResult.error || !inquiryResult.data) notFound();
  if (requirementsResult.error || filesResult.error || timelineResult.error || executionsResult.error || alertsResult.error || clarificationsResult.error || researchResult.error || candidatesResult.error || rfqsResult.error || communicationsResult.error) throw new Error('Failed to load inquiry details');

  const inquiry = inquiryResult.data;
  const supplierReviewProgress=await getSupplierReviewProgress(id);
  const customer = oneRelated(inquiry.customers);
  const customerName = customer?.company_name || customer?.name || 'Customer';
  const displayReference = getInquiryDisplayReference(inquiry.reference, customerName, inquiry.created_at, inquiry.current_version, inquiry.updated_at);

  const communications = communicationsResult.data ?? [];
  const supplierMessages = communications.filter((item) => item.supplier_id && item.direction === 'incoming');
  const supplierReplyCount = supplierMessages.filter((item) => {
    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : {};
    return metadata.type === 'supplier_rfq_reply';
  }).length;
  const supplierAskedForInfo = supplierMessages.some((item) => {
    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : {};
    const analysis = metadata.ai_analysis && typeof metadata.ai_analysis === 'object' && !Array.isArray(metadata.ai_analysis) ? metadata.ai_analysis as Record<string, unknown> : {};
    const body = String(item.body ?? '').toLowerCase();
    const explicitAiRequest = metadata.type === 'supplier_rfq_reply' && analysis.customerActionRequired === true;
    const clarificationLanguage = /(?:özelliklerle ilgili detaylı bilgi|detaylı bilgi rica|teknik bilgi|datasheet|specification|technical information|additional information|more information)/i.test(body);
    return explicitAiRequest || clarificationLanguage;
  });
  const clarificationSentToCustomer = communications.some((item) => {
    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : {};
    return metadata.type === 'supplier_clarification_to_customer';
  });
  const customerClarificationReply = communications.some((item) => {
    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : {};
    return metadata.type === 'customer_clarification_reply';
  });
  const hasClarification = (clarificationsResult.data ?? []).some((item) => ['sent', 'pending_approval', 'draft'].includes(item.status));
  const hasCompletedResearch = (researchResult.data ?? []).some((item) => item.status === 'completed');
  const hasVerifiedSupplier = (candidatesResult.data ?? []).some((item) => item.supplier_id && oneRelated(item.suppliers)?.verification_status === 'verified');
  const hasSentRfq = (rfqsResult.data ?? []).some((item) => item.status === 'sent' || item.sent_at);
  const progress=await loadInquiryProgress(id);


  return (
    <>
      <AutomationRefresh enabled={!['closed','no_suitable_supplier'].includes(inquiry.status)&&progress.label!=='Completed'}/>
      <header className="topbar">
        <div>
          <Link className="back-icon-button" href="/inquiries" aria-label="Back to Inquiries" title="Back to Inquiries"><span aria-hidden="true">←</span></Link>
          <div className="eyebrow"><T>INQUIRY</T></div>
          <h1 className="title inquiry-display-reference">{displayReference}</h1>
          <div className="muted">{inquiry.title}</div>
        </div>
        <div className="topbar-actions"><span className={`badge status-badge status-${inquiry.status}`}>{progress.label}</span><InquiryEditForm inquiryId={inquiry.id} title={inquiry.title} description={inquiry.description ?? ""} version={inquiry.current_version} /></div>
      </header>

      <InquiryProcess steps={progress.steps} eyebrow="PROCUREMENT PROCESS" />
      {!['converted','closed','no_suitable_supplier'].includes(inquiry.status)&&<AutomationIssues inquiryId={id} failures={(executionsResult.data??[]).filter(execution=>execution.status==='failed')}
        warnings={(alertsResult.data??[]).filter(alert=>['ATTACHMENT_REQUIRES_OCR','DOCUMENT_PROCESSING_FAILED','WORKFLOW_START_FAILED'].includes(alert.alert_type))}/>}

      <CandidatePanel inquiryId={inquiry.id} requirements={requirementsResult.data ?? []} candidates={(candidatesResult.data ?? []).map((row) => ({ ...row, suppliers: oneRelated(row.suppliers) }))} reviewProgress={supplierReviewProgress} />

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow"><T>EMAIL</T></div>
            <h2 id="email-center"><T>Email Center</T></h2>
            <div className="muted"><T>All customer and supplier email activity for this inquiry. Supplier email content is visible only in the Admin portal.</T></div>
          </div>
          <span className="badge">{communicationsResult.data?.length ?? 0}<T> emails</T></span>
        </div>
        {(communicationsResult.data ?? []).length === 0 ? (
          <div className="detail-card"><div className="empty"><T>No emails have been received or sent for this inquiry yet.</T></div></div>
        ) : (
          <div className="email-center-list">
            {(communicationsResult.data ?? []).map((email) => {
              const metadata = email.metadata && typeof email.metadata === 'object' && !Array.isArray(email.metadata) ? email.metadata as Record<string, unknown> : {};
              const incoming = email.direction === 'incoming';
              const type = typeof metadata.type === 'string' ? metadata.type : '';
              const tone = incoming ? 'info' : 'neutral';
              const labelText = type === 'supplier_rfq_reply' ? 'Supplier reply' : type === 'customer_clarification_reply' ? 'Customer reply' : type === 'clarification' ? 'Clarification sent' : incoming ? 'Incoming email' : 'Outgoing email';
              return (
                <article className="email-center-item" key={email.id}>
                  <div className="email-center-head">
                    <div>
                      <span className={`email-status-dot email-status-${tone}`} aria-hidden="true" />
                      <strong><T>{labelText}</T></strong>
                      {oneRelated(email.suppliers)?.legal_name && <span className="muted"> · {oneRelated(email.suppliers)?.legal_name}</span>}
                    </div>
                    <span className="muted"><DateText value={email.received_at ?? email.sent_at ?? email.created_at} format="datetime"/></span>
                  </div>
                  <div className="email-center-subject">{email.subject ||<T>{'(No subject)'}</T>}</div>
                  <div className="email-center-meta"><T>{incoming ? 'Received' : 'Sent'}</T> · {email.channel}</div>
                  {incoming && type==='supplier_rfq_reply' && <SupplierSenderNotice metadata={metadata}/>}
                  <div className="email-center-body">{readableRequest(email.body)||<T>{'No message body recorded.'}</T>}</div>
                  {(() => {
                    const aiAnalysis = metadata.ai_analysis && typeof metadata.ai_analysis === 'object' && !Array.isArray(metadata.ai_analysis)
                      ? metadata.ai_analysis as Record<string, unknown>
                      : {};
                    const reviewPending = aiAnalysis.admin_review_required === true && aiAnalysis.admin_review_status === 'pending';
                    const draft = typeof aiAnalysis.supplier_reply_draft === 'string' ? aiAnalysis.supplier_reply_draft : '';
                    if (!reviewPending || !draft) return null;
                    return (
                      <div className="supplier-reply-approval">
                        <div className="supplier-reply-approval-head">
                          <div>
                            <strong><T>ARAT Agent prepared a reply</T></strong>
                            <div className="muted"><T>The requested information already exists in the inquiry. Admin approval is required before sending it to the supplier.</T></div>
                          </div>
                          <span className="badge status-pending_approval"><T>Approval required</T></span>
                        </div>
                        <div className="supplier-reply-draft">{draft}</div>
                        <form action={async (formData) => { 'use server'; await approveSupplierClarificationReplyAction(formData); }}>
                          <input type="hidden" name="communicationId" value={email.id} />
                          <button className="primary-button" type="submit"><T>Approve &amp; Send to Supplier</T></button>
                        </form>
                      </div>
                    );
                  })()}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow"><T>RFQ</T></div>
            <h2><T>RFQs</T></h2>
            <div className="muted"><T>RFQs created by Admin after supplier verification and email confirmation.</T></div>
          </div>
          <span className="badge">{rfqsResult.data?.filter((rfq) => ['draft', 'pending_approval', 'approved', 'sent'].includes(rfq.status)).length ?? 0}<T> active</T></span>
        </div>
        {(rfqsResult.data ?? []).filter((rfq) => rfq.status !== 'cancelled').length === 0 ? (
          <div className="detail-card"><div className="empty"><T>No RFQ has been sent for this inquiry yet.</T></div></div>
        ) : (
          <div className="table">
            <div className="row header"><div><T>Supplier</T></div><div><T>Recipient</T></div><div><T>Status</T></div><div><T>Created</T></div></div>
            {(rfqsResult.data ?? []).filter((rfq) => rfq.status !== 'cancelled').map((rfq) => (
              <div className="row" key={rfq.id}>
                <div><strong>{oneRelated(rfq.suppliers)?.legal_name ?? '—'}</strong><div className="muted">{rfq.subject}</div></div>
                <div>{rfq.recipient_email ||<T>{'No recipient email'}</T>}</div>
                <div><span className={`badge status-badge status-${rfq.status}`}><T>{label(rfq.status)}</T></span></div>
                <div><DateText value={rfq.created_at} format="datetime"/></div>
              </div>
            ))}
          </div>
        )}
      </section>


      <section className="detail-grid">
        <div className="detail-card">
          <div className="section-head"><h2><T>Customer request</T></h2></div>
          <RequestItems normalized={inquiry.normalized_information} requirements={requirementsResult.data??[]} original={inquiry.original_customer_text??inquiry.description}/>
        </div>

        <div className="detail-card">
          <div className="section-head"><h2><T>Overview</T></h2></div>
          <dl className="details">
            <div><dt><T>Priority</T></dt><dd><T>{label(inquiry.priority)}</T></dd></div>
            <div><dt><T>Version</T></dt><dd>{inquiry.current_version}</dd></div>
            <div><dt><T>Created</T></dt><dd><DateText value={inquiry.created_at} format="datetime"/></dd></div>
            <div><dt><T>Updated</T></dt><dd><DateText value={inquiry.updated_at} format="datetime"/></dd></div>
          </dl>
          {inquiry.description && <p className="detail-text">{inquiry.description}</p>}
        </div>

        <div className="detail-card">
          <div className="section-head"><h2><T>Customer</T></h2></div>
          <dl className="details">
            <div><dt><T>Name</T></dt><dd>{customer?.company_name || customer?.name || '—'}</dd></div>
            <div><dt><T>Email</T></dt><dd>{customer?.email || '—'}</dd></div>
            <div><dt><T>Country</T></dt><dd>{customer?.country || '—'}</dd></div>
          </dl>
        </div>
      </section>

      <section className="section requirements-compact-section">
        <div className="section-head"><h2><T>Requirements</T></h2></div>
        <div className="table requirements-compact-table">
          <div className="row header"><div><T>Type</T></div><div><T>Value</T></div><div><T>Status</T></div><div><T>Source</T></div></div>
          {requirementsResult.data.length === 0 ? <div className="empty"><T>No requirements extracted.</T></div> : requirementsResult.data.map((item) => (
            <div className="row" key={item.id}>
              <div><T>{label(item.type)}</T></div><div>{item.value}<div><RequirementEdit inquiryId={inquiry.id} requirement={{ id: item.id, value: item.value, status: item.status }} /></div></div>
              <div><span className="badge"><T>{label(item.status)}</T></span></div>
              <div><T>{label(item.source)}</T><T>{item.admin_edited ? ' · Admin edited' : ''}</T></div>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-grid">
        <div className="detail-card">
          <div className="section-head"><h2><T>Files</T></h2></div>
          {filesResult.data.length === 0 ? <div className="empty"><T>No files.</T></div> : <div className="list">
            {filesResult.data.map((file) => (
              <div className="list-item" key={file.id}>
                <div>
                  <strong>{file.original_name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')}</strong>
                  <div className="muted">{file.mime_type} · {Math.round(file.file_size / 1024)}<T> KB</T></div>
                </div>
                <span className={`badge status-badge status-${file.status}`}><T>{label(file.status)}</T></span>
                <AdminFilePreview
                  inquiryId={inquiry.id}
                  fileId={file.id}
                  fileName={file.original_name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')}
                  mimeType={file.mime_type}
                />
              </div>
            ))}
          </div>}
        </div>

        <div className="detail-card">
          <div className="section-head">
            <div>
              <h2><T>Timeline</T></h2>
              <div className="muted"><T>Latest activity</T></div>
            </div>
          </div>
          <AdminActivityTimeline events={timelineResult.data ?? []} />
        </div>
      </section>
    </>
  );
}
