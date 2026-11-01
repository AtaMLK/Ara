import InquiryFileActions from '@/components/InquiryFileActions';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireAdminPage} from '@/lib/data/admin';
import {oneRelated} from '@/lib/data/relations';
import {getInquiryDisplayReference} from '@/lib/ui/inquiry-reference';
import {displayText,quoteDisplayReference} from '@/lib/ui/display-text';
import {requestItems} from '@/lib/ui/request-items';
import RequestItemsTable from '@/components/RequestItemsTable';
import {InquiryEditForm} from './edit-form';

export default async function InquiryDetailPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const {supabase}=await requireAdminPage();
 const [request,requirements,files,quotes]=await Promise.all([
  supabase.from('inquiries').select('id,reference,title,description,original_customer_text,normalized_information,status,priority,current_version,created_at,updated_at,customers(name,company_name,email,country)').eq('id',id).single(),
  supabase.from('requirements').select('id,type,value,status,source_ref,admin_edited').eq('inquiry_id',id).order('created_at'),
  supabase.from('inquiry_files').select('id,original_name,mime_type,file_size,status').eq('inquiry_id',id).order('uploaded_at'),
  supabase.from('customer_quotes').select('id,reference,display_reference,status,currency').eq('inquiry_id',id).order('created_at',{ascending:false}),
 ]);
 if(request.error||!request.data)notFound();
 if(requirements.error||files.error||quotes.error)throw new Error('Could not load request details.');
 const inquiry=request.data,customer=oneRelated(inquiry.customers);
 const reference=getInquiryDisplayReference(inquiry.reference,null,inquiry.created_at,inquiry.current_version,inquiry.updated_at);
 const items=requestItems(inquiry.normalized_information,requirements.data??[]);
 const label=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
 const original=(inquiry.original_customer_text||inquiry.description||'').replace(/\\+r\\+n|\\+n|\\+r/g,'\n');
 return <div className="inquiry-page">
  <Link className="back-link" href="/inquiries">← Inquiries</Link>
  <header className="inquiry-heading"><div><div className="eyebrow">{reference}</div><h1>{displayText(inquiry.title)||'Customer request'}</h1><p>{customer?.company_name||customer?.name||'Customer'} <span>·</span> {new Date(inquiry.created_at).toLocaleDateString('en-GB')}</p></div><div className="topbar-actions"><span className="badge">{label(inquiry.status)}</span><InquiryEditForm inquiryId={id} title={displayText(inquiry.title)} description={displayText(inquiry.description)} version={inquiry.current_version}/></div></header>
  <section className="inquiry-product-section"><div className="section-head"><h2>Requested products</h2><span className="muted">{items.length} {items.length===1?'item':'items'}</span></div><RequestItemsTable items={items} inquiryId={id}/></section>
  <div className="inquiry-secondary">
   <section className="detail-card"><div className="section-head"><h2>Customer</h2></div><dl className="details"><div><dt>Name</dt><dd>{customer?.company_name||customer?.name||'—'}</dd></div><div><dt>Email</dt><dd>{customer?.email||'—'}</dd></div><div><dt>Country</dt><dd>{customer?.country||'—'}</dd></div></dl></section>
   <section className="detail-card"><div className="section-head"><h2>Quotations</h2></div>{quotes.data?.length?quotes.data.map(quote=><Link className="inquiry-quote-link" key={quote.id} href={'/quotes/'+quote.id}><strong>{quoteDisplayReference(quote.reference,quote.display_reference)}</strong><span className="badge">{label(quote.status)}</span></Link>):<p className="muted">No quotations yet.</p>}</section>
  </div>
  {!!files.data?.length&&<section className="detail-card inquiry-attachments"><div className="section-head"><h2>Customer attachments</h2><span className="muted">{files.data.length} file{files.data.length===1?'':'s'}</span></div>{files.data.map(file=><div className="inquiry-attachment-row" key={file.id}><div><strong>{displayText(file.original_name)}</strong><small>{Math.round(file.file_size/1024)} KB</small></div><InquiryFileActions inquiryId={id} file={file}/></div>)}</section>}
  {original&&<details className="inquiry-source"><summary>Original customer message</summary><p className="detail-text">{displayText(original)}</p></details>}
 </div>;
}
