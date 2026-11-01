begin;
set local statement_timeout='20s';
select set_config('arat.test_admin',user_id::text,true) from public.profiles where role='admin' and status='active' limit 1;
select set_config('arat.test_user',user_id::text,true) from public.profiles where role='customer' and status='active' limit 1;
with inserted as (insert into public.notifications(user_id,category,title,message,action_url) values(current_setting('arat.test_admin')::uuid,'customer','Rollback notification test','Temporary fixture','/quotes/revisions') returning id)
select set_config('arat.test_notification',id::text,true) from inserted;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('arat.test_user'),true),set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_user'),'role','authenticated')::text,true);
do $$ declare n integer; begin
 if exists(select 1 from public.notifications where id=current_setting('arat.test_notification')::uuid) then raise exception 'Customer read admin notification';end if;
 update public.notifications set read_at=now() where id=current_setting('arat.test_notification')::uuid;
 get diagnostics n=row_count;if n<>0 then raise exception 'Customer changed admin notification';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('arat.test_admin'),true),set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_admin'),'role','authenticated')::text,true);
do $$ declare n integer; begin
 if not exists(select 1 from public.notifications where id=current_setting('arat.test_notification')::uuid and read_at is null) then raise exception 'Own unread notification missing';end if;
 update public.notifications set read_at=now() where id=current_setting('arat.test_notification')::uuid and user_id=auth.uid() and read_at is null;
 get diagnostics n=row_count;if n<>1 then raise exception 'Own read marker failed';end if;
 if not exists(select 1 from public.notifications where id=current_setting('arat.test_notification')::uuid and read_at is not null) then raise exception 'Read marker missing';end if;
end $$;
reset role;
rollback;
select 'PASS: unread ownership, cross-user read/update denial and own read marker; all changes rolled back' as result;
