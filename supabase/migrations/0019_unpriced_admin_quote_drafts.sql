-- Unpriced drafts are distinct from a free item. Historical prices stay intact.
alter table public.customer_quote_items alter column unit_price drop not null;
alter table public.customer_quote_items add constraint customer_quote_items_confirmed_price_required
  check (price_status <> 'admin_confirmed' or (unit_price is not null and unit_price >= 0));
