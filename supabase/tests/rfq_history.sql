-- Run as database owner on seeded data. All fixtures and permission changes roll back.
begin;
set local statement_timeout='30s';
do $$
declare customer uuid; supplier uuid; admin_id uuid; customer_user uuid;
  inquiry uuid; sent_rfq uuid:=gen_random_uuid(); sending_rfq uuid:=gen_random_uuid();
  cancelled_rfq uuid:=gen_random_uuid(); rollback_rfq uuid:=gen_random_uuid();
  legacy_rfq uuid:=gen_random_uuid(); item uuid; communication uuid; result jsonb;
begin
 select id into customer from public.customers limit 1;
 select id into supplier from public.suppliers limit 1;
 select user_id into admin_id from public.profiles where role='admin' and status='active' limit 1;
 select user_id into customer_user from public.profiles where role='customer' limit 1;
 if customer is null or supplier is null or admin_id is null or customer_user is null then raise exception 'Seeded customer, supplier and Admin required'; end if;
 insert into public.inquiries(customer_id,reference,title) values(customer,'TEST-RFQ-'||gen_random_uuid()::text,'RFQ history regression') returning id into inquiry;
 insert into public.rfqs(id,inquiry_id,supplier_id,status,subject,body)
 values(sent_rfq,inquiry,supplier,'approved','Historical RFQ','Original request'),
 (sending_rfq,inquiry,supplier,'approved','Sending RFQ','Keep original'),
 (cancelled_rfq,inquiry,supplier,'draft','Draft RFQ','Keep original'),
 (rollback_rfq,inquiry,supplier,'draft','Audit rollback','Keep original'),
 (legacy_rfq,inquiry,supplier,'approved','Legacy key','Keep original');
 insert into public.rfq_items(rfq_id,requested_quantity,requested_data) values(sent_rfq,5,'{"model":"KEEP-ME"}') returning id into item;
 insert into public.communications(inquiry_id,supplier_id,rfq_id,direction,channel,body)
 values(inquiry,supplier,sent_rfq,'outgoing','email','Historical message') returning id into communication;
 insert into public.email_dispatches(idempotency_key,payload_hash,inquiry_id,subject,recipients,message_id)
 values('rfq-'||sent_rfq,repeat('a',64),inquiry,'Historical RFQ',array['test@example.test'],'<history@example.test>'),
 ('rfq-'||sending_rfq,repeat('a',64),inquiry,'Sending',array['test@example.test'],'<sending@example.test>'),
 ('rfq:'||legacy_rfq,repeat('a',64),inquiry,'Legacy',array['test@example.test'],'<legacy@example.test>');
 update public.email_dispatches set status='sent',provider_message_id='<accepted@example.test>',sent_at=now() where idempotency_key='rfq-'||sent_rfq;
 update public.rfqs set status='sent',sent_at=now() where id=sent_rfq;
 set local role service_role;
 result:=public.cancel_rfq_preserving_history(sent_rfq,admin_id,'Supplier no longer needed');
 if (result->>'already_cancelled')::boolean then raise exception 'First cancellation was skipped'; end if;
 result:=public.cancel_rfq_preserving_history(sent_rfq,admin_id,'A repeated request');
 if not (result->>'already_cancelled')::boolean then raise exception 'Repeated cancellation not idempotent'; end if;
 begin
   perform public.cancel_rfq_preserving_history(sending_rfq,admin_id,'Trying during send');
   raise exception 'Sending RFQ cancellation allowed';
 exception when check_violation then null;
 end;
 begin
   perform public.cancel_rfq_preserving_history(legacy_rfq,admin_id,'Trying legacy send');
   raise exception 'Legacy sending RFQ cancellation allowed';
 exception when check_violation then null;
 end;
 begin
   perform public.cancel_rfq_preserving_history(cancelled_rfq,customer_user,'Customer attempt');
   raise exception 'Customer actor accepted';
 exception when insufficient_privilege then null;
 end;
 perform public.cancel_rfq_preserving_history(cancelled_rfq,admin_id,'No longer required');
 begin
   insert into public.email_dispatches(idempotency_key,payload_hash,subject,recipients,message_id)
   values('rfq-'||cancelled_rfq,repeat('a',64),'Too late',array['test@example.test'],'<late@example.test>');
   raise exception 'Cancelled RFQ reserved an email';
 exception when check_violation then null;
 end;
 reset role;
 if not exists(select 1 from public.rfqs where id=sent_rfq and status='cancelled' and cancelled_by=admin_id and cancelled_at is not null and cancellation_reason='Supplier no longer needed' and sent_at is not null and body='Original request') then raise exception 'RFQ content or cancellation history lost'; end if;
 if not exists(select 1 from public.rfq_items where id=item and rfq_id=sent_rfq and requested_quantity=5 and requested_data->>'model'='KEEP-ME') then raise exception 'RFQ item history lost'; end if;
 if not exists(select 1 from public.communications where id=communication and rfq_id=sent_rfq and body='Historical message') then raise exception 'Communication detached or rewritten'; end if;
 if (select count(*) from public.audit_logs where record_id=sent_rfq and action='rfq_cancelled')<>1 then raise exception 'Missing/duplicate audit'; end if;
 if (select count(*) from public.timeline_events where inquiry_id=inquiry and event_type='rfq_cancelled' and metadata->>'rfq_id'=sent_rfq::text)<>1 then raise exception 'Missing/duplicate timeline'; end if;
 begin delete from public.rfqs where id=sent_rfq; raise exception 'RFQ hard delete allowed'; exception when check_violation then null; end;
 begin delete from public.rfq_items where id=item; raise exception 'Item hard delete allowed'; exception when check_violation then null; end;
 begin delete from public.communications where id=communication; raise exception 'Communication hard delete allowed'; exception when check_violation then null; end;
 begin update public.communications set rfq_id=null where id=communication; raise exception 'Detach allowed'; exception when check_violation then null; end;
 begin update public.rfq_items set rfq_id=rollback_rfq where id=item; raise exception 'Reparent allowed'; exception when check_violation then null; end;
 begin update public.rfqs set status='approved' where id=sent_rfq; raise exception 'Cancelled RFQ reopened'; exception when check_violation then null; end;
 -- An audit failure must roll back cancellation, rather than leaving an unaudited state.
 revoke insert on public.audit_logs from service_role;
 set local role service_role;
 begin
   perform public.cancel_rfq_preserving_history(rollback_rfq,admin_id,'Audit must succeed');
   raise exception 'Audit failure did not block cancellation';
 exception when insufficient_privilege then null;
 end;
 reset role;
 if (select status from public.rfqs where id=rollback_rfq)<>'draft' then raise exception 'Cancellation survived audit failure'; end if;
 if has_function_privilege('anon','public.cancel_rfq_preserving_history(uuid,uuid,text)','EXECUTE')
 or has_function_privilege('authenticated','public.cancel_rfq_preserving_history(uuid,uuid,text)','EXECUTE') then raise exception 'RPC exposed to clients'; end if;
end $$;
rollback;
