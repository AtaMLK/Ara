-- ARAT security hardening.
-- Every internal public table must be protected by RLS.
-- Admin pages use the authenticated SSR client, while server-side workers use the service-role client.

alter table public.document_processing enable row level security;
alter table public.requirement_history enable row level security;
alter table public.research_cases enable row level security;
alter table public.research_results enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_type_history enable row level security;
alter table public.supplier_countries enable row level security;
alter table public.supplier_sources enable row level security;
alter table public.supplier_verification_history enable row level security;
alter table public.supplier_websites enable row level security;
alter table public.supplier_emails enable row level security;
alter table public.supplier_phones enable row level security;
alter table public.supplier_addresses enable row level security;
alter table public.supplier_brands enable row level security;
alter table public.supplier_products enable row level security;
alter table public.product_change_proposals enable row level security;
alter table public.supplier_contacts enable row level security;
alter table public.rfqs enable row level security;
alter table public.rfq_items enable row level security;
alter table public.communications enable row level security;
alter table public.unmatched_emails enable row level security;
alter table public.supplier_responses enable row level security;
alter table public.supplier_quotes enable row level security;
alter table public.supplier_quote_price_tiers enable row level security;
alter table public.supplier_quote_conditions enable row level security;
alter table public.ai_alerts enable row level security;
alter table public.ai_executions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

create policy document_processing_admin_all
  on public.document_processing for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy requirement_history_admin_all
  on public.requirement_history for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy research_cases_admin_all
  on public.research_cases for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy research_results_admin_all
  on public.research_results for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy suppliers_admin_all
  on public.suppliers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_type_history_admin_all
  on public.supplier_type_history for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_countries_admin_all
  on public.supplier_countries for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_sources_admin_all
  on public.supplier_sources for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_verification_history_admin_all
  on public.supplier_verification_history for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_websites_admin_all
  on public.supplier_websites for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_emails_admin_all
  on public.supplier_emails for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_phones_admin_all
  on public.supplier_phones for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_addresses_admin_all
  on public.supplier_addresses for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_brands_admin_all
  on public.supplier_brands for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_products_admin_all
  on public.supplier_products for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy product_change_proposals_admin_all
  on public.product_change_proposals for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_contacts_admin_all
  on public.supplier_contacts for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy rfqs_admin_all
  on public.rfqs for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy rfq_items_admin_all
  on public.rfq_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy communications_admin_all
  on public.communications for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy unmatched_emails_admin_all
  on public.unmatched_emails for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_responses_admin_all
  on public.supplier_responses for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_quotes_admin_all
  on public.supplier_quotes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_quote_price_tiers_admin_all
  on public.supplier_quote_price_tiers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy supplier_quote_conditions_admin_all
  on public.supplier_quote_conditions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy ai_alerts_admin_all
  on public.ai_alerts for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy ai_executions_admin_all
  on public.ai_executions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy audit_logs_admin_all
  on public.audit_logs for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy app_settings_admin_all
  on public.app_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Service-role/server workers bypass RLS by design. Customer actions that need
-- internal writes use the server-side admin client after customer authorization.

-- Audit note: run this migration once on the current Supabase project; do not rerun the original migration set.
