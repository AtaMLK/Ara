-- Tie supplier candidates to the exact requested product requirement.
-- This keeps supplier discovery per-product while allowing the Inquiry UI
-- to consolidate candidates into one modal.
alter table public.supplier_candidates
  add column if not exists requirement_id uuid references public.requirements(id) on delete restrict;

create index if not exists supplier_candidates_requirement_id_idx
  on public.supplier_candidates(requirement_id);

create index if not exists supplier_candidates_inquiry_requirement_idx
  on public.supplier_candidates(inquiry_id, requirement_id);

-- Store RFQ language/selection metadata without changing the existing RFQ contract.
comment on column public.supplier_candidates.requirement_id is
  'The product requirement this supplier candidate was discovered for.';
