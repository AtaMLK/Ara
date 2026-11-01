-- The result pointer makes reviewed requests safe to retry without cloning
-- another quote. All review/clone/event writes below are one transaction.
alter table public.quote_revision_requests add column if not exists result_quote_id uuid
  references public.customer_quotes(id) on delete restrict;
create index if not exists quote_revision_requests_quote_id_idx on public.quote_revision_requests(quote_id);

create or replace function arat_private.admin_quote_revision_review(p_request_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_quote_id uuid;
  v_quote public.customer_quotes%rowtype;
  v_request public.quote_revision_requests%rowtype;
  v_new_id uuid;
  v_reference text;
  v_customer_user uuid;
begin
  if v_user is null or not public.is_admin() then
    raise exception 'Active admin access required' using errcode='42501';
  end if;
  if p_decision is null or p_decision not in ('approve','reject') then
    raise exception 'Invalid review decision' using errcode='22023';
  end if;
  select quote_id into v_quote_id from public.quote_revision_requests where id=p_request_id;
  if not found then raise exception 'Revision request not found' using errcode='P0002'; end if;
  -- Always lock quotation before request, matching the customer decision path.
  select * into v_quote from public.customer_quotes where id=v_quote_id for update;
  select * into v_request from public.quote_revision_requests where id=p_request_id for update;
  if v_request.status='approved' and p_decision='approve' and v_request.result_quote_id is not null then
    return jsonb_build_object('ok',true,'decision','approved','inquiry_id',v_quote.inquiry_id,
      'new_quote_id',v_request.result_quote_id,'already_applied',true);
  end if;
  if v_request.status='rejected' and p_decision='reject' then
    return jsonb_build_object('ok',true,'decision','rejected','inquiry_id',v_quote.inquiry_id,'already_applied',true);
  end if;
  if v_request.status <> 'pending_approval' or v_quote.status <> 'revision_requested' then
    raise exception 'This revision request is no longer awaiting review' using errcode='23514';
  end if;

  select user_id into v_customer_user from public.customers where id=v_quote.customer_id;
  if p_decision='approve' then
    if not exists(select 1 from public.customer_quote_items where customer_quote_id=v_quote.id) then
      raise exception 'The original quotation has no items to revise' using errcode='23514';
    end if;
    v_reference := regexp_replace(v_quote.reference,'-R[0-9]+$','','i')||'-R'||(v_quote.revision_number+1)::text;
    insert into public.customer_quotes(inquiry_id,customer_id,parent_quote_id,reference,display_reference,
      revision_number,status,currency,valid_until,subject,body)
    values(v_quote.inquiry_id,v_quote.customer_id,v_quote.id,v_reference,v_reference,
      v_quote.revision_number+1,'draft',v_quote.currency,
      case when v_quote.valid_until >= current_date then v_quote.valid_until else null end,v_quote.subject,v_quote.body)
    returning id into v_new_id;

    insert into public.customer_quote_items(customer_quote_id,product_id,supplier_quote_id,quantity,unit_price,
      supplier_cost,supplier_currency,exchange_rate_id,price_status,pricing_rule_id,price_calculation,
      description,model,brand,delivery_text,is_selected)
    select v_new_id,product_id,supplier_quote_id,quantity,unit_price,
      supplier_cost,supplier_currency,exchange_rate_id,'suggested',pricing_rule_id,price_calculation,
      description,model,brand,delivery_text,is_selected
    from public.customer_quote_items where customer_quote_id=v_quote.id;

    update public.customer_quotes set status='superseded' where id=v_quote.id;
    update public.quote_revision_requests set status='approved',reviewed_by=v_user,reviewed_at=now(),result_quote_id=v_new_id
    where id=v_request.id;
  else
    update public.customer_quotes set status='sent',decision_reason=null,decision_text=null,decided_at=null where id=v_quote.id;
    update public.quote_revision_requests set status='rejected',reviewed_by=v_user,reviewed_at=now() where id=v_request.id;
  end if;

  insert into public.timeline_events(inquiry_id,event_type,visibility,actor_type,actor_user_id,metadata)
  values(v_quote.inquiry_id,case p_decision when 'approve' then 'customer_quote_revision_created' else 'customer_quote_revision_rejected' end,
    'customer','admin',v_user,jsonb_build_object('old_quote_id',v_quote.id,'quote_id',v_quote.id,
      'new_quote_id',v_new_id,'request_id',v_request.id,'reference',coalesce(v_reference,v_quote.reference)));
  if v_customer_user is not null then
    insert into public.notifications(user_id,category,priority,title,message,record_type,record_id,action_url)
    values(v_customer_user,'customer','normal',
      case p_decision when 'approve' then 'Quotation revision in progress' else 'Revision request reviewed' end,
      case p_decision when 'approve' then 'A revised quotation is being prepared.' else 'Your quotation revision request was not approved.' end,
      'customer_quote',coalesce(v_new_id,v_quote.id),'/customer/inquiries/'||v_quote.inquiry_id::text);
  end if;
  insert into public.audit_logs(actor_type,actor_user_id,action,record_type,record_id,before_data,after_data)
  values('admin',v_user,'quote_revision_'||p_decision,'quote_revision_request',v_request.id,
    jsonb_build_object('status',v_request.status),jsonb_build_object('status',case p_decision when 'approve' then 'approved' else 'rejected' end,'new_quote_id',v_new_id));
  return jsonb_build_object('ok',true,'decision',case p_decision when 'approve' then 'approved' else 'rejected' end,
    'inquiry_id',v_quote.inquiry_id,'new_quote_id',v_new_id,'reference',v_reference);
end;
$$;
create or replace function public.arat_admin_quote_revision_review(p_request_id uuid,p_decision text)
returns jsonb language sql security invoker set search_path=''
as $$ select arat_private.admin_quote_revision_review(p_request_id,p_decision); $$;
revoke all on function arat_private.admin_quote_revision_review(uuid,text) from public,anon;
revoke all on function public.arat_admin_quote_revision_review(uuid,text) from public,anon;
grant execute on function arat_private.admin_quote_revision_review(uuid,text) to authenticated;
grant execute on function public.arat_admin_quote_revision_review(uuid,text) to authenticated;

-- Keep historical supplier IDs and all their commercial foreign keys intact.
-- Duplicate records become inactive aliases; suspicious names enter review.
alter table public.suppliers add column if not exists canonical_supplier_id uuid references public.suppliers(id) on delete restrict;
alter table public.suppliers add column if not exists identity_needs_review boolean not null default false;
alter table public.suppliers add column if not exists identity_review_reason text;
alter table public.suppliers add constraint suppliers_no_self_alias check(canonical_supplier_id is distinct from id);
create index if not exists suppliers_canonical_supplier_idx on public.suppliers(canonical_supplier_id);
create index if not exists suppliers_identity_review_idx on public.suppliers(identity_needs_review) where deleted_at is null and canonical_supplier_id is null;

create or replace function arat_private.supplier_name_key(p_name text)
returns text language sql immutable security invoker set search_path=''
as $$ select regexp_replace(lower(btrim(p_name)),'[^[:alnum:]]','','g'); $$;
create or replace function arat_private.supplier_site_key(p_url text)
returns text language sql immutable security invoker set search_path=''
as $$ select regexp_replace(lower(substring(p_url from '^https?://([^/:?#]+)')),'^(www|us|de|uk|en|tr|eu)\.','','i'); $$;
create or replace function arat_private.supplier_name_issue(p_name text)
returns text language sql immutable security invoker set search_path=''
as $$ select case
  when p_name is null or length(btrim(p_name)) < 2 then 'Company name is missing or too short'
  when length(p_name)>160 or cardinality(regexp_split_to_array(btrim(p_name),'\s+'))>14 then 'Search-result text must not be used as a company name'
  when p_name ~* '(^|\s)(we are|this is|the (single|dual|quadruple)|product categories)(\s|$)' then 'Company identity was extracted from a sentence fragment'
  when p_name ~* '^[[:alpha:]]{1,4}[- ]?[0-9]{3,}[[:alnum:]-]*$' then 'A product code was used as a company name'
  when lower(btrim(p_name)) in ('repeater power','transmitter power','single channel repeater power','dual channel repeater power') then 'A product category was used as a company name'
  when p_name ~* '(dual.output accelerometer|top exit|loop.powered digital|analog input module)' then 'A product description was used as a company name'
  else null end; $$;

create or replace function arat_private.guard_supplier_identity()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_issue text := arat_private.supplier_name_issue(new.legal_name);
begin
  new.identity_needs_review := v_issue is not null;
  new.identity_review_reason := v_issue;
  if new.canonical_supplier_id is not null then new.status := 'inactive'; end if;
  if v_issue is not null and tg_op='UPDATE' and new.verification_status is distinct from old.verification_status and new.verification_status='verified' then
    raise exception 'Supplier identity needs review before verification' using errcode='23514';
  end if;
  return new;
end; $$;
revoke all on function arat_private.guard_supplier_identity() from public,anon,authenticated;
create trigger arat_supplier_identity_guard before insert or update of legal_name,verification_status,canonical_supplier_id
on public.suppliers for each row execute function arat_private.guard_supplier_identity();

-- Only link records when BOTH the normalized name and website identity agree.
-- Country conflicts stay separate for human review. No ID is hardcoded.
do $$
declare v_source public.suppliers%rowtype; v_target uuid;
begin
  for v_source in select * from public.suppliers where deleted_at is null and canonical_supplier_id is null order by created_at,id loop
    select t.id into v_target from public.suppliers t
    where t.id<>v_source.id and t.deleted_at is null and t.canonical_supplier_id is null
      and arat_private.supplier_name_key(t.legal_name)=arat_private.supplier_name_key(v_source.legal_name)
      and (t.primary_country is null or v_source.primary_country is null or lower(t.primary_country)='unknown'
        or lower(v_source.primary_country)='unknown' or lower(t.primary_country)=lower(v_source.primary_country))
      and exists(select 1 from public.supplier_websites a join public.supplier_websites b
        on arat_private.supplier_site_key(a.url)=arat_private.supplier_site_key(b.url)
        where a.supplier_id=t.id and b.supplier_id=v_source.id)
      and ((t.verification_status='verified')::int, -extract(epoch from t.created_at),t.id::text)
        > ((v_source.verification_status='verified')::int,-extract(epoch from v_source.created_at),v_source.id::text)
    order by (t.verification_status='verified') desc,t.created_at,t.id limit 1;
    if v_target is not null then
      update public.suppliers set canonical_supplier_id=v_target,status='inactive' where id=v_source.id;
      insert into public.audit_logs(actor_type,action,record_type,record_id,before_data,after_data,metadata)
      values('system','supplier_duplicate_linked','supplier',v_source.id,to_jsonb(v_source),
        jsonb_build_object('canonical_supplier_id',v_target,'status','inactive'),
        jsonb_build_object('evidence','Matching normalized legal name and website identity; historical references preserved'));
    end if;
  end loop;
end; $$;

with flagged as (
  select s.id,to_jsonb(s) as previous,arat_private.supplier_name_issue(s.legal_name) as issue
  from public.suppliers s where s.deleted_at is null and s.canonical_supplier_id is null
    and arat_private.supplier_name_issue(s.legal_name) is not null
), changed as (
  update public.suppliers s set identity_needs_review=true,identity_review_reason=f.issue
  from flagged f where s.id=f.id returning s.id,f.previous,f.issue
)
insert into public.audit_logs(actor_type,action,record_type,record_id,before_data,after_data)
select 'system','supplier_identity_flagged','supplier',id,previous,
  jsonb_build_object('identity_needs_review',true,'reason',issue) from changed;

create or replace function arat_private.resolve_discovered_supplier(p_name text,p_country text,p_website text,p_description text default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_website_id uuid; v_key text:=arat_private.supplier_name_key(p_name); v_site text:=arat_private.supplier_site_key(p_website);
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' and not public.is_admin() then
    raise exception 'Admin or server access required' using errcode='42501';
  end if;
  if arat_private.supplier_name_issue(p_name) is not null then
    raise exception 'Supplier name requires identity review' using errcode='23514';
  end if;
  if v_site is null or v_site !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'A valid supplier website is required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
  select s.id into v_id from public.suppliers s
  where s.deleted_at is null and s.canonical_supplier_id is null and not s.identity_needs_review
    and arat_private.supplier_name_key(s.legal_name)=v_key
    and exists(select 1 from public.supplier_websites w where w.supplier_id=s.id and arat_private.supplier_site_key(w.url)=v_site)
    and (s.primary_country is null or p_country is null or lower(s.primary_country)='unknown'
      or lower(p_country)='unknown' or lower(s.primary_country)=lower(p_country))
  order by (s.verification_status='verified') desc,s.created_at,s.id limit 1;
  if found then return v_id; end if;
  insert into public.suppliers(legal_name,primary_country,status,supplier_type,verification_status,description)
  values(btrim(p_name),coalesce(nullif(btrim(p_country),''),'Unknown'),'active','unknown','pending',left(p_description,2000)) returning id into v_id;
  insert into public.supplier_websites(supplier_id,url,is_primary) values(v_id,p_website,true) returning id into v_website_id;
  update public.suppliers set primary_website_id=v_website_id where id=v_id;
  return v_id;
end; $$;
create or replace function public.arat_resolve_discovered_supplier(p_name text,p_country text,p_website text,p_description text default null)
returns uuid language sql security invoker set search_path=''
as $$ select arat_private.resolve_discovered_supplier(p_name,p_country,p_website,p_description); $$;
grant usage on schema arat_private to service_role;
revoke all on function arat_private.resolve_discovered_supplier(text,text,text,text) from public,anon;
revoke all on function public.arat_resolve_discovered_supplier(text,text,text,text) from public,anon;
grant execute on function arat_private.resolve_discovered_supplier(text,text,text,text) to authenticated,service_role;
grant execute on function public.arat_resolve_discovered_supplier(text,text,text,text) to authenticated,service_role;

create or replace function arat_private.review_supplier_identity(p_supplier_id uuid,p_name text,p_country text,p_source_url text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_before public.suppliers%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Active admin access required' using errcode='42501'; end if;
  if arat_private.supplier_name_issue(p_name) is not null then raise exception 'Enter a company name, not a product description' using errcode='22023'; end if;
  if arat_private.supplier_site_key(p_source_url) is null then raise exception 'An identity source URL is required' using errcode='22023'; end if;
  select * into v_before from public.suppliers where id=p_supplier_id and deleted_at is null and canonical_supplier_id is null for update;
  if not found then raise exception 'Canonical supplier not found' using errcode='P0002'; end if;
  update public.suppliers set legal_name=btrim(p_name),primary_country=coalesce(nullif(btrim(p_country),''),primary_country),
    verification_status='pending',last_verified_at=null where id=p_supplier_id;
  insert into public.supplier_sources(supplier_id,source_type,source_url,source_name,evidence)
  values(p_supplier_id,'Admin identity review',p_source_url,btrim(p_name),jsonb_build_object('reviewed_by',auth.uid()));
  insert into public.audit_logs(actor_type,actor_user_id,action,record_type,record_id,before_data,after_data)
  values('admin',auth.uid(),'supplier_identity_corrected','supplier',p_supplier_id,to_jsonb(v_before),
    jsonb_build_object('legal_name',btrim(p_name),'verification_status','pending','source_url',p_source_url));
end; $$;
create or replace function public.arat_review_supplier_identity(p_supplier_id uuid,p_name text,p_country text,p_source_url text)
returns void language sql security invoker set search_path=''
as $$ select arat_private.review_supplier_identity(p_supplier_id,p_name,p_country,p_source_url); $$;
revoke all on function arat_private.review_supplier_identity(uuid,text,text,text) from public,anon;
revoke all on function public.arat_review_supplier_identity(uuid,text,text,text) from public,anon;
grant execute on function arat_private.review_supplier_identity(uuid,text,text,text) to authenticated;
grant execute on function public.arat_review_supplier_identity(uuid,text,text,text) to authenticated;

-- Invalid identities and inactive duplicate aliases cannot enter new RFQs.
create or replace function arat_private.guard_rfq_supplier_identity()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='INSERT' or new.supplier_id is distinct from old.supplier_id or
    (new.status is distinct from old.status and new.status in ('approved','sent')) then
    if not exists(select 1 from public.suppliers s where s.id=new.supplier_id and s.deleted_at is null
      and s.status='active' and s.canonical_supplier_id is null and not s.identity_needs_review) then
      raise exception 'Supplier identity must be resolved before creating or sending an RFQ' using errcode='23514';
    end if;
  end if;
  return new;
end; $$;
revoke all on function arat_private.guard_rfq_supplier_identity() from public,anon,authenticated;
create trigger arat_rfq_supplier_identity_guard before insert or update of supplier_id,status on public.rfqs
for each row execute function arat_private.guard_rfq_supplier_identity();
