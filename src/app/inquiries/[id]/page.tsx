import Link from 'next/link';
import AdminActivityTimeline from './admin-activity-timeline';
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

  const [inquiryResult, requirementsResult, filesResult, timelineResult, executionsResult, alertsResult, clarificationsResult, researchResult, candidatesResult] = await Promise.all([
    supabase.from('inquiries').select('id,reference,title,description,status,priority,original_customer_text,current_version,created_at,updated_at,customers(name,company_name,email,country)').eq('id', id).single(),
    supabase.from('requirements').select('id,type,value,status,source,admin_edited,updated_at').eq('inquiry_id', id).order('created_at', { ascending: true }),
    supabase.from('inquiry_files').select('id,original_name,mime_type,file_size,status,version,uploaded_at,processed_at').eq('inquiry_id', id).order('uploaded_at', { ascending: false }),
    supabase.from('timeline_events').select('id,event_type,visibility,actor_type,agent_id,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(30),
    supabase.from('ai_executions').select('id,task_key,agent_id,status,attempt_count,error_code,error_message,started_at,completed_at,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('ai_alerts').select('id,agent_id,alert_type,message,priority,status,created_at').eq('inquiry_id', id).eq('status', 'open').order('created_at', { ascending: false }).limit(10),
    supabase.from('clarifications').select('id,requirement_id,question,status,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }),
    supabase.from('research_cases').select('id,status,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }).limit(5),
    supabase.from('supplier_candidates').select('id,proposed_name,proposed_country,proposed_website,status,match_evidence,availability_evidence,verification_evidence,created_at').eq('inquiry_id', id).order('created_at', { ascending: true }),
  ]);

  if (inquiryResult.error || !inquiryResult.data) notFound();
  if (requirementsResult.error || filesResult.error || timelineResult.error || executionsResult.error || alertsResult.error || clarificationsResult.error || researchResult.error || candidatesResult.error) throw new Error('Failed to load inquiry details');

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

      <CandidatePanel inquiryId={inquiry.id} candidates={candidatesResult.data ?? []} />

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
                <div><strong>{file.original_name}</strong><div className="muted">{file.mime_type} · {Math.round(file.file_size / 1024)} KB</div></div>
                <span className={`badge status-badge status-${file.status}`}>{label(file.status)}</span>
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