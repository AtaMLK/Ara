create table public.email_dispatches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  payload_hash text not null check (length(payload_hash)=64),
  inquiry_id uuid references public.inquiries(id),
  subject text not null,
  recipients text[] not null,
  status text not null default 'sending' check(status in ('sending','sent','delivery_uncertain')),
  message_id text not null,
  provider_message_id text,
  thread_id text,
  sent_at timestamptz,
  error_text text,
  created_at timestamptz not null default now()
);
alter table public.email_dispatches enable row level security;
revoke all on public.email_dispatches from anon,authenticated;
grant select on public.email_dispatches to authenticated;
grant all on public.email_dispatches to service_role;
create policy email_dispatches_admin_select on public.email_dispatches
  for select to authenticated using ((select public.is_admin()));
create index email_dispatches_inquiry_idx on public.email_dispatches(inquiry_id);
create index email_dispatches_pending_idx on public.email_dispatches(created_at) where status='sending';

create function public.expire_stale_email_dispatches(p_inquiry_id uuid default null)
returns integer language sql security invoker set search_path='' as $$
  with expired as (
    update public.email_dispatches set status='delivery_uncertain',
      error_text='Sending was interrupted. Check the sent mailbox before any resend.'
    where status='sending' and created_at<now()-interval '5 minutes'
      and (p_inquiry_id is null or inquiry_id=p_inquiry_id)
    returning id,inquiry_id,subject
  ), alerts as (
    insert into public.ai_alerts(inquiry_id,record_type,record_id,agent_id,alert_type,message,priority)
    select inquiry_id,'email_dispatch',id,'orchestrator','EMAIL_DELIVERY_UNCERTAIN',
      'Email status needs checking: '||subject||'. Do not resend before checking the sent mailbox.','urgent'
    from expired returning id
  ) select count(*)::integer from alerts;
$$;
revoke all on function public.expire_stale_email_dispatches(uuid) from public,anon,authenticated;
grant execute on function public.expire_stale_email_dispatches(uuid) to service_role;
