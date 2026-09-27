-- Allow customers to read superseded quote items so historical revisions remain fully viewable.

drop policy if exists customer_quote_items_customer_select on public.customer_quote_items;

create policy customer_quote_items_customer_select
  on public.customer_quote_items
  for select
  using (
    exists (
      select 1 from public.customer_quotes q
      where q.id = customer_quote_id
        and q.customer_id = public.current_customer_id()
        and q.status in ('sent','accepted','rejected','revision_requested','superseded')
    )
  );
