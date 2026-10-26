-- Owner-run, read-only privilege assertions followed by rolled-back role probes.
begin;
set local statement_timeout = '30s';
do $$
declare f text; t text; n bigint;
begin
  foreach f in array array['public.is_admin()', 'public.current_customer_id()'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'Anonymous helper access remains: %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute')
      or not has_function_privilege('service_role', f, 'execute') then
      raise exception 'Required helper access missing: %', f;
    end if;
  end loop;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('is_admin','current_customer_id','touch_updated_at')
      and not coalesce(p.proconfig @> array['search_path=""'], false)) then
    raise exception 'Function search path is not empty';
  end if;
  set local role anon;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.is_admin();
    raise exception 'Anonymous admin helper executed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.current_customer_id();
    raise exception 'Anonymous customer helper executed';
  exception when insufficient_privilege then null;
  end;
  -- No policy should evaluate a now-forbidden helper for anonymous reads.
  foreach t in array array['profiles','customers','inquiries','requirements','customer_quotes','customer_quote_items','timeline_events'] loop
    execute format('select count(*) from public.%I',t) into n;
    if n <> 0 then raise exception 'Anonymous business rows visible: %',t; end if;
  end loop;
  reset role;
end $$;
rollback;
