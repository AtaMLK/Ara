-- These identity helpers require definer privileges to avoid recursive profile RLS.
-- They take no identity argument and inspect only auth.uid(). Keep authenticated
-- policy access, but remove anonymous RPC access and its inherited PUBLIC grant.
alter function public.is_admin() set search_path = '';
alter function public.current_customer_id() set search_path = '';
alter function public.touch_updated_at() set search_path = '';

-- Policies that use the helpers must target signed-in users before revoking anon.
-- Preserve their predicates and commands; no anonymous business access is intended.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and roles = array['public']::name[]
      and (qual ~ '(is_admin|current_customer_id)\('
        or with_check ~ '(is_admin|current_customer_id)\(')
  loop
    execute format('alter policy %I on %I.%I to authenticated',
      p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

revoke execute on function public.is_admin(), public.current_customer_id()
  from public, anon;
grant execute on function public.is_admin(), public.current_customer_id()
  to authenticated, service_role;
-- Trigger execution does not require clients to invoke the trigger function.
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
