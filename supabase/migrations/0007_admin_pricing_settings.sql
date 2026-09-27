-- Admin controls for exchange rates used in customer quote pricing.

alter table public.exchange_rates enable row level security;

create policy exchange_rates_admin
  on public.exchange_rates
  for all
  using (public.is_admin())
  with check (public.is_admin());

create index exchange_rates_pair_status_validity_idx
  on public.exchange_rates(from_currency, to_currency, status, valid_from, valid_until);

create index exchange_rates_approved_lookup_idx
  on public.exchange_rates(from_currency, to_currency, status, valid_from, valid_until)
  where status = 'approved';
