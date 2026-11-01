import { customerQuoteItemsSchema } from '@/lib/data/customer-quote-schema';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomerInquiryAccess } from '@/lib/ai/guards';
import CustomerQuoteActions from './quote-actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ revision?: string }> };

export default async function CustomerQuotePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { revision } = await searchParams;
  const { supabase } = await requireCustomerInquiryAccess(id);

  const { data: quotes, error } = await supabase
    .from('customer_quotes')
    .select('id,inquiry_id,reference,revision_number,status,currency,valid_until,subject,body,sent_at,decision_reason,decision_text,decided_at')
    .eq('inquiry_id', id)
    .in('status', ['sent','accepted','rejected','revision_requested','superseded'])
    .order('revision_number', { ascending: false });

  if (error) throw error;
  const quote = (revision && quotes?.find((item) => item.id === revision)) || quotes?.[0];
  if (!quote) notFound();

  const {data:itemData,error:itemError}=await supabase.rpc('arat_customer_quote_items',{p_quote_id:quote.id});
  const items = itemError ? [] : customerQuoteItemsSchema.parse(itemData);
  const total = (items ?? []).reduce((sum, item) => sum + Number(item.total || 0), 0);
  const hasItems = (items ?? []).length > 0;
  const hasPrices = hasItems && items.every(item => item.unit_price !== null && item.total !== null);
  const canAct = quote.status === 'sent' && hasItems && !itemError;

  const money = (value: number | null) => value == null ? 'To be confirmed' :
    new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const dateLabel = quote.valid_until
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${quote.valid_until}T00:00:00Z`))
    : 'Not specified';
  const statusLabel = (status: string) => ({
    sent: 'Awaiting your response', accepted: 'Accepted', rejected: 'Declined',
    revision_requested: 'Revision requested', superseded: 'Previous version',
  }[status] ?? status.replaceAll('_', ' '));

  return (
    <main className="cq-page">
      <Link className="cq-back" href={`/customer/inquiries/${id}`}><span aria-hidden="true">←</span> Back to request</Link>

      <header className="cq-heading">
        <div>
          <div className="eyebrow">YOUR CUSTOMER PORTAL</div>
          <h1>Your quotation</h1>
          <p>Review the items, pricing and delivery details for your request.</p>
        </div>
        <span className={`cq-status cq-status-${quote.status}`}>{statusLabel(quote.status)}</span>
      </header>

      <div className="cq-meta" aria-label="Quotation information">
        <div className="cq-meta-reference"><span>Quotation reference</span><strong>{quote.reference}</strong></div>
        <div><span>Version</span><strong>Revision {quote.revision_number}</strong></div>
        <div><span>Currency</span><strong>{quote.currency}</strong></div>
        <div><span>Valid until</span><strong>{dateLabel}</strong></div>
      </div>

      {quote.status === 'superseded' && <div className="cq-notice" role="status">
        <strong>You’re viewing a previous version.</strong>
        <span>This quotation is kept for your records and can no longer be accepted.</span>
      </div>}

      <div className="cq-layout">
        <div className="cq-content">
          <section className="cq-card cq-message">
            <div className="cq-section-heading"><h2>Quotation details</h2><span>From ARAT</span></div>
            {quote.subject && <h3>{quote.subject}</h3>}
            {quote.body && <p>{quote.body}</p>}
          </section>

          <section className="cq-card cq-items">
            <div className="cq-section-heading"><h2>Items & pricing</h2><span>{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
            {hasItems ? <>
              <div className="cq-items-head" aria-hidden="true"><span>Item description</span><span>Quantity</span><span>Unit price</span><span>Amount</span></div>
              <div className="cq-item-list">
                {items.map((item, index) => <article className="cq-item" key={item.id}>
                  <div className="cq-product">
                    <span className="cq-item-number">{String(index + 1).padStart(2, '0')}</span>
                    <div><h3>{item.description}</h3>
                      {(item.model || item.brand) && <div className="cq-product-meta">{item.model && <span>{item.model}</span>}{item.brand && <span>{item.brand}</span>}</div>}
                      {item.delivery_text && <div className="cq-delivery"><span>Delivery</span><p>{item.delivery_text}</p></div>}
                    </div>
                  </div>
                  <div className="cq-number"><span className="cq-mobile-label">Quantity</span><strong>{item.quantity.toLocaleString('en-GB')}</strong></div>
                  <div className="cq-number"><span className="cq-mobile-label">Unit price</span><strong>{money(item.unit_price)}</strong><small>{item.unit_price !== null ? quote.currency : ''}</small></div>
                  <div className="cq-number cq-line-total"><span className="cq-mobile-label">Amount</span><strong>{money(item.total)}</strong><small>{item.total !== null ? quote.currency : ''}</small></div>
                </article>)}
              </div>
            </> : <div className="cq-empty" role="alert"><strong>Item details are currently unavailable</strong><p>Please contact ARAT for the item details before making a decision on this quotation.</p></div>}
          </section>

          <details className="cq-card cq-history" open={(quotes?.length ?? 0) > 1}>
            <summary><span>Version history</span><span className="cq-history-count">{quotes?.length ?? 0} {(quotes?.length ?? 0) === 1 ? 'version' : 'versions'}<span aria-hidden="true">⌄</span></span></summary>
            <div className="cq-history-list">{(quotes ?? []).map(historyQuote => <Link
              className={`cq-history-link ${historyQuote.id === quote.id ? 'is-current' : ''}`}
              aria-current={historyQuote.id === quote.id ? 'page' : undefined}
              key={historyQuote.id} href={`/customer/quotes/${id}?revision=${historyQuote.id}`}>
              <div><strong>Revision {historyQuote.revision_number}</strong><small>{historyQuote.reference}</small></div>
              <span>{historyQuote.id === quote.id ? 'Viewing' : statusLabel(historyQuote.status)}</span>
            </Link>)}</div>
          </details>
        </div>

        <aside className="cq-summary" aria-label="Quotation summary">
          <section className="cq-card">
            <div className="cq-section-heading"><h2>Summary</h2></div>
            <div className="cq-summary-row"><span>Items</span><strong>{items.length}</strong></div>
            <div className="cq-summary-row"><span>Currency</span><strong>{quote.currency}</strong></div>
            <div className="cq-summary-row"><span>Valid until</span><strong>{dateLabel}</strong></div>
            <div className="cq-grand-total"><span>Total quotation value</span><strong>{hasPrices ? money(total) : 'To be confirmed'}</strong><small>{hasPrices ? quote.currency : 'Pricing details are not available yet'}</small></div>
            {quote.status === 'accepted' && <div className="cq-response cq-response-success"><strong>Quotation accepted</strong><p>You have accepted this quotation.</p></div>}
            {quote.status === 'revision_requested' && <div className="cq-response"><strong>Revision requested</strong><p>Your request has been sent to ARAT for review.</p></div>}
            {quote.status === 'rejected' && <div className="cq-response"><strong>Quotation declined</strong><p>Your response has been recorded.</p></div>}
            {quote.status === 'superseded' && <p className="cq-summary-help">This version is available for reference only.</p>}
            {canAct && <CustomerQuoteActions quoteId={quote.id} />}
          </section>
          <p className="cq-footnote">All amounts are shown in {quote.currency}. Delivery information is listed with each item.</p>
        </aside>
      </div>
    </main>
  );
}
