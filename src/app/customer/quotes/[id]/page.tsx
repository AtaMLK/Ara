import {T} from '@/components/language';
import {loadCustomerQuoteItems} from '@/lib/data/customer-quote-items';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomerInquiryPageAccess } from '@/lib/ai/guards';
import CustomerQuoteActions from './quote-actions';
import {quotationSubject,quoteMessage} from '@/lib/quotes/document';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ revision?: string }> };

export default async function CustomerQuotePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { revision } = await searchParams;
  const { supabase } = await requireCustomerInquiryPageAccess(id,'/customer/quotes/'+id);

  const { data: quotes, error } = await supabase
    .from('customer_quotes')
    .select('id,inquiry_id,display_reference,reference,revision_number,status,currency,valid_until,subject,body,sent_at,decision_reason,decision_text,decided_at')
    .eq('inquiry_id', id)
    .in('status', ['sent','accepted','rejected','revision_requested','superseded'])
    .order('revision_number', { ascending: false });

  if (error) throw error;
  const quote = (revision && quotes?.find((item) => item.id === revision)) || quotes?.[0];
  if (!quote) notFound();

  const items=await loadCustomerQuoteItems([quote.id]);

  const total = (items ?? []).reduce((sum, item) => sum + Number(item.total || 0), 0);
  const canAct = quote.status === 'sent';

  return (
    <>
      <header className="topbar">
        <div>
          <Link className="back-link" href={`/customer/inquiries/${id}`}><T>← Request</T></Link>
          <div className="eyebrow"><T>CUSTOMER QUOTE</T></div>
          <h1 className="title">{quote.display_reference||quote.reference}</h1>
          <div className="muted"><T>Revision R</T>{quote.revision_number} · {quote.currency}</div>
        </div>
        <span className="badge"><T>{quote.status.replaceAll('_', ' ')}</T></span>
      </header>

      <section className="section">
        <div className="section-head"><h2><T>Quotation history</T></h2><span className="muted">{quotes?.length ?? 0}<T> revision</T>{(quotes?.length ?? 0) === 1 ? '' : 's'}</span></div>
        <div className="quote-history">
          {(quotes ?? []).slice().reverse().map((historyQuote) => (
            <Link className={`quote-history-item ${historyQuote.id === quote.id ? 'active' : ''}`} key={historyQuote.id} href={`/customer/quotes/${id}?revision=${historyQuote.id}`}>
              <div><strong>{historyQuote.display_reference||historyQuote.reference}</strong><span className="muted">R{historyQuote.revision_number}</span></div>
              <span className="badge"><T>{historyQuote.status.replaceAll('_',' ')}</T></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="detail-card">
        <div className="section-head"><h2>{!quote.subject||/Quotation.*(?:DRAFT-|CUS-)/i.test(quote.subject)?quotationSubject(quote.display_reference||quote.reference):quote.subject}</h2></div>
        {quoteMessage(quote.body) && <p className="detail-text">{quoteMessage(quote.body)}</p>}
        {quote.valid_until && <p className="muted"><T>Valid until: </T>{quote.valid_until}</p>}

        <div className="quote-items customer-quote-items">
          {(items ?? []).map((item) => {
            const product = Array.isArray(item.supplier_products) ? item.supplier_products[0] : item.supplier_products;
            return (
              <div className="quote-item" key={item.id}>
                <div className="quote-item-grid">
                  <div><strong>{[item.model,item.description||product?.product_name||product?.model_part_number].filter(Boolean).join(' \u2014 ')||<T>{'Item description pending'}</T>}</strong>{product?.model_part_number && product?.product_name && <div className="muted">{product.model_part_number}</div>}</div>
                  <div><span className="muted"><T>Qty</T></span><strong>{item.quantity}</strong></div>
                  <div><span className="muted"><T>Delivery</T></span><strong>{item.delivery_text||<T>{'To be confirmed'}</T>}</strong></div>
                  <div><span className="muted"><T>Unit price</T></span><strong>{Number(item.unit_price).toFixed(2)} {quote.currency}</strong></div>
                  <div><span className="muted"><T>Total</T></span><strong>{Number(item.total).toFixed(2)} {quote.currency}</strong></div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="customer-quote-total">
          <span><T>Total</T></span>
          <strong>{total.toFixed(2)} {quote.currency}</strong>
        </div>

        {quote.status === 'accepted' && <div className="success-box"><T>You accepted this quotation.</T></div>}
        {quote.status === 'revision_requested' && <div className="notice-box"><T>A revision request has been submitted.</T></div>}
        {quote.status === 'rejected' && <div className="notice-box"><T>This quotation was rejected.</T></div>}

        {canAct && <CustomerQuoteActions quoteId={quote.id} />}
      </section>
    </>
  );
}
