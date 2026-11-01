-- Integration test against the deployed ARAT schema. Every fixture and
-- decision is rolled back; no real quotation is accepted/rejected/edited.
begin;
set local statement_timeout = '20s';
select set_config('arat.test_customer', c.id::text, true),
  set_config('arat.test_user', c.user_id::text, true),
  set_config('arat.test_inquiry', i.id::text, true)
from public.customers c join public.profiles p on p.user_id=c.user_id
join public.inquiries i on i.customer_id=c.id
where c.status='active' and p.status='active' and p.role='customer' limit 1;
select set_config('arat.test_admin', user_id::text, true)
from public.profiles where role='admin' and status='active' limit 1;

do $$
declare v_id uuid; v_case text; v_other uuid;
begin
  if nullif(current_setting('arat.test_user',true),'') is null then
    raise exception 'A customer fixture context is required';
  end if;
  insert into public.customers(customer_code,customer_type,name,email,country,status)
  values('ARAT-TEST-'||gen_random_uuid(),'individual','Rollback test','rollback@example.invalid','TEST','active')
  returning id into v_other;
  foreach v_case in array array['accept','reject','revision','expired','unpriced','draft','other'] loop
    insert into public.customer_quotes(inquiry_id,customer_id,reference,status,currency,valid_until)
    values(current_setting('arat.test_inquiry')::uuid,
      case when v_case='other' then v_other else current_setting('arat.test_customer')::uuid end,
      'ARAT-TEST-'||gen_random_uuid(),
      case when v_case='draft' then 'draft'::public.quote_status else 'sent'::public.quote_status end,
      'EUR',case when v_case='expired' then current_date-1 else current_date+1 end)
    returning id into v_id;
    insert into public.customer_quote_items(customer_quote_id,quantity,unit_price,supplier_cost,supplier_currency,price_status)
    values(v_id,2,99.25,50,'EUR',case when v_case='unpriced' then 'suggested' else 'admin_confirmed' end);
    perform set_config('arat.test_'||v_case,v_id::text,true);
  end loop;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('arat.test_user'),true),
  set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_user'),'role','authenticated')::text,true);
do $$
declare v_items jsonb; v_result jsonb; v_case text; v_id uuid; v_failed boolean;
begin
  if current_user <> 'authenticated' then raise exception 'Wrong test role'; end if;
  v_items := public.arat_customer_quote_items(current_setting('arat.test_accept')::uuid);
  if jsonb_array_length(v_items) <> 1 or (v_items->0->>'total')::numeric <> 198.50 then
    raise exception 'Customer-safe items or total incorrect';
  end if;
  if (v_items->0) ?| array['supplier_cost','supplier_currency','price_calculation','supplier_quote_id','pricing_rule_id'] then
    raise exception 'Internal pricing leaked';
  end if;
  if exists(select 1 from public.customer_quote_items where customer_quote_id=current_setting('arat.test_accept')::uuid) then
    raise exception 'Underlying internal table was opened to the customer';
  end if;
  v_failed := false;
  begin
    insert into public.notifications(user_id,category,title,message)
    values(current_setting('arat.test_admin')::uuid,'customer','Unauthorized test','Should be denied');
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Customer could forge an admin notification'; end if;
  foreach v_case in array array['draft','other'] loop
    v_failed := false;
    begin
      perform public.arat_customer_quote_items(current_setting('arat.test_'||v_case)::uuid);
    exception when insufficient_privilege then v_failed := true;
    end;
    if not v_failed then raise exception 'Unauthorized read allowed: %',v_case; end if;
  end loop;
  v_failed := false;
  begin
    perform public.arat_customer_quote_decide(current_setting('arat.test_other')::uuid,'reject');
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Cross-customer decision allowed'; end if;

  foreach v_case in array array['expired','unpriced','draft'] loop
    v_failed := false;
    begin
      perform public.arat_customer_quote_decide(current_setting('arat.test_'||v_case)::uuid,'accept');
    exception when check_violation then v_failed := true;
    end;
    if not v_failed then raise exception 'Invalid acceptance allowed: %',v_case; end if;
  end loop;
  v_result := public.arat_customer_quote_decide(current_setting('arat.test_accept')::uuid,'accept');
  if v_result->>'ok' <> 'true' then raise exception 'Acceptance failed'; end if;
  v_result := public.arat_customer_quote_decide(current_setting('arat.test_accept')::uuid,'accept');
  if v_result->>'already_applied' <> 'true' then raise exception 'Acceptance retry not idempotent'; end if;
  perform public.arat_customer_quote_decide(current_setting('arat.test_reject')::uuid,'reject',null,'Test rejection');
  perform public.arat_customer_quote_decide(current_setting('arat.test_revision')::uuid,'revision','price','Test revision');
  v_result := public.arat_customer_quote_decide(current_setting('arat.test_revision')::uuid,'revision','price','Test revision');
  if v_result->>'already_applied' <> 'true' then raise exception 'Revision retry not idempotent'; end if;
end;
$$;
reset role;

do $$
declare v_case text; v_id uuid; v_expected text;
begin
  foreach v_case in array array['accept','reject','revision'] loop
    v_id := current_setting('arat.test_'||v_case)::uuid;
    v_expected := case v_case when 'accept' then 'accepted' when 'reject' then 'rejected' else 'revision_requested' end;
    if not exists(select 1 from public.customer_quotes where id=v_id and status::text=v_expected) then
      raise exception 'Wrong resulting state: %',v_case;
    end if;
    if (select count(*) from public.timeline_events where metadata->>'quote_id'=v_id::text) <> 1 then
      raise exception 'Missing/duplicate timeline event: %',v_case;
    end if;
    if (select count(*) from public.notifications where record_id=v_id) < 1 then
      raise exception 'Admin not notified: %',v_case;
    end if;
  end loop;
  if (select count(*) from public.quote_revision_requests where quote_id=current_setting('arat.test_revision')::uuid) <> 1 then
    raise exception 'Revision request not atomic/idempotent';
  end if;
  update public.profiles set status='inactive' where user_id=current_setting('arat.test_user')::uuid;
end;
$$;
set local role authenticated;
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.arat_customer_quote_items(current_setting('arat.test_accept')::uuid);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Inactive profile could read quotation'; end if;
end;
$$;
reset role;

set local role anon;
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.arat_customer_quote_items(current_setting('arat.test_accept')::uuid);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Anonymous function execution allowed'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('arat.test_admin'),true),
  set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('arat.test_admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_failed boolean := false;
begin
  insert into public.timeline_events(inquiry_id,event_type,visibility,actor_type,actor_user_id)
  values(current_setting('arat.test_inquiry')::uuid,'arat_rollback_test','customer','admin',current_setting('arat.test_admin')::uuid);
  insert into public.notifications(user_id,category,title,message)
  values(current_setting('arat.test_user')::uuid,'customer','Rollback test','Admin write test');
  begin
    perform public.arat_customer_quote_items(current_setting('arat.test_accept')::uuid);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Admin bypassed customer-only RPC role gate'; end if;
end;
$$;
reset role;
rollback;
select 'PASS: customer item privacy, ownership, decision states, expiry, retry, notifications, inactive and anonymous access; all fixtures rolled back' as result;
