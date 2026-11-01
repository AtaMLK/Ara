-- Customer-safe quote projection and atomic decisions. Internal quote-item
-- tables remain protected; no customer SELECT/UPDATE policy is opened up.
create schema if not exists arat_private;
revoke all on schema arat_private from public, anon;
grant usage on schema arat_private to authenticated;

create or replace function arat_private.customer_quote_items(p_quote_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null or not exists (
    select 1 from public.customer_quotes q
    join public.customers c on c.id = q.customer_id
    join public.profiles p on p.user_id = c.user_id
    where q.id = p_quote_id and c.user_id = v_user_id
      and c.status = 'active' and p.role = 'customer' and p.status = 'active'
      and q.status in ('sent','accepted','rejected','revision_requested','superseded')
  ) then
    raise exception 'Quotation not available' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'quantity', i.quantity,
    'unit_price', i.unit_price,
    'total', i.total,
    'description', coalesce(nullif(to_jsonb(i)->>'description',''), sp.product_name, 'Quoted item'),
    'model', coalesce(nullif(to_jsonb(i)->>'model',''), sp.model_part_number),
    'brand', to_jsonb(i)->>'brand',
    'delivery_text', to_jsonb(i)->>'delivery_text'
  ) order by i.created_at, i.id), '[]'::jsonb)
  into v_result
  from public.customer_quote_items i
  left join public.supplier_products sp on sp.id = i.product_id
  where i.customer_quote_id = p_quote_id
    and coalesce((to_jsonb(i)->>'is_selected')::boolean, true);

  return v_result;
end;
$$;

