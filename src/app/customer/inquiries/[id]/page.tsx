import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireCustomerInquiryAccess } from '@/lib/ai/guards';
import AnswerClarificationForm from './answer-form';

type Props = { params: Promise<{ id: string }> };

export default async function CustomerInquiryPage({ params }: Props) {
  const { id } = await params;
  const { supabase, inquiry } = await requireCustomerInquiryAccess(id);

  const [inquiryResult, requirementsResult, clarificationsResult] = await Promise.all([
    supabase.from('inquiries').select('id,reference,title,description,status,updated_at').eq('id', id).single(),
    supabase.from('requirements').select('id,type,value,status').eq('inquiry_id', id).order('created_at'),
    supabase.from('clarifications').select('id,requirement_id,question,answer,status,created_at').eq('inquiry_id', id).order('created_at', { ascending: false }),
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
