-- Internal quote items include supplier costs and markup. Customer pages use
-- a server-only, ownership-checked projection of public quotation fields.
-- Preserve Admin policies and prevent direct customer API table reads.
drop policy if exists customer_quote_items_customer_select on public.customer_quote_items;
