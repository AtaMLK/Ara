-- TEST PHASE ONLY: split pricing rules by customer segment and allow direct edits.
-- Production MUST replace direct editing of approved rules with immutable revisions
-- and approval/version snapshots before customer quotes depend on them.

alter table public.customer_pricing_rules
  add column if not exists customer_segment text not null default 'international';

alter table public.customer_pricing_rules
  drop constraint if exists customer_pricing_rules_customer_segment_check;

alter table public.customer_pricing_rules
  add constraint customer_pricing_rules_customer_segment_check
  check (customer_segment in ('international','domestic'));

drop index if exists public.customer_pricing_rules_one_approved;

create unique index if not exists customer_pricing_rules_one_approved_per_segment
  on public.customer_pricing_rules(customer_segment)
  where status = 'approved';

create index if not exists customer_pricing_rules_segment_status_idx
  on public.customer_pricing_rules(customer_segment, status, created_at desc);

comment on column public.customer_pricing_rules.customer_segment is
  'TEST PHASE. Production must use revisioned pricing profiles/snapshots; approved rules must be immutable.';
