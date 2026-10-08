-- Store the RFQ and supplier email that caused a customer clarification.
-- This makes the clarification -> customer answer -> supplier reply path deterministic.
alter table public.clarifications
  add column if not exists rfq_id uuid references public.rfqs(id) on delete set null,
  add column if not exists source_communication_id uuid references public.communications(id) on delete set null;

create index if not exists clarifications_rfq_id_idx
  on public.clarifications(rfq_id);

create index if not exists clarifications_source_communication_id_idx
  on public.clarifications(source_communication_id);
