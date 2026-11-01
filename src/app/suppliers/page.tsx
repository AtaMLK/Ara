import Link from 'next/link';
import {CandidatePanel} from '../inquiries/[id]/candidate-panel';
import {requireAdminPage} from '@/lib/data/admin';
import {displayText} from '@/lib/ui/display-text';
import { listSuppliers } from '@/lib/data/admin';

type Props = { searchParams: Promise<{ q?: string; status?: string;view?:string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function SuppliersPage({ searchParams }: Props) {
  const params = await searchParams;
  const items = params.view==='candidates'?[]:await listSuppliers(params.q, params.status);
  const {supabase}=await requireAdminPage();
  const candidates=params.view==='candidates'?await supabase.from('supplier_candidates').select('id,inquiry_id,proposed_name,proposed_country,proposed_website,status,match_evidence,availability_evidence,verification_evidence').eq('status','proposed').order('created_at',{ascending:false}):null;
  if(candidates?.error)throw candidates.error;

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">ADMIN</div><h1 className="title">Suppliers</h1><div className="muted">Supplier database and verification</div></div>
      </header>

      <nav className="notification-tabs"><Link href="/suppliers">Supplier directory</Link><Link href="/suppliers?view=candidates">Candidates to review</Link></nav>
      {params.view==='candidates'?<CandidatePanel candidates={(candidates?.data??[]).map(row=>({...row,proposed_name:displayText(row.proposed_name)}))}/>:<>
      <form className="filters">
        <input name="q" defaultValue={params.q} placeholder="Search supplier…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <button className="secondary-button">Filter</button>
      </form>

      <section className="section">
        <div className="table">
          <div className="row header"><div>Supplier</div><div>Country</div><div>Verification</div><div>Status</div></div>
          {items.length === 0 ? <div className="empty">No suppliers found.</div> : items.map((item) => (
            <div className="row" key={item.id}>
              <div><strong>{item.legal_name}</strong><div className="muted">{label(item.supplier_type)}</div></div>
              <div>{item.primary_country}</div>
              <div><span className="badge">{label(item.verification_status)}</span></div>
              <div><span className="badge">{label(item.status)}</span></div>
            </div>
          ))}
        </div>
      </section></>}
    </>
  );
}
