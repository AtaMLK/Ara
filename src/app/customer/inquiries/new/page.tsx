import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createCustomerInquiryAction } from '@/app/actions';

export default function NewCustomerInquiryPage() {
  return (
    <main className="portal-shell">
      <header className="topbar">
        <div>
          <Link className="back-link" href="/customer">← My Requests</Link>
          <div className="eyebrow">CUSTOMER PORTAL</div>
          <h1 className="title">New procurement request</h1>
          <div className="muted">Tell us what you need. ARAT will analyze the request and ask for clarification if necessary.</div>
        </div>
      </header>
      <section className="detail-card inquiry-form-card">
        <form action={async (formData) => {
          'use server';
          const result = await createCustomerInquiryAction({
            title: String(formData.get('title') ?? ''),
            description: String(formData.get('description') ?? ''),
            originalCustomerText: String(formData.get('originalCustomerText') ?? ''),
            priority: formData.get('priority') === 'urgent' ? 'urgent' : 'normal',
            files: formData.getAll('files').filter((value): value is File => value instanceof File && value.size > 0),
          });
          if (result?.ok) redirect(`/customer/inquiries/${result.inquiryId}`);
        }}>
          <label className="form-field"><span>Request title <small>Optional</small></span><input name="title" placeholder="e.g. Hydraulic cylinder spare parts" maxLength={200} /></label>
          <label className="form-field"><span>What do you need? <small>Required</small></span><textarea name="originalCustomerText" required maxLength={20000} rows={9} placeholder="Describe the products, models, part numbers, quantities, specifications, delivery requirements, or anything else you know." /></label>
          <label className="form-field"><span>Attachments <small>Optional · PDF, Excel, CSV, PNG, JPG, WEBP · max 10 MB each</small></span><input name="files" type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp" /></label>
          <label className="form-field"><span>Additional notes <small>Optional</small></span><textarea name="description" maxLength={5000} rows={4} placeholder="Anything else ARAT should know?" /></label>
          <label className="form-field"><span>Priority</span><select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></label>
          <div className="form-actions inquiry-submit-row"><Link className="secondary-button" href="/customer">Cancel</Link><button className="primary-button" type="submit">Submit request</button></div>
        </form>
      </section>
    </main>
  );
}
