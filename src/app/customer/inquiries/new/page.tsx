import Link from 'next/link';
import CustomerInquiryForm from './customer-inquiry-form';

export default function NewCustomerInquiryPage() {
  return (
    <main className="portal-shell">
      <header className="topbar">
        <div>
          <Link className="back-icon-button" href="/customer" aria-label="Back to My Requests" title="Back to My Requests"><span aria-hidden="true">←</span></Link>
          <div className="eyebrow">CUSTOMER PORTAL</div>
          <h1 className="title">New procurement request</h1>
          <div className="muted">Tell us what you need. Add each product with its required quantity; extra product details are optional.</div>
        </div>
      </header>
      <section className="detail-card inquiry-form-card">
        <CustomerInquiryForm />
      </section>
    </main>
  );
}
