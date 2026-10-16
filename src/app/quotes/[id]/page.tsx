import {T} from '@/components/language';
import {SupplierOrders} from './supplier-orders';
import AutomationRefresh from '@/components/automation-refresh';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {getQuoteReadiness} from '@/lib/quotes/readiness';
import { oneRelated } from '@/lib/data/relations';
import Link from 'next/link';
import { getCustomerQuote } from '@/lib/data/admin';
import { QuoteWorkbench } from './quote-workbench';
import { QuoteActions } from '../quote-actions';
import QuoteDetailsEditor from './quote-details-editor';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await getCustomerQuote(id);
  const selectedItems=quote.items.filter(item=>item.is_selected);
  const readiness=['draft','pending_approval'].includes(quote.status)?await getQuoteReadiness(id):null;
  const {data:orders,error:ordersError}=await createSupabaseAdminClient().from('supplier_order_confirmations').select('id,reference,status,recipient_email,subject,body,fingerprint,sent_at,error_text,snapshot,suppliers(legal_name)').eq('customer_quote_id',id).order('created_at');
  if(ordersError)throw new Error('Supplier orders could not be loaded.');

  return (
    <>
      <AutomationRefresh enabled={['draft','pending_approval','sent'].includes(quote.status)}/>
      <header className="topbar">
        <div>
          <Link className="back-link" href="/quotes"><T>← Quotes</T></Link>
          <div className="eyebrow"><T>CUSTOMER QUOTE</T></div>
          <h1 className="title">{quote.reference}</h1>
          <div className="muted">{oneRelated(quote.customers)?.company_name || oneRelated(quote.customers)?.name ||<T>{'Customer'}</T>} · {quote.currency}</div>
        </div>
        <div className="topbar-actions">
          <span className="badge"><T>{label(quote.status)}</T></span>
          <QuoteActions id={quote.id} status={quote.status} />
          {selectedItems.length>0&&quote.confirmedItemCount===selectedItems.length&&(!readiness||!readiness.problems.length)&&<a className="secondary-button" href={'/api/quotes/'+quote.id+'/pdf?preview=current'} target="_blank" rel="noreferrer"><T>Preview / Download PDF</T></a>}
          {['sent','accepted','rejected','revision_requested','superseded'].includes(quote.status)&&<a className="secondary-button" href={'/api/quotes/'+quote.id+'/pdf'} target="_blank" rel="noreferrer"><T>Originally sent PDF</T></a>}
        </div>
      </header>

      <section className="detail-grid">
        <div className="detail-card">
          <div className="section-head"><h2><T>Quote details</T></h2></div>
          <dl className="details">
            <div><dt><T>Reference</T></dt><dd>{quote.reference}</dd></div>
            <div><dt><T>Customer</T></dt><dd>{oneRelated(quote.customers)?.company_name || oneRelated(quote.customers)?.name || '—'}</dd></div>
            <div><dt><T>Currency</T></dt><dd>{quote.currency}</dd></div>
            <div><dt><T>Validity</T></dt><dd><T>{quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('en-GB') : 'No expiry'}</T></dd></div>
            <div><dt><T>Revision</T></dt><dd>R{quote.revision_number}</dd></div>
          </dl>
        </div>
        <div className="detail-card">
          <div className="section-head"><h2><T>Commercial control</T></h2></div>
          <p className="muted"><T>ARAT prepares supplier costs, tax and delivery. Enter markup or a manual customer price in the pre-quote review, then confirm every line before approval.</T></p>
          <div className="quote-control-note">
            <strong>{quote.confirmedItemCount}/{selectedItems.length}</strong><T> prices confirmed
          </T></div>
        </div>
      </section>

      {quote.status==='accepted'&&<SupplierOrders quoteId={id} orders={(orders??[]).map(order=>({...order,supplier_name:oneRelated(order.suppliers)?.legal_name,pdf_url:order.snapshot?.pdf_path?'/api/supplier-orders/'+order.id+'/pdf?v='+order.snapshot.pdf_sha256:order.status==='sent'?'/api/supplier-orders/'+order.id+'/pdf?copy=current':undefined,pdf_is_copy:!order.snapshot?.pdf_path&&order.status==='sent',html:typeof order.snapshot?.email_html==='string'?order.snapshot.email_html:undefined,instructions:typeof order.snapshot?.instructions==='string'?order.snapshot.instructions:''}))}/>}
      {readiness&&<section className="section"><div className="detail-card"><h2><T>Consolidated quotation</T></h2><p>{selectedItems.length}<T> selected offer(s) for </T>{readiness.requestedCount}<T> requested item(s). Alternative supplier offers remain in the Admin review.</T></p>{readiness.problems.map(problem=><p className="muted" key={problem}><T>{problem}</T></p>)}</div></section>}
      {quote.revisionRequest && (
        <section className="section">
          <div className="detail-card revision-context">
            <div className="section-head"><h2><T>Customer revision request</T></h2><span className="badge"><T>{label(quote.revisionRequest.status)}</T></span></div>
            <dl className="details">
              <div><dt><T>Reason</T></dt><dd><T>{label(quote.revisionRequest.reason)}</T></dd></div>
              <div><dt><T>Customer message</T></dt><dd>{quote.revisionRequest.free_text ||<T>{'No additional details.'}</T>}</dd></div>
            </dl>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2><T>Quote items</T></h2><span className="muted">{quote.items.length}<T> line</T>{quote.items.length === 1 ? '' : 's'}</span></div>
        <div className="quote-items">
          {quote.items.length === 0 ? <div className="empty"><T>No quote items.</T></div> : <QuoteWorkbench
            items={quote.items.map(item=>({...item,supplier_products:oneRelated(item.supplier_products)}))}
            currency={quote.currency} editable={quote.status === 'draft' || quote.status === 'pending_approval'}
            quoteId={quote.id} reference={quote.reference} rates={quote.rates} />}
        </div>
      </section>

      {(quote.status === 'draft' || quote.status === 'pending_approval') && <section className="section"><QuoteDetailsEditor quote={quote} /></section>}
      <section className="section">
        <div className="detail-card"><div className="section-head"><h2><T>Customer message</T></h2></div><div className="detail-text">{quote.body ||<T>{'No message.'}</T>}</div></div>
      </section>
    </>
  );
}
