alter table public.suppliers add column communication_language text
  check (communication_language in ('tr','en'));
