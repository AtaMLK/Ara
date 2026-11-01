alter table public.supplier_candidates
  add column if not exists requirement_id uuid references public.requirements(id) on delete restrict;

create index if not exists supplier_candidates_requirement_id_idx
  on public.supplier_candidates(requirement_id);

create index if not exists supplier_candidates_inquiry_requirement_idx
  on public.supplier_candidates(inquiry_id, requirement_id);

alter table public.supplier_candidates
  drop constraint if exists supplier_candidates_inquiry_id_proposed_name_key;

alter table public.supplier_candidates
  add constraint supplier_candidates_inquiry_name_requirement_key
  unique(inquiry_id, proposed_name, requirement_id);
