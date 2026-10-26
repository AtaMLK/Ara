-- Running work sends heartbeats; absence means review is needed, not safe replay.
alter table public.ai_executions add column lease_token uuid;
alter table public.ai_executions add column heartbeat_at timestamptz;
create index ai_executions_running_heartbeat_idx
  on public.ai_executions ((coalesce(heartbeat_at,started_at,created_at)))
  where status='running';

create function public.expire_stale_ai_executions(p_inquiry_id uuid default null)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with expired as (
    update public.ai_executions
    set status='failed',error_code='WORKER_INTERRUPTED',
        error_message='Worker heartbeat was lost. Review partial results before retrying this stage.',
        completed_at=now()
    where status='running'
      and coalesce(heartbeat_at,started_at,created_at) < now()-interval '5 minutes'
      and (p_inquiry_id is null or inquiry_id=p_inquiry_id)
    returning id,inquiry_id,agent_id,error_message
  ), alerts as (
    insert into public.ai_alerts(inquiry_id,agent_id,alert_type,message,priority)
    select inquiry_id,agent_id,'WORKER_INTERRUPTED',
      'Execution '||id::text||': '||error_message,'urgent' from expired
    returning id
  )
  select count(*)::integer from alerts;
$$;
revoke all on function public.expire_stale_ai_executions(uuid) from public,anon,authenticated;
grant execute on function public.expire_stale_ai_executions(uuid) to service_role;
