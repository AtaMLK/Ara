create table public.supplier_comparison_findings (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  supplier_response_id uuid not null references public.supplier_responses(id) on delete restrict,
  supplier_quote_id uuid references public.supplier_quotes(id) on delete restrict,
  requirement_id uuid not null references public.requirements(id) on delete restrict,
  status public.match_status not null,
  evidence text not null,
  source_data jsonb not null default '{}'::jsonb,
  ai_execution_id uuid references public.ai_executions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index supplier_comparison_findings_unique
  on public.supplier_comparison_findings(supplier_response_id, requirement_id);

create index supplier_comparison_findings_inquiry_idx
  on public.supplier_comparison_findings(inquiry_id, created_at);

create index supplier_comparison_findings_quote_idx
  on public.supplier_comparison_findings(supplier_quote_id);

alter table public.supplier_comparison_findings enable row level security;

create policy supplier_comparison_findings_admin
  on public.supplier_comparison_findings
  for all using (public.is_admin()) with check (public.is_admin());

create trigger touch_supplier_comparison_findings
  before update on public.supplier_comparison_findings
  for each row execute function public.touch_updated_at();
