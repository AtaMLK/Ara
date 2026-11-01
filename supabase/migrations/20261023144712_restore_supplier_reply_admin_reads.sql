-- Allow authenticated Admins to see RFQ replies and processing status.
drop policy if exists communications_admin_select on public.communications;
create policy communications_admin_select on public.communications
  for select to authenticated using ((select public.is_admin()));

drop policy if exists rfqs_admin_select on public.rfqs;
create policy rfqs_admin_select on public.rfqs
  for select to authenticated using ((select public.is_admin()));

drop policy if exists rfq_items_admin_select on public.rfq_items;
create policy rfq_items_admin_select on public.rfq_items
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_responses_admin_select on public.supplier_responses;
create policy supplier_responses_admin_select on public.supplier_responses
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_quotes_admin_select on public.supplier_quotes;
create policy supplier_quotes_admin_select on public.supplier_quotes
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_quote_price_tiers_admin_select on public.supplier_quote_price_tiers;
create policy supplier_quote_price_tiers_admin_select on public.supplier_quote_price_tiers
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_quote_conditions_admin_select on public.supplier_quote_conditions;
create policy supplier_quote_conditions_admin_select on public.supplier_quote_conditions
  for select to authenticated using ((select public.is_admin()));

drop policy if exists ai_executions_admin_select on public.ai_executions;
create policy ai_executions_admin_select on public.ai_executions
  for select to authenticated using ((select public.is_admin()));

drop policy if exists ai_alerts_admin_select on public.ai_alerts;
create policy ai_alerts_admin_select on public.ai_alerts
  for select to authenticated using ((select public.is_admin()));
