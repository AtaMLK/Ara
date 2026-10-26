alter table public.rfqs add column cancelled_by uuid;
alter table public.rfqs add column cancelled_at timestamptz;
alter table public.rfqs add column cancellation_reason text;

create function public.preserve_rfq_records()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and tg_table_name='communications' and old.rfq_id is null then return old; end if;
  raise exception 'RFQ records, items and linked communications must be preserved. Cancel the RFQ instead.' using errcode='23514';
end $$;
create trigger preserve_rfq_delete before delete on public.rfqs for each row execute function public.preserve_rfq_records();
create trigger preserve_rfq_items_delete before delete on public.rfq_items for each row execute function public.preserve_rfq_records();
create trigger preserve_rfq_communications_delete before delete on public.communications for each row execute function public.preserve_rfq_records();
create trigger preserve_rfqs_truncate before truncate on public.rfqs for each statement execute function public.preserve_rfq_records();
create trigger preserve_rfq_items_truncate before truncate on public.rfq_items for each statement execute function public.preserve_rfq_records();
create trigger preserve_rfq_communications_truncate before truncate on public.communications for each statement execute function public.preserve_rfq_records();

create function public.preserve_rfq_links()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.rfq_id is not null and new.rfq_id is distinct from old.rfq_id then
    raise exception 'An existing RFQ history link cannot be removed or reassigned.' using errcode='23514';
  end if;
  return new;
end $$;
create trigger preserve_communication_rfq_link before update of rfq_id on public.communications for each row execute function public.preserve_rfq_links();
create trigger preserve_item_rfq_link before update of rfq_id on public.rfq_items for each row execute function public.preserve_rfq_links();

create function public.guard_rfq_dispatch()
returns trigger language plpgsql security invoker set search_path='' as $$
declare rfq_uuid uuid; rfq_state public.rfq_status;
begin
  -- Both current and historical operation-key formats identify an RFQ.
  if new.idempotency_key ~* '^rfq[:-][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if exists(select 1 from public.email_dispatches where idempotency_key=new.idempotency_key) then return new; end if;
    rfq_uuid:=substring(new.idempotency_key from 5)::uuid;
    select status into rfq_state from public.rfqs where id=rfq_uuid for update;
    if not found or rfq_state<>'approved' then
      raise exception 'Only an approved RFQ can reserve a new email send.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_rfq_email_reservation before insert on public.email_dispatches for each row execute function public.guard_rfq_dispatch();

create function public.cancel_rfq_preserving_history(p_rfq_id uuid,p_actor_id uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.rfqs; changed public.rfqs; reason text:=btrim(p_reason);
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_id and role='admin' and status='active') then
    raise exception 'Active Admin required' using errcode='42501';
  end if;
  if reason is null or length(reason)<3 or length(reason)>1000 then
    raise exception 'Enter a cancellation reason between 3 and 1000 characters.' using errcode='22023';
  end if;
  select * into saved from public.rfqs where id=p_rfq_id for update;
  if not found then raise exception 'RFQ not found' using errcode='P0002'; end if;
  if saved.status='cancelled' then
    return jsonb_build_object('id',saved.id,'inquiry_id',saved.inquiry_id,'already_cancelled',true);
  end if;
  if exists(select 1 from public.email_dispatches
    where idempotency_key in ('rfq-'||saved.id::text,'rfq:'||saved.id::text)
    and (status in ('sending','delivery_uncertain') or saved.status not in ('sent','completed'))) then
    raise exception 'RFQ delivery needs checking. Resolve its email status before cancellation.' using errcode='23514';
  end if;
  update public.rfqs set status='cancelled',cancelled_by=p_actor_id,cancelled_at=now(),cancellation_reason=reason
    where id=p_rfq_id returning * into changed;
  insert into public.audit_logs(actor_type,actor_user_id,action,record_type,record_id,before_data,after_data)
    values('admin',p_actor_id,'rfq_cancelled','rfq',saved.id,to_jsonb(saved),to_jsonb(changed));
  insert into public.timeline_events(inquiry_id,event_type,visibility,actor_type,actor_user_id,metadata)
    values(saved.inquiry_id,'rfq_cancelled','admin','admin',p_actor_id,
      jsonb_build_object('rfq_id',saved.id,'previous_status',saved.status,'reason',reason,'email_recalled',false));
  return jsonb_build_object('id',saved.id,'inquiry_id',saved.inquiry_id,'already_cancelled',false);
end $$;
revoke all on function public.cancel_rfq_preserving_history(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_rfq_preserving_history(uuid,uuid,text) to service_role;
revoke all on function public.preserve_rfq_records() from public,anon,authenticated;
revoke all on function public.preserve_rfq_links() from public,anon,authenticated;
revoke all on function public.guard_rfq_dispatch() from public,anon,authenticated;

create function public.guard_rfq_cancellation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status='cancelled' and (
    new.status<>'cancelled' or new.cancelled_by is distinct from old.cancelled_by
    or new.cancelled_at is distinct from old.cancelled_at
    or new.cancellation_reason is distinct from old.cancellation_reason
  ) then
    raise exception 'Cancelled RFQs and their cancellation history cannot be reopened or rewritten.' using errcode='23514';
  end if;
  if new.status='cancelled' and old.status<>'cancelled' then
    if new.cancelled_at is null or length(btrim(coalesce(new.cancellation_reason,''))) not between 3 and 1000
      or not exists(select 1 from public.profiles where user_id=new.cancelled_by and role='admin' and status='active') then
      raise exception 'RFQ cancellation requires an active Admin, timestamp and reason.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_rfq_cancellation before update on public.rfqs for each row execute function public.guard_rfq_cancellation();
revoke all on function public.guard_rfq_cancellation() from public,anon,authenticated;
