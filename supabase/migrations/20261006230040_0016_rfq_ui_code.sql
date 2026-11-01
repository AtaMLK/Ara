alter table public.rfqs add column if not exists rfq_code text;

update public.rfqs
set rfq_code = 'RFQ-' ||
  to_char(created_at at time zone 'UTC', 'YYYYMMDD') || '-' ||
  upper(left(replace(id::text, '-', ''), 6))
where rfq_code is null;

create unique index if not exists rfqs_rfq_code_uidx on public.rfqs(rfq_code)
where rfq_code is not null;
