-- Run after the customer integration test context, within its rollback transaction.
reset role;
select set_config('request.jwt.claim.sub',current_setting('arat.test_admin'),true),
 set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare req uuid; result jsonb; retry jsonb; new_id uuid; supplier_id uuid; again uuid; failed boolean;
begin
 select id into strict req from public.quote_revision_requests where quote_id=current_setting('arat.test_revision')::uuid;
 result:=public.arat_admin_quote_revision_review(req,'approve');
 new_id:=(result->>'new_quote_id')::uuid;
 retry:=public.arat_admin_quote_revision_review(req,'approve');
 if retry->>'already_applied'<>'true' or (retry->>'new_quote_id')::uuid<>new_id then raise exception 'Review retry cloned another quote'; end if;
 if (select status from public.customer_quotes where id=new_id)<>'draft' then raise exception 'Revision is not a draft'; end if;
 if (select status from public.customer_quotes where id=current_setting('arat.test_revision')::uuid)<>'superseded' then raise exception 'Old quote not superseded'; end if;
 if (select count(*) from public.customer_quote_items where customer_quote_id=new_id)<>1 or exists(select 1 from public.customer_quote_items where customer_quote_id=new_id and price_status<>'suggested') then raise exception 'Revision item copy/reset failed'; end if;
 if (select count(*) from public.audit_logs where record_id=req and action='quote_revision_approve')<>1 then raise exception 'Review audit duplicated'; end if;
 supplier_id:=public.arat_resolve_discovered_supplier('ARAT Rollback Supplier','TEST','https://arat-rollback.example.invalid',null);
 again:=public.arat_resolve_discovered_supplier('ARAT Rollback Supplier','TEST','https://www.arat-rollback.example.invalid/catalog',null);
 if supplier_id<>again then raise exception 'Supplier identity resolver duplicated the supplier'; end if;
 failed:=false;
 begin perform public.arat_resolve_discovered_supplier('We are an authorized GMI','TEST','https://arat-rollback.example.invalid',null);
 exception when check_violation then failed:=true; end;
 if not failed then raise exception 'Invalid supplier name accepted'; end if;
end; $$;
reset role;
do $$
declare failed boolean:=false; key text:='ARAT-ROLLBACK-'||gen_random_uuid();
begin
 insert into public.email_dispatches(idempotency_key,payload_hash,subject,recipients,message_id) values(key,repeat('a',64),'Rollback test',array['rollback@example.invalid'],'<rollback@arat.invalid>');
 begin insert into public.email_dispatches(idempotency_key,payload_hash,subject,recipients,message_id) values(key,repeat('a',64),'Rollback test',array['rollback@example.invalid'],'<rollback@arat.invalid>');
 exception when unique_violation then failed:=true; end;
 if not failed then raise exception 'Email reservation uniqueness missing'; end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('arat.test_user'),true),
 set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_user'),'role','authenticated')::text,true);
do $$
declare failed boolean:=false;
begin
 begin perform public.arat_admin_quote_revision_review(gen_random_uuid(),'approve'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Customer could review revision'; end if;
end; $$;
reset role;
