import { requireAdminPage } from '@/lib/data/admin';
import SettingsForms from './settings-forms';
import CompanyForm from './company-form';
import {getCompanyProfile} from '@/lib/quotes/company';

export default async function SettingsPage() {
  const { supabase } = await requireAdminPage();

  const { data: rates, error } = await supabase.from('exchange_rates')
    .select('id,from_currency,to_currency,rate,valid_from,valid_until,source,status,approved_at,created_at')
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return <div>
    <div className="topbar"><div><div className="eyebrow">ADMIN</div><h1 className="title">Settings</h1>
      <p className="muted">Manage approved exchange rates. Set markup and customer prices directly in each quote.</p></div></div>
    <CompanyForm profile={await getCompanyProfile()}/>
    <section className="detail-card"><div className="section-head"><div><h2>Exchange rates</h2><p className="muted">Only approved rates can be used to convert supplier costs.</p></div></div>
      <SettingsForms />
      <div className="settings-list">{rates?.length ? rates.map(rate=><div className="settings-list-item" key={rate.id}>
        <div><strong>{rate.from_currency} → {rate.to_currency}</strong><div className="muted settings-meta">{Number(rate.rate)} · from {rate.valid_from}{rate.valid_until?' · until '+rate.valid_until:' · no expiry'}{rate.source?' · '+rate.source:''}</div></div>
        <div className="settings-item-actions"><span className="badge">{rate.status}</span>{rate.status==='proposed'&&<SettingsForms mode="rate-actions" rateId={rate.id}/>}</div>
      </div>):<div className="empty">No exchange rates configured.</div>}</div>
    </section>
  </div>;
}
