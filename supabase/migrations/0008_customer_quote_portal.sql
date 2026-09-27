-- Customer-safe quote portal access and decisions.

alter table public.customer_quotes enable row level security;
alter table public.customer_quote_items enable row level security;
alter table public.quote_revision_requests enable row level security;

create policy customer_quotes_customer_select
  on public.customer_quotes
  for select
  using (
    customer_id = public.current_customer_id()
    and status in ('sent','accepted','rejected','revision_requested')
  );

create policy customer_quote_items_customer_select
  on public.customer_quote_items
  for select
  using (
    exists (
      select 1 from public.customer_quotes q
      where q.id = customer_quote_id
        and q.customer_id = public.current_customer_id()
        and q.status in ('sent','accepted','rejected','revision_requested')
    )
  );

create policy quote_revision_requests_customer_insert
  on public.quote_revision_requests
  for insert
  with check (
    requested_by = auth.uid()
    and exists (
      select 1 from public.customer_quotes q
      where q.id = quote_id
        and q.customer_id = public.current_customer_id()
        and q.status = 'sent'
    )
  );
