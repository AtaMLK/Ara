-- Run as the database owner in a seeded environment with an active admin and customer.
-- Everything, including the sentinel setting, is rolled back. Fails loudly on regression.
begin;
set local statement_timeout = '30s';
select set_config('arat.test_admin', (select user_id::text from public.profiles where role='admin' and status='active' limit 1), true);
select set_config('arat.test_customer', (select user_id::text from public.profiles where role='customer' and status='active' limit 1), true);
do $$ begin
  if nullif(current_setting('arat.test_admin'), '') is null or nullif(current_setting('arat.test_customer'), '') is null then
    raise exception 'Test requires an active admin and customer';
  end if;
end $$;
insert into public.app_settings(key,value,is_secret) values ('__admin_rls_regression__','{"test":true}',false);
do $$
declare t text; n bigint; expected jsonb := '{}';
begin
  foreach t in array array['app_settings','audit_logs','document_processing','product_change_proposals','requirement_history','research_cases','research_results','supplier_brands','supplier_countries','supplier_products','supplier_sources','supplier_type_history','supplier_verification_history','unmatched_emails'] loop
    if not (select relrowsecurity from pg_class where oid=format('public.%I',t)::regclass) then
      raise exception 'RLS disabled: %',t;
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_admin_select' and cmd='SELECT' and roles=array['authenticated']::name[]) then
      raise exception 'Missing scoped SELECT policy: %',t;
    end if;
    execute format('select count(*) from public.%I',t) into n;
    expected := expected || jsonb_build_object(t,n);
  end loop;
  perform set_config('arat.test_expected',expected::text,true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_admin'),'role','authenticated')::text,true);
do $$
declare t text; n bigint;
begin
  if not public.is_admin() then raise exception 'Admin impersonation failed'; end if;
  for t in select jsonb_object_keys(current_setting('arat.test_expected')::jsonb) loop
    execute format('select count(*) from public.%I',t) into n;
    if n <> (current_setting('arat.test_expected')::jsonb->>t)::bigint then
      raise exception 'Admin cannot read all rows: %',t;
    end if;
  end loop;
  -- Read permission must not introduce direct client writes.
  begin
    insert into public.app_settings(key,value) values ('__admin_rls_write__','{}');
    raise exception 'Unexpected INSERT allowed';
  exception when insufficient_privilege then null;
  end;
  update public.app_settings set value='{}' where key='__admin_rls_regression__';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Unexpected UPDATE allowed'; end if;
  delete from public.app_settings where key='__admin_rls_regression__';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Unexpected DELETE allowed'; end if;
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_customer'),'role','authenticated')::text,true);
do $$
declare t text; n bigint;
begin
  if public.is_admin() then raise exception 'Customer became admin'; end if;
  for t in select jsonb_object_keys(current_setting('arat.test_expected')::jsonb) loop
    execute format('select count(*) from public.%I',t) into n;
    if n <> 0 then raise exception 'Customer can read internal rows: %',t; end if;
  end loop;
  if not exists(select 1 from public.inquiries where customer_id=public.current_customer_id()) then
    raise exception 'Seeded customer inquiry access was lost (requires an existing inquiry)';
  end if;
  if exists(select 1 from public.inquiries where customer_id<>public.current_customer_id()) then
    raise exception 'Customer sees another customer inquiry';
  end if;
end $$;

-- Inactive admins lose access immediately, including with an existing JWT.
reset role;
update public.profiles set status='inactive' where user_id=current_setting('arat.test_admin')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_admin'),'role','authenticated')::text,true);
do $$
declare t text; n bigint;
begin
  if public.is_admin() then raise exception 'Inactive admin still authorized'; end if;
  for t in select jsonb_object_keys(current_setting('arat.test_expected')::jsonb) loop
    execute format('select count(*) from public.%I',t) into n;
    if n <> 0 then raise exception 'Inactive admin can read internal rows: %',t; end if;
  end loop;
end $$;

set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$
declare t text; n bigint;
begin
  for t in select jsonb_object_keys(current_setting('arat.test_expected')::jsonb) loop
    begin
      execute format('select count(*) from public.%I',t) into n;
      if n <> 0 then raise exception 'Anonymous can read internal rows: %',t; end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;
rollback;
