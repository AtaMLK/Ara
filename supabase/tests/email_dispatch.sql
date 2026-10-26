begin;
set local statement_timeout='30s';
do $$
declare test_inquiry uuid; customer uuid; old_id uuid; n integer;
begin
 select id into customer from public.customers limit 1;
 if customer is null then raise exception 'Seeded customer required'; end if;
 insert into public.inquiries(customer_id,reference,title)
 values(customer,'TEST-EMAIL-'||gen_random_uuid()::text,'Email delivery regression') returning id into test_inquiry;
 insert into public.email_dispatches(idempotency_key,payload_hash,inquiry_id,subject,recipients,message_id,created_at)
 values('test-email-old-'||test_inquiry,repeat('a',64),test_inquiry,'Old send',array['test@example.test'],'<old@example.test>',now()-interval '6 minutes')
 returning id into old_id;
 begin
   insert into public.email_dispatches(idempotency_key,payload_hash,subject,recipients,message_id)
   values('test-email-old-'||test_inquiry,repeat('b',64),'Duplicate',array['test@example.test'],'<duplicate@example.test>');
   raise exception 'Duplicate dispatch key was accepted';
 exception when unique_violation then null;
 end;
 insert into public.email_dispatches(idempotency_key,payload_hash,inquiry_id,subject,recipients,message_id)
 values('test-email-fresh-'||test_inquiry,repeat('a',64),test_inquiry,'Fresh send',array['test@example.test'],'<fresh@example.test>');
 set local role service_role;
 select public.expire_stale_email_dispatches(test_inquiry) into n;
 if n<>1 then raise exception 'Expected one abandoned send, got %',n; end if;
 select public.expire_stale_email_dispatches(test_inquiry) into n;
 if n<>0 then raise exception 'Duplicate uncertainty alerts'; end if;
 reset role;
 if (select status from public.email_dispatches where id=old_id)<>'delivery_uncertain' then raise exception 'Abandoned send not blocked'; end if;
 if (select count(*) from public.ai_alerts where inquiry_id=test_inquiry and record_id=old_id and alert_type='EMAIL_DELIVERY_UNCERTAIN')<>1 then raise exception 'Missing uncertainty alert'; end if;
 if (select status from public.email_dispatches where idempotency_key='test-email-fresh-'||test_inquiry)<>'sending' then raise exception 'Fresh send expired'; end if;
 if has_function_privilege('anon','public.expire_stale_email_dispatches(uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.expire_stale_email_dispatches(uuid)','EXECUTE') then raise exception 'Client can expire email sends'; end if;
 if has_table_privilege('authenticated','public.email_dispatches','INSERT') or has_table_privilege('authenticated','public.email_dispatches','UPDATE') or has_table_privilege('authenticated','public.email_dispatches','DELETE') then raise exception 'Client can modify dispatch records'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id::text from public.profiles where role='admin' and status='active' limit 1),'role','authenticated')::text,true);
 set local role authenticated;
 if not exists(select 1 from public.email_dispatches where id=old_id) then raise exception 'Admin cannot read send status'; end if;
 reset role;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id::text from public.profiles where role='customer' and status='active' limit 1),'role','authenticated')::text,true);
 set local role authenticated;
 if exists(select 1 from public.email_dispatches) then raise exception 'Customer can read send status'; end if;
 reset role;
 set local role anon;
 begin
   perform id from public.email_dispatches limit 1;
   raise exception 'Anonymous dispatch access was allowed';
 exception when insufficient_privilege then null;
 end;
 reset role;
end $$;
rollback;
