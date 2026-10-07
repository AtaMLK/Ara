import { requireAdmin } from '@/lib/ai/guards';
import SettingsForms from './settings-forms';

export default async function SettingsPage() {
  const { supabase } = await requireAdmin();

  const [{ data: rules }, { data: rates }] = await Promise.all([
    supabase.from('customer_pricing_rules')
      .select('id,name,customer_segment,markup_percent,rounding_increment,status,approved_at,created_at')
      .order('created_at', { ascending: false }),
    supabase.from('exchange_rates')
      .select('id,from_currency,to_currency,rate,valid_from,valid_until,source,status,approved_at,created_at')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1 className="title">Settings</h1>
          <p className="muted">Control customer quote pricing and approved exchange rates.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="detail-card">
          <div className="section-head">
            <div>
              <h2>Customer Pricing Rule</h2>
              <p className="muted settings-help">Exactly one rule can be Approved at a time.</p>
            </div>
          </div>
          <SettingsForms
            rules={(rules ?? []).map((rule) => ({
              ...rule,
              markup_percent: Number(rule.markup_percent),
              rounding_increment: rule.rounding_increment == null ? null : Number(rule.rounding_increment),
            }))}
          />
        </section>
        <section className="detail-card">
          <div className="section-head">
            <div>
              <h2>Exchange Rates</h2>
              <p className="muted settings-help">Only Approved rates may be used by Customer Quote generation.</p>
            </div>
          </div>
          <div className="settings-list">
            {(rates ?? []).length ? (rates ?? []).map((rate) => (
              <div className="settings-list-item" key={rate.id}>
                <div>
                  <strong>{rate.from_currency} → {rate.to_currency}</strong>
                  <div className="muted settings-meta">
                    {Number(rate.rate)} · from {rate.valid_from}
                    {rate.valid_until ? ' · until ' + rate.valid_until : ' · no expiry'}
                    {rate.source ? ' · ' + rate.source : ''}
                  </div>
                </div>
                <div className="settings-item-actions">
                  <span className={'badge status-' + rate.status}>{rate.status}</span>
                  {rate.status === 'proposed' && <SettingsForms mode="rate-actions" rateId={rate.id} />}
                </div>
              </div>
            )) : <div className="empty">No exchange rates configured.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
