-- Regression test: run as owner against a seeded ARAT database; leaves no data.
begin;
set local statement_timeout='30s';
do $$
declare inquiry_a uuid; inquiry_b uuid; customer uuid; affected integer;
begin
  select id into customer from public.customers limit 1;
  if customer is null then raise exception 'Seeded customer required'; end if;
  insert into public.inquiries(customer_id,reference,title)
    values(customer,'TEST-WORKER-'||gen_random_uuid()::text,'Worker recovery test') returning id into inquiry_a;
  insert into public.inquiries(customer_id,reference,title)
    values(customer,'TEST-WORKER-'||gen_random_uuid()::text,'Scope isolation test') returning id into inquiry_b;
  insert into public.ai_executions(task_key,agent_id,inquiry_id,status,started_at,heartbeat_at,input_ref,output_ref)
    values
    ('worker-test-old-'||inquiry_a,'intake',inquiry_a,'running',now()-interval '1 hour',now()-interval '6 minutes','{"keep":"input"}','{"keep":"partial"}'),
    ('worker-test-live-'||inquiry_a,'intake',inquiry_a,'running',now()-interval '1 hour',now(),'{}','{}'),
    ('worker-test-legacy-'||inquiry_a,'intake',inquiry_a,'running',now()-interval '6 minutes',null,'{}','{}'),
    ('worker-test-other-'||inquiry_b,'intake',inquiry_b,'running',now()-interval '1 hour',null,'{}','{}'),
    ('worker-test-queued-'||inquiry_a,'intake',inquiry_a,'queued',null,null,'{}','{}');
  set local role service_role;
  select public.expire_stale_ai_executions(inquiry_a) into affected;
  if affected<>2 then raise exception 'Expected 2 expired rows, got %',affected; end if;
  select public.expire_stale_ai_executions(inquiry_a) into affected;
  if affected<>0 then raise exception 'Duplicate recovery generated alerts'; end if;
  reset role;
  if (select count(*) from public.ai_alerts where inquiry_id=inquiry_a and alert_type='WORKER_INTERRUPTED')<>2 then raise exception 'Missing or duplicate alerts'; end if;
  if (select status from public.ai_executions where task_key='worker-test-live-'||inquiry_a)<>'running' then raise exception 'Live job expired'; end if;
  if (select status from public.ai_executions where task_key='worker-test-other-'||inquiry_b)<>'running' then raise exception 'Inquiry scope leaked'; end if;
  if (select status from public.ai_executions where task_key='worker-test-queued-'||inquiry_a)<>'queued' then raise exception 'Queued job changed'; end if;
  if not exists(select 1 from public.ai_executions where task_key='worker-test-old-'||inquiry_a and status='failed' and error_code='WORKER_INTERRUPTED' and input_ref->>'keep'='input' and output_ref->>'keep'='partial') then raise exception 'Partial results lost'; end if;
  if has_function_privilege('anon','public.expire_stale_ai_executions(uuid)','EXECUTE') or has_function_privilege('authenticated','public.expire_stale_ai_executions(uuid)','EXECUTE') then raise exception 'Recovery exposed to clients'; end if;
end $$;
rollback;
