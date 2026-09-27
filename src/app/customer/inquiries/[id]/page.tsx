import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireCustomerInquiryAccess } from '@/lib/ai/guards';
import AnswerClarificationForm from './answer-form';
import CustomerFileLink from './file-link';

type Props = { params: Promise<{ id: string }> };

export default async function CustomerInquiryPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await requireCustomerInquiryAccess(id);

  const [inquiryResult, requirementsResult, clarificationsResult, filesResult] = await Promise.all([
    supabase.from('inquiries').select('id,reference,title,description,original_customer_text,status,updated_at').eq('id', id).single(),
    supabase.from('requirements').select('id,type,value,status,source,source_ref').eq('inquiry_id', id).order('created_at'),
    supabase.from('clarifications').select('id,requirement_id,question,answer,status,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }),
    supabase.from('inquiry_files').select('id,original_name,mime_type,file_size,status,uploaded_at,processed_at').eq('inquiry_id', id).order('uploaded_at'),
  ]);

  if (inquiryResult.error || !inquiryResult.data) notFound();

  const clarifications = (clarificationsResult.data ?? []).filter((item) => ['sent'].includes(item.status));

  return (
    <>
      <header className="topbar">
        <div>
          <Link className="back-link" href="/customer">← My Requests</Link>
          <div className="eyebrow">CUSTOMER PORTAL</div>
          <h1 className="title">{inquiryResult.data.reference}</h1>
          <div className="muted">{inquiryResult.data.title}</div>
        </div>
        <span className="badge">{inquiryResult.data.status.replaceAll('_',' ')}</span>
      </header>

      <section className="detail-grid">
        <div className="detail-card">
          <div className="section-head"><h2>Your request</h2></div>
          <p className="detail-text">{inquiryResult.data.original_customer_text || inquiryResult.data.description || 'No request text available.'}</p>
        </div>
        <div className="detail-card">
          <div className="section-head"><h2>Attachments</h2></div>
          {(filesResult.data ?? []).length === 0 ? (
            <div className="empty">No attachments.</div>
          ) : (
            <div className="list">
              {(filesResult.data ?? []).map((file) => (
                <div className="list-item" key={file.id}>
                  <div>
                    <strong>{file.original_name}</strong>
                    <div className="muted">{Math.round(file.file_size / 1024)} KB · {file.mime_type}</div>
                  </div>
                  <span className="badge">{file.status.replaceAll('_', ' ')}</span>
                  {file.status !== 'processing_failed' && <CustomerFileLink inquiryId={id} fileId={file.id} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section detail-grid">
        <div className="detail-card">
          <div className="section-head"><h2>Request</h2></div>
          <p>{inquiryResult.data.description || 'No additional description.'}</p>
        </div>
        <div className="detail-card">
          <div className="section-head"><h2>Requirements</h2></div>
          {(requirementsResult.data ?? []).map((item) => (
            <div className="list-item" key={item.id}>
              <strong>{item.type.replaceAll('_',' ')}</strong>
              <span>{item.value}</span>
              <span className="badge">{item.status.replaceAll('_',' ')}</span>
              <span className="muted requirement-source">
                {item.source === 'customer_text' ? 'From your request' : item.source === 'clarification' ? 'From your answer' : 'From attachment'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Action required</h2></div>
        {clarifications.length === 0 ? (
          <div className="empty">There are no questions waiting for your answer.</div>
        ) : (
          clarifications.map((item) => (
            <div className="detail-card" key={item.id}>
              <div className="eyebrow">CLARIFICATION</div>
              <h3>{item.question}</h3>
              <AnswerClarificationForm inquiryId={id} clarificationId={item.id} />
            </div>
          ))
        )}
      </section>
    </>
  );
}
