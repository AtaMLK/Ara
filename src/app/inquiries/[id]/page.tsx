import Link from 'next/link';
import AdminActivityTimeline from './admin-activity-timeline';
import AdminFilePreview from './admin-file-preview';
import { getInquiryDisplayReference } from '@/lib/ui/inquiry-reference';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/data/admin';
import { InquiryEditForm } from './edit-form';
import { RequirementEdit } from './requirement-edit';
import { WorkflowPanel } from './workflow-panel';
import { CandidatePanel } from './candidate-panel';

type Props = { params: Promise<{ id: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function InquiryDetailPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await requireAdminPage();

  const [inquiryResult, requirementsResult, filesResult, timelineResult, executionsResult, alertsResult, clarificationsResult, researchResult, candidatesResult, rfqsResult, communicationsResult] = await Promise.all([
    supabase.from('inquiries').select('id,reference,title,description,status,priority,original_customer_text,current_version,created_at,updated_at,customers(name,company_name,email,country)').eq('id', id).single(),
    supabase.from('requirements').select('id,type,value,status,source,source_ref,admin_edited,updated_at').eq('inquiry_id', id).order('created_at', { ascending: true }),
    supabase.from('inquiry_files').select('id,original_name,mime_type,file_size,status,version,uploaded_at,processed_at').eq('inquiry_id', id).order('uploaded_at', { ascending: false }),
    supabase.from('timeline_events').select('id,event_type,visibility,actor_type,agent_id,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(30),
    supabase.from('ai_executions').select('id,task_key,agent_id,status,attempt_count,error_code,error_message,started_at,completed_at,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('ai_alerts').select('id,agent_id,alert_type,message,priority,status,created_at').eq('inquiry_id', id).eq('status', 'open').order('created_at', { ascending: false }).limit(10),
    supabase.from('clarifications').select('id,requirement_id,question,status,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }),
    supabase.from('research_cases').select('id,status,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(5),
    supabase.from('supplier_candidates').select('id,requirement_id,proposed_name,proposed_country,proposed_website,status,match_evidence,availability_evidence,verification_evidence,created_at,supplier_id,suppliers(id,legal_name,primary_country,supplier_type,verification_status,primary_address_id,primary_phone_id,primary_website_id,primary_email_id,supplier_contacts!supplier_contacts_supplier_id_fkey(id,name,email,phone,job_title,department,status,is_primary),supplier_emails!supplier_emails_supplier_id_fkey(email,is_primary,status),supplier_addresses!supplier_addresses_supplier_id_fkey(id,address,is_primary),supplier_phones!supplier_phones_supplier_id_fkey(id,phone,is_primary,status),supplier_websites!supplier_websites_supplier_id_fkey(id,url,is_primary))').eq('inquiry_id', id).order('created_at', { ascending: true }),
    supabase.from('rfqs').select('id,status,subject,recipient_email,sender_email,approval_required,created_at,sent_at,suppliers(legal_name)').eq('inquiry_id', id).order('created_at', { ascending: false }),
    supabase.from('communications').select('id,direction,channel,subject,body,received_at,sent_at,created_at,supplier_id,customer_id,rfq_id,metadata,suppliers(legal_name)').eq('inquiry_id', id).eq('channel', 'email').order('created_at', { ascending: false }).limit(100),
  ]);

  if (inquiryResult.error || !inquiryResult.data) notFound();
  if (requirementsResult.error || filesResult.error || timelineResult.error || executionsResult.error || alertsResult.error || clarificationsResult.error || researchResult.error || candidatesResult.error || rfqsResult.error || communicationsResult.error) throw new Error('Failed to load inquiry details');

  const inquiry = inquiryResult.data;
  const customer = inquiry.customers;
  const customerName = customer?.company_name || customer?.name || 'Customer';
  const displayReference = getInquiryDisplayReference(inquiry.reference, customerName, inquiry.created_at, inquiry.current_version, inquiry.updated_at);

  return (
    <>
      <header className="topbar">
        <div>
          <Link className="back-icon-button" href="/inquiries" aria-label="Back to Inquiries" title="Back to Inquiries"><span aria-hidden="true">←</span></Link>
          <div className="eyebrow">INQUIRY</div>
          <h1 className="title inquiry-display-reference" title={inquiry.reference}>{displayReference}</h1><div className="muted inquiry-reference-full">{inquiry.reference}</div>
          <div className="muted">{inquiry.title}</div>
        </div>
        <div className="topbar-actions"><span className={`badge status-badge status-${inquiry.status}`}>{label(inquiry.status)}</span><InquiryEditForm inquiryId={inquiry.id} title={inquiry.title} description={inquiry.description ?? ""} version={inquiry.current_version} /></div>
      </header>

      <CandidatePanel inquiryId={inquiry.id} requirements={requirementsResult.data ?? []} candidates={candidatesResult.data ?? []} />

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow">EMAIL</div>
            <h2 id="email-center">Email Center</h2>
            <div className="muted">All customer and supplier email activity for this inquiry. Supplier email content is visible only in the Admin portal.</div>
          </div>
          <span className="badge">{communicationsResult.data?.length ?? 0} emails</span>
        </div>
        {(communicationsResult.data ?? []).length === 0 ? (
          <div className="detail-card"><div className="empty">No emails have been received or sent for this inquiry yet.</div></div>
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
                      <strong>{labelText}</strong>
                      {email.suppliers?.legal_name && <span className="muted"> · {email.suppliers.legal_name}</span>}
                    </div>
                    <span className="muted">{new Date(email.received_at ?? email.sent_at ?? email.created_at).toLocaleString('en-GB')}</span>
                  </div>
                  <div className="email-center-subject">{email.subject || '(No subject)'}</div>
                  <div className="email-center-meta">{incoming ? 'Received' : 'Sent'} · {email.channel}</div>
                  <div className="email-center-body">{email.body || 'No message body recorded.'}</div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow">RFQ</div>
            <h2>RFQs</h2>
            <div className="muted">RFQs created by Admin after supplier verification and email confirmation.</div>
          </div>
          <span className="badge">{rfqsResult.data?.filter((rfq) => ['draft', 'pending_approval', 'approved', 'sent'].includes(rfq.status)).length ?? 0} active</span>
        </div>
        {(rfqsResult.data ?? []).filter((rfq) => rfq.status !== 'cancelled').length === 0 ? (
          <div className="detail-card"><div className="empty">No RFQ has been sent for this inquiry yet.</div></div>
        ) : (
          <div className="table">
            <div className="row header"><div>Supplier</div><div>Recipient</div><div>Status</div><div>Created</div></div>
            {(rfqsResult.data ?? []).filter((rfq) => rfq.status !== 'cancelled').map((rfq) => (
              <div className="row" key={rfq.id}>
                <div><strong>{rfq.suppliers?.legal_name ?? '—'}</strong><div className="muted">{rfq.subject}</div></div>
                <div>{rfq.recipient_email || 'No recipient email'}</div>
                <div><span className={`badge status-badge status-${rfq.status}`}>{label(rfq.status)}</span></div>
                <div>{new Date(rfq.created_at).toLocaleString('en-GB')}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <WorkflowPanel
        inquiryId={inquiry.id}
        status={inquiry.status}
        executions={executionsResult.data ?? []}
        alerts={alertsResult.data ?? []}
        clarifications={clarificationsResult.data ?? []}
        researchCases={researchResult.data ?? []}
      />

      <section className="detail-grid">
        <div className="detail-card">
          <div className="section-head"><h2>Customer request</h2></div>
          <div className="original-request">{inquiry.original_customer_text || inquiry.description || 'No original customer request recorded.'}</div>
        </div>

        <div className="detail-card">
          <div className="section-head"><h2>Overview</h2></div>
          <dl className="details">
            <div><dt>Priority</dt><dd>{label(inquiry.priority)}</dd></div>
            <div><dt>Version</dt><dd>{inquiry.current_version}</dd></div>
            <div><dt>Created</dt><dd>{new Date(inquiry.created_at).toLocaleString('en-GB')}</dd></div>
            <div><dt>Updated</dt><dd>{new Date(inquiry.updated_at).toLocaleString('en-GB')}</dd></div>
          </dl>
          {inquiry.description && <p className="detail-text">{inquiry.description}</p>}
        </div>

        <div className="detail-card">
          <div className="section-head"><h2>Customer</h2></div>
          <dl className="details">
            <div><dt>Name</dt><dd>{customer?.company_name || customer?.name || '—'}</dd></div>
            <div><dt>Email</dt><dd>{customer?.email || '—'}</dd></div>
            <div><dt>Country</dt><dd>{customer?.country || '—'}</dd></div>
          </dl>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Requirements</h2></div>
        <div className="table">
          <div className="row header"><div>Type</div><div>Value</div><div>Status</div><div>Source</div></div>
          {requirementsResult.data.length === 0 ? <div className="empty">No requirements extracted.</div> : requirementsResult.data.map((item) => (
            <div className="row" key={item.id}>
              <div>{label(item.type)}</div><div>{item.value}<div><RequirementEdit inquiryId={inquiry.id} requirement={{ id: item.id, value: item.value, status: item.status }} /></div></div>
              <div><span className="badge">{label(item.status)}</span></div>
              <div>{label(item.source)}{item.admin_edited ? ' · Admin edited' : ''}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-grid">
        <div className="detail-card">
          <div className="section-head"><h2>Files</h2></div>
          {filesResult.data.length === 0 ? <div className="empty">No files.</div> : <div className="list">
            {filesResult.data.map((file) => (
              <div className="list-item" key={file.id}>
                <div>
                  <strong>{file.original_name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')}</strong>
                  <div className="muted">{file.mime_type} · {Math.round(file.file_size / 1024)} KB</div>
                </div>
                <span className={`badge status-badge status-${file.status}`}>{label(file.status)}</span>
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
              <h2>Timeline</h2>
              <div className="muted">Latest activity</div>
            </div>
          </div>
          <AdminActivityTimeline events={timelineResult.data ?? []} />
        </div>
      </section>
    </>
  );
}