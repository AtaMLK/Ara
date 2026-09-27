import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomerInquiryAccess } from '@/lib/ai/guards';
import CustomerQuoteActions from './quote-actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ revision?: string }> };

export default async function CustomerQuotePage({ params }: Props) {
  const { id } = await params;
  const { revision } = await searchParams;
  const { supabase } = await requireCustomerInquiryAccess(id);

  const { data: quotes, error } = await supabase
    .from('customer_quotes')
    .select('id,inquiry_id,reference,revision_number,status,currency,valid_until,subject,body,sent_at,decision_reason,decision_text,decided_at')
    .eq('inquiry_id', id)
    .in('status', ['sent','accepted','rejected','revision_requested'])
    .order('revision_number', { ascending: false });

  if (error) throw error;
  const quote = (revision && quotes?.find((item) => item.id === revision)) || quotes?.[0];
  if (!quote) notFound();

  const { data: items, error: itemError } = await supabase
    .from('customer_quote_items')
    .select('id,quantity,unit_price,total,supplier_products(product_name,model_part_number)')
    .eq('customer_quote_id', quote.id)
    .order('created_at', { ascending: true });

  if (itemError) throw itemError;

  const total = (items ?? []).reduce((sum, item) => sum + Number(item.total || 0), 0);
  const canAct = quote.status === 'sent';

  return (
    <>
      <header className="topbar">
        <div>
          <Link className="back-link" href={\`/customer/inquiries/\${id}\`}>← Request</Link>
          <div className="eyebrow">CUSTOMER QUOTE</div>
          <h1 className="title">{quote.reference}</h1>
          <div className="muted">Revision R{quote.revision_number} · {quote.currency}</div>
        </div>
        <span className="badge">{quote.status.replaceAll('_', ' ')}</span>
      </header>

      <section className="section">
        <div className="section-head"><h2>Quotation history</h2><span className="muted">{quotes?.length ?? 0} revision{(quotes?.length ?? 0) === 1 ? '' : 's'}</span></div>
        <div className="quote-history">
          {(quotes ?? []).slice().reverse().map((historyQuote) => (
            <Link className={`quote-history-item ${historyQuote.id === quote.id ? 'active' : ''}`} key={historyQuote.id} href={`/customer/quotes/${id}?revision=${historyQuote.id}`}>
              <div><strong>{historyQuote.reference}</strong><span className="muted">R{historyQuote.revision_number}</span></div>
              <span className="badge">{historyQuote.status.replaceAll('_',' ')}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="detail-card">
        <div className="section-head"><h2>{quote.subject || 'Quotation'}</h2></div>
        {quote.body && <p className="detail-text">{quote.body}</p>}
        {quote.valid_until && <p className="muted">Valid until: {quote.valid_until}</p>}

        <div className="quote-items customer-quote-items">
          {(items ?? []).map((item) => {
            const product = Array.isArray(item.supplier_products) ? item.supplier_products[0] : item.supplier_products;
            return (
              <div className="quote-item" key={item.id}>
                <div className="quote-item-grid">
                  <div><strong>{product?.product_name || product?.model_part_number || 'Quoted item'}</strong>{product?.model_part_number && product?.product_name && <div className="muted">{product.model_part_number}</div>}</div>
                  <div><span className="muted">Qty</span><strong>{item.quantity}</strong></div>
                  <div><span className="muted">Unit price</span><strong>{Number(item.unit_price).toFixed(2)} {quote.currency}</strong></div>
                  <div><span className="muted">Total</span><strong>{Number(item.total).toFixed(2)} {quote.currency}</strong></div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="customer-quote-total">
          <span>Total</span>
          <strong>{total.toFixed(2)} {quote.currency}</strong>
        </div>

        {quote.status === 'accepted' && <div className="success-box">You accepted this quotation.</div>}
        {quote.status === 'revision_requested' && <div className="notice-box">A revision request has been submitted.</div>}
        {quote.status === 'rejected' && <div className="notice-box">This quotation was rejected.</div>}

        {canAct && <CustomerQuoteActions quoteId={quote.id} />}
      </section>
    </>
  );
}
