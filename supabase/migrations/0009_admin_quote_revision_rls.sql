-- Allow Admin to manage customer quote revision workflow.

create policy customer_quotes_admin_all
  on public.customer_quotes
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy customer_quote_items_admin_all
  on public.customer_quote_items
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy quote_revision_requests_admin_all
  on public.quote_revision_requests
  for all
  using (public.is_admin())
  with check (public.is_admin());
