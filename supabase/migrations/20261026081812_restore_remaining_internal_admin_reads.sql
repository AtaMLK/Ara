-- Internal data is visible only to active admins. Mutations remain server-side.
-- SELECT policies intentionally do not permit editing or deleting history.
create policy app_settings_admin_select on public.app_settings
  for select to authenticated using ((select public.is_admin()));

create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated using ((select public.is_admin()));

create policy document_processing_admin_select on public.document_processing
  for select to authenticated using ((select public.is_admin()));

create policy product_change_proposals_admin_select on public.product_change_proposals
  for select to authenticated using ((select public.is_admin()));

create policy requirement_history_admin_select on public.requirement_history
  for select to authenticated using ((select public.is_admin()));

create policy research_cases_admin_select on public.research_cases
  for select to authenticated using ((select public.is_admin()));

create policy research_results_admin_select on public.research_results
  for select to authenticated using ((select public.is_admin()));

create policy supplier_brands_admin_select on public.supplier_brands
  for select to authenticated using ((select public.is_admin()));

create policy supplier_countries_admin_select on public.supplier_countries
  for select to authenticated using ((select public.is_admin()));

create policy supplier_products_admin_select on public.supplier_products
  for select to authenticated using ((select public.is_admin()));

create policy supplier_sources_admin_select on public.supplier_sources
  for select to authenticated using ((select public.is_admin()));

create policy supplier_type_history_admin_select on public.supplier_type_history
  for select to authenticated using ((select public.is_admin()));

create policy supplier_verification_history_admin_select on public.supplier_verification_history
  for select to authenticated using ((select public.is_admin()));

create policy unmatched_emails_admin_select on public.unmatched_emails
  for select to authenticated using ((select public.is_admin()));