create or replace function arat_private.customer_quote_decide(
  p_quote_id uuid, p_decision text, p_reason text default null, p_text text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_quote public.customer_quotes%rowtype;
  v_request_id uuid;
  v_status public.quote_status;
  v_event text;
  v_reason public.quote_decision_reason;
  v_text text := nullif(btrim(p_text), '');
  v_request public.quote_revision_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('accept','reject','revision') then
    raise exception 'Invalid quotation decision' using errcode = '22023';
  end if;
  if length(coalesce(v_text,'')) > 2000 then
    raise exception 'Decision text is too long' using errcode = '22023';
  end if;
  if p_decision = 'revision' and (p_reason is null or p_reason not in
    ('price','quantity','delivery_time','product_specification','payment_terms','other')) then
    raise exception 'Invalid revision reason' using errcode = '22023';
  end if;

  -- Serialize decisions for this quote and verify the active owner inside the
  -- privileged operation itself, independently of the page/server action.
  select q.* into v_quote from public.customer_quotes q
  join public.customers c on c.id = q.customer_id
  join public.profiles p on p.user_id = c.user_id
  where q.id = p_quote_id and c.user_id = v_user_id
    and c.status = 'active' and p.role = 'customer' and p.status = 'active'
  for update of q;
  if not found then
    raise exception 'Quotation not available' using errcode = '42501';
  end if;

  -- Safe retries do not duplicate timeline events or notifications.
  if (p_decision = 'accept' and v_quote.status = 'accepted') or
     (p_decision = 'reject' and v_quote.status = 'rejected') then
    return jsonb_build_object('ok',true,'inquiry_id',v_quote.inquiry_id,'already_applied',true);
  end if;
  if p_decision = 'revision' and v_quote.status = 'revision_requested' then
    select * into v_request from public.quote_revision_requests r
    where r.quote_id = v_quote.id and r.status = 'pending_approval'
      and r.requested_by = v_user_id
    order by r.created_at desc limit 1;
    if found and v_request.reason::text = p_reason and v_request.free_text is not distinct from v_text then
      return jsonb_build_object('ok',true,'inquiry_id',v_quote.inquiry_id,'request_id',v_request.id,'already_applied',true);
    end if;
  end if;
  if v_quote.status <> 'sent' then
    raise exception 'Only a sent quotation can receive this decision' using errcode = '23514';
  end if;
  if p_decision = 'accept' and v_quote.valid_until is not null and v_quote.valid_until < current_date then
    raise exception 'This quotation has expired. Please request a revised quotation.' using errcode = '23514';
  end if;

  -- Lock selected lines during acceptance and reject unpriced/empty offers.
  if p_decision = 'accept' then
    perform i.id from public.customer_quote_items i
    where i.customer_quote_id = v_quote.id
      and coalesce((to_jsonb(i)->>'is_selected')::boolean, true)
    for share;
    if not found or exists (
      select 1 from public.customer_quote_items i
      where i.customer_quote_id = v_quote.id
        and coalesce((to_jsonb(i)->>'is_selected')::boolean, true)
        and (i.price_status <> 'admin_confirmed' or i.unit_price is null
          or i.unit_price < 0 or i.unit_price::text in ('NaN','Infinity','-Infinity'))
    ) then
      raise exception 'Quotation prices are not ready for acceptance' using errcode = '23514';
    end if;
  end if;

  v_status := case p_decision when 'accept' then 'accepted'::public.quote_status
    when 'reject' then 'rejected'::public.quote_status else 'revision_requested'::public.quote_status end;
  v_event := case p_decision when 'accept' then 'customer_quote_accepted'
    when 'reject' then 'customer_quote_rejected' else 'customer_quote_revision_requested' end;
  v_reason := case when p_decision <> 'revision' then 'other'::public.quote_decision_reason
    when p_reason = 'price' then 'price_too_high'::public.quote_decision_reason
    when p_reason = 'quantity' then 'quantity_moq_issue'::public.quote_decision_reason
    when p_reason = 'delivery_time' then 'delivery_too_long'::public.quote_decision_reason
    when p_reason = 'product_specification' then 'product_specification_not_suitable'::public.quote_decision_reason
    when p_reason = 'payment_terms' then 'terms_not_suitable'::public.quote_decision_reason
    else 'other'::public.quote_decision_reason end;

  if p_decision = 'revision' then
    insert into public.quote_revision_requests(quote_id,reason,free_text,requested_by,status)
    values(v_quote.id,p_reason::public.revision_reason,v_text,v_user_id,'pending_approval')
    returning id into v_request_id;
  end if;
  update public.customer_quotes set status = v_status, decision_reason = v_reason,
    decision_text = coalesce(v_text,case p_decision when 'accept' then 'Accepted by customer'
      when 'reject' then 'Rejected by customer' else null end), decided_at = now()
  where id = v_quote.id;

  insert into public.timeline_events(inquiry_id,event_type,visibility,actor_type,actor_user_id,metadata)
  values(v_quote.inquiry_id,v_event,'customer','customer',v_user_id,
    jsonb_build_object('quote_id',v_quote.id,'reference',v_quote.reference,
      'request_id',v_request_id,'reason',p_reason));
  insert into public.notifications(user_id,category,priority,title,message,record_type,record_id,action_url)
  select p.user_id,'customer','normal',
    case p_decision when 'accept' then 'Customer accepted quotation'
      when 'reject' then 'Customer rejected quotation' else 'Customer requested a quotation revision' end,
    v_quote.reference || ': ' || replace(v_status::text,'_',' '),
    'customer_quote',v_quote.id,
    case p_decision when 'revision' then '/quotes/revisions' else '/quotes/' || v_quote.id::text end
  from public.profiles p where p.role = 'admin' and p.status = 'active';

  return jsonb_build_object('ok',true,'inquiry_id',v_quote.inquiry_id,'request_id',v_request_id);
end;
$$;

-- Only invoker wrappers are exposed through the Data API. The definer
-- implementations live outside exposed schemas and enforce auth/ownership.
create or replace function public.arat_customer_quote_items(p_quote_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select arat_private.customer_quote_items(p_quote_id); $$;
create or replace function public.arat_customer_quote_decide(
  p_quote_id uuid, p_decision text, p_reason text default null, p_text text default null
)
returns jsonb language sql security invoker set search_path = ''
as $$ select arat_private.customer_quote_decide(p_quote_id,p_decision,p_reason,p_text); $$;

revoke all on function arat_private.customer_quote_items(uuid) from public, anon;
revoke all on function arat_private.customer_quote_decide(uuid,text,text,text) from public, anon;
revoke all on function public.arat_customer_quote_items(uuid) from public, anon;
revoke all on function public.arat_customer_quote_decide(uuid,text,text,text) from public, anon;
grant execute on function arat_private.customer_quote_items(uuid) to authenticated;
grant execute on function arat_private.customer_quote_decide(uuid,text,text,text) to authenticated;
grant execute on function public.arat_customer_quote_items(uuid) to authenticated;
grant execute on function public.arat_customer_quote_decide(uuid,text,text,text) to authenticated;

-- Customer revisions must use the atomic transition rather than inserting a
-- request with a client-controlled status while leaving its quote unchanged.
drop policy if exists quote_revision_requests_customer_insert on public.quote_revision_requests;
