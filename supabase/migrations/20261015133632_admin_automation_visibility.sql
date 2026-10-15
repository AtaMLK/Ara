-- Background workers keep write access; active Admins can inspect failures.
-- Customers do not gain access to internal automation records.
alter table public.ai_executions enable row level security;
alter table public.ai_alerts enable row level security;
create policy ai_executions_admin_select on public.ai_executions
  for select to authenticated using ((select public.is_admin()));
create policy ai_alerts_admin_select on public.ai_alerts
  for select to authenticated using ((select public.is_admin()));
