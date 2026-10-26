import {T} from '@/components/language';
import Link from 'next/link';
import CustomerInquiryForm from './customer-inquiry-form';
import { requireNewCustomerInquiryPageAccess } from '@/lib/ai/guards';

export default async function NewCustomerInquiryPage() {
  await requireNewCustomerInquiryPageAccess();
  return (
    <main className="portal-shell">
      <header className="topbar">
        <div>
          <Link className="back-icon-button" href="/customer" aria-label="Back to My Requests" title="Back to My Requests"><span aria-hidden="true">←</span></Link>
          <div className="eyebrow"><T>CUSTOMER PORTAL</T></div>
          <h1 className="title"><T>New procurement request</T></h1>
          <div className="muted"><T>Describe what you need. Enter items, paste a list, or upload files with quantities.</T></div>
        </div>
      </header>
      <section className="detail-card inquiry-form-card">
        <CustomerInquiryForm />
      </section>
    </main>
  );
}
