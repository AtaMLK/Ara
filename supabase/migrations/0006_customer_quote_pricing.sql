create table public.customer_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  markup_percent numeric(12,4) not null check (markup_percent >= 0),
  rounding_increment numeric(20,6) check (rounding_increment is null or rounding_increment > 0),
  status text not null default 'draft' check(status in ('draft','pending_approval','approved','rejected','disabled')),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customer_pricing_rules_one_approved
  on public.customer_pricing_rules(status)
  where status = 'approved';

alter table public.customer_pricing_rules enable row level security;

create policy customer_pricing_rules_admin
  on public.customer_pricing_rules
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.customer_quote_items
  add column price_status text not null default 'suggested'
    check (price_status in ('suggested','admin_confirmed'));

alter table public.customer_quote_items
  add column pricing_rule_id uuid references public.customer_pricing_rules(id) on delete restrict;

alter table public.customer_quote_items
  add column price_calculation jsonb not null default '{}'::jsonb;

create index customer_quote_items_price_status_idx
  on public.customer_quote_items(customer_quote_id, price_status);

create trigger touch_customer_pricing_rules
  before update on public.customer_pricing_rules
  for each row execute function public.touch_updated_at();
