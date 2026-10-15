-- Keep previously sent reference strings as history while permitting a readable
-- display alias under the current inquiry naming convention.
alter table public.customer_quotes add column display_reference text;
