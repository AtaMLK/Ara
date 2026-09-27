drop policy if exists customer_quotes_customer_select on public.customer_quotes;

create policy customer_quotes_customer_select
  on public.customer_quotes
  for select
  using (
    customer_id = public.current_customer_id()
    and status in ('sent','accepted','rejected','revision_requested','superseded')
  );
