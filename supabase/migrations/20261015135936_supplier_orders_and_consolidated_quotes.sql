alter table public.customer_quote_items add column is_selected boolean not null default true;

-- Only the server can change the chosen offer, while holding the quotation lock.
create function public.select_customer_quote_offer(p_item_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_quote uuid; v_status text; v_ref text;
begin
  select customer_quote_id into v_quote from public.customer_quote_items where id=p_item_id;
  select status::text into v_status from public.customer_quotes where id=v_quote for update;
  if v_status is null or v_status not in ('draft','pending_approval') then raise exception 'Quotation is not editable'; end if;
  select price_calculation->>'source_ref' into v_ref from public.customer_quote_items where id=p_item_id;
  if v_ref is null or v_ref='' then raise exception 'Link this offer to a requested item first'; end if;
  update public.customer_quote_items set is_selected=(id=p_item_id)
    where customer_quote_id=v_quote and price_calculation->>'source_ref'=v_ref;
  update public.customer_quotes set status='draft' where id=v_quote;
end; $$;
revoke all on function public.select_customer_quote_offer(uuid) from public, anon, authenticated;
grant execute on function public.select_customer_quote_offer(uuid) to service_role;

create table public.supplier_order_confirmations (
  id uuid primary key default gen_random_uuid(),
  customer_quote_id uuid not null references public.customer_quotes(id),
  inquiry_id uuid not null references public.inquiries(id),
  supplier_id uuid not null references public.suppliers(id),
  reference text not null unique,
  status text not null default 'draft' check(status in ('draft','sending','sent','delivery_uncertain')),
  recipient_email text not null, subject text not null, body text not null,
  snapshot jsonb not null, fingerprint text not null,
  approved_by uuid references auth.users(id), approved_at timestamptz,
  sent_at timestamptz, provider_message_id text, error_text text,
  created_at timestamptz not null default now(),
  unique(customer_quote_id,supplier_id)
);
create index supplier_orders_inquiry_idx on public.supplier_order_confirmations(inquiry_id);
create index supplier_orders_supplier_idx on public.supplier_order_confirmations(supplier_id);
alter table public.supplier_order_confirmations enable row level security;
revoke all on public.supplier_order_confirmations from anon, authenticated;
grant select on public.supplier_order_confirmations to authenticated;
grant all on public.supplier_order_confirmations to service_role;
create policy "Admins read supplier orders" on public.supplier_order_confirmations for select
  to authenticated using ((select public.is_admin()));

create unique index supplier_order_notification_unique on public.notifications(user_id,record_id)
  where record_type='supplier_order_confirmation';

-- Surface customer acceptances that predate the new review step. This sends no email.
insert into public.notifications(user_id,category,priority,title,message,record_type,record_id,action_url)
select p.user_id,'task','normal','Customer accepted quotation - review supplier orders',
  coalesce(q.display_reference,q.reference)||': review each supplier order and send the requested items.',
  'supplier_order_confirmation',q.id,'/quotes/'||q.id||'#supplier-order-confirmation'
from public.customer_quotes q cross join public.profiles p
where q.status='accepted' and p.role='admin' and p.status='active'
on conflict (user_id,record_id) where record_type='supplier_order_confirmation' do nothing;
