alter table public.suppliers add column if not exists deleted_at timestamptz;
alter table public.inquiries add column if not exists deleted_at timestamptz;
create index if not exists suppliers_deleted_at_idx on public.suppliers(deleted_at);
create index if not exists inquiries_deleted_at_idx on public.inquiries(deleted_at);
