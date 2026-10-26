create or replace function public.preserve_rfq_records()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  -- OLD has a different shape on each table and is absent on TRUNCATE.
  -- Resolve rfq_id only inside the linked-communication DELETE branch.
  if tg_op='DELETE' then
    if tg_table_name='communications' then
      if old.rfq_id is null then return old; end if;
    end if;
  end if;
  raise exception 'RFQ records, items and linked communications must be preserved. Cancel the RFQ instead.' using errcode='23514';
end $$;
