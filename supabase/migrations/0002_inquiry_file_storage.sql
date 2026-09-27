-- ARAT MVP database foundation
-- Supabase / PostgreSQL
-- Auth users are managed by Supabase Auth. Public application tables reference auth.users.

create extension if not exists pgcrypto;

create type public.user_role as enum ('admin','customer');
create type public.customer_type as enum ('company','individual');
create type public.account_status as enum ('active','inactive');
create type public.inquiry_status as enum ('processing','open','clarification_required','researching','rfq','quoting','converted','no_suitable_supplier','closed');
create type public.inquiry_priority as enum ('normal','urgent');
create type public.requirement_type as enum ('product','model_part_number','quantity','specification','delivery','other');
create type public.requirement_status as enum ('open','clarification_required','confirmed','rejected');
create type public.requirement_source as enum ('customer_text','pdf','excel','image','clarification');
create type public.file_status as enum ('uploaded','processing','processed','processing_failed','archived');
create type public.research_status as enum ('pending','running','completed','failed','stopped');
create type public.verification_status as enum ('unverified','pending','verified','rejected');
create type public.supplier_status as enum ('active','inactive');
create type public.supplier_type as enum ('manufacturer','official_distributor','distributor','representative','reseller','trading_company','unknown');
create type public.candidate_status as enum ('proposed','admin_removed','admin_rejected','finalized');
create type public.product_status as enum ('active','inactive');
create type public.contact_status as enum ('active','inactive');
create type public.rfq_status as enum ('draft','pending_approval','approved','sent','cancelled','completed');
create type public.supplier_response_status as enum ('received','processing','processed','failed');
create type public.match_status as enum ('match','partial_match','mismatch','unknown');
create type public.quote_status as enum ('draft','pending_approval','sent','accepted','rejected','expired','revision_requested');
create type public.quote_decision_reason as enum ('price_too_high','delivery_too_long','product_specification_not_suitable','quantity_moq_issue','terms_not_suitable','no_longer_needed','bought_elsewhere','other');
create type public.revision_reason as enum ('price','quantity','delivery_time','product_specification','payment_terms','other');
create type public.notification_category as enum ('approval','task','ai_alert','customer','supplier','email','system');
create type public.notification_priority as enum ('normal','urgent');
create type public.ai_execution_status as enum ('queued','running','succeeded','failed','cancelled');
create type public.ai_alert_status as enum ('open','read');
create type public.timeline_visibility as enum ('admin','customer');
create type public.actor_type as enum ('admin','customer','ai','system');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role public.user_role not null,
  display_name text,
  language text not null default 'en',
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete restrict,
  customer_code text unique not null,
  customer_type public.customer_type not null,
  name text not null,
  email text not null,
  company_name text,
  country text not null,
  phone text,
  address text,
  tax_registration text,
  notes text,
  status public.account_status not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((customer_type='company' and company_name is not null) or customer_type='individual')
);

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  reference text unique not null,
  title text not null,
  description text,
  status public.inquiry_status not null default 'processing',
  priority public.inquiry_priority not null default 'normal',
  original_customer_text text,
  normalized_information jsonb not null default '{}'::jsonb,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inquiry_files (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  file_size bigint not null,
  version integer not null default 1,
  status public.file_status not null default 'uploaded',
  uploaded_by uuid references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.document_processing (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.inquiry_files(id) on delete restrict,
  processor text not null,
  status public.file_status not null default 'processing',
  extracted_text text,
  extracted_data jsonb not null default '{}'::jsonb,
  quality_flags jsonb not null default '[]'::jsonb,
  source_map jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  type public.requirement_type not null,
  value text not null,
  status public.requirement_status not null default 'open',
  source public.requirement_source not null,
  source_ref text,
  admin_edited boolean not null default false,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.requirement_history (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements(id) on delete restrict,
  old_value text,
  new_value text,
  old_status public.requirement_status,
  new_status public.requirement_status,
  actor_type public.actor_type not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  agent_id text,
  reason text,
  created_at timestamptz not null default now()
);

create table public.clarifications (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  requirement_id uuid references public.requirements(id) on delete restrict,
  question text not null,
  answer text,
  status text not null default 'draft' check (status in ('draft','pending_approval','sent','answered','cancelled')),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  sent_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.research_cases (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  status public.research_status not null default 'pending',
  scope jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.research_results (
  id uuid primary key default gen_random_uuid(),
  research_case_id uuid not null references public.research_cases(id) on delete restrict,
  source_type text not null,
  source_name text,
  source_url text,
  retrieved_at timestamptz not null default now(),
  finding text not null,
  structured_data jsonb not null default '{}'::jsonb,
  relevance text,
  confidence numeric(5,4),
  disposition text not null default 'kept',
  evidence jsonb not null default '{}'::jsonb
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  primary_country text not null,
  status public.supplier_status not null default 'active',
  supplier_type public.supplier_type not null default 'unknown',
  verification_status public.verification_status not null default 'unverified',
  primary_contact_id uuid,
  primary_website_id uuid,
  primary_email_id uuid,
  primary_phone_id uuid,
  primary_address_id uuid,
  description text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_candidates (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  proposed_name text not null,
  proposed_country text,
  proposed_website text,
  match_evidence jsonb not null default '{}'::jsonb,
  availability_evidence jsonb not null default '{}'::jsonb,
  verification_evidence jsonb not null default '{}'::jsonb,
  status public.candidate_status not null default 'proposed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(inquiry_id, proposed_name)
);

create table public.supplier_type_history (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  old_type public.supplier_type,
  new_type public.supplier_type not null,
  changed_by uuid references auth.users(id) on delete restrict,
  agent_id text,
  created_at timestamptz not null default now()
);

create table public.supplier_countries (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  country text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(supplier_id,country)
);

create table public.supplier_sources (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  source_type text not null,
  source_url text,
  source_name text,
  evidence jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now()
);

create table public.supplier_verification_history (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  old_status public.verification_status,
  new_status public.verification_status not null,
  reason text,
  explanation text,
  changed_by uuid references auth.users(id) on delete restrict,
  agent_id text,
  created_at timestamptz not null default now()
);

create table public.supplier_websites (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  url text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.supplier_emails (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  email text not null,
  is_primary boolean not null default false,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_phones (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  phone text not null,
  is_primary boolean not null default false,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_addresses (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  address text not null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.supplier_brands (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  name text not null,
  country_of_origin text,
  is_unknown boolean not null default false,
  is_suggested boolean not null default false,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(supplier_id,name)
);

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  brand_id uuid references public.supplier_brands(id) on delete restrict,
  product_name text not null,
  model_part_number text,
  description text,
  status public.product_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_change_proposals (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.supplier_products(id) on delete restrict,
  proposed_patch jsonb not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending_approval' check(status in ('pending_approval','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  name text not null,
  email text,
  phone text,
  job_title text,
  department text,
  country text,
  professional_profile text,
  notes text,
  status public.contact_status not null default 'active',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suppliers
  add constraint suppliers_primary_contact_fk foreign key (primary_contact_id) references public.supplier_contacts(id) on delete restrict;
alter table public.suppliers
  add constraint suppliers_primary_website_fk foreign key (primary_website_id) references public.supplier_websites(id) on delete restrict;
alter table public.suppliers
  add constraint suppliers_primary_email_fk foreign key (primary_email_id) references public.supplier_emails(id) on delete restrict;
alter table public.suppliers
  add constraint suppliers_primary_phone_fk foreign key (primary_phone_id) references public.supplier_phones(id) on delete restrict;
alter table public.suppliers
  add constraint suppliers_primary_address_fk foreign key (primary_address_id) references public.supplier_addresses(id) on delete restrict;

create table public.rfqs (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status public.rfq_status not null default 'draft',
  subject text,
  body text,
  sender_email text,
  recipient_email text,
  approval_required boolean not null default true,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.rfq_items (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete restrict,
  requirement_id uuid references public.requirements(id) on delete restrict,
  product_id uuid references public.supplier_products(id) on delete restrict,
  requested_quantity numeric,
  requested_data jsonb not null default '{}'::jsonb
);

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid references public.inquiries(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  rfq_id uuid references public.rfqs(id) on delete restrict,
  quote_id uuid,
  direction text not null check(direction in ('incoming','outgoing')),
  channel text not null default 'email',
  provider_message_id text,
  thread_id text,
  subject text,
  body text,
  sent_at timestamptz,
  received_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.unmatched_emails (
  id uuid primary key default gen_random_uuid(),
  communication_id uuid not null references public.communications(id) on delete restrict,
  reason text not null,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.supplier_responses (
  id uuid primary key default gen_random_uuid(),
  communication_id uuid references public.communications(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  status public.supplier_response_status not null default 'received',
  raw_extraction jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  supplier_response_id uuid not null references public.supplier_responses(id) on delete restrict,
  product_id uuid references public.supplier_products(id) on delete restrict,
  match_status public.match_status not null default 'unknown',
  currency text,
  validity_from date,
  valid_until date,
  availability text,
  lead_time_text text,
  payment_terms text,
  incoterm text,
  delivery_method text,
  list_price numeric,
  discount numeric,
  net_price numeric,
  vat numeric,
  gross_price numeric,
  quantity numeric,
  moq numeric,
  ai_calculated boolean not null default false,
  additional_conditions jsonb not null default '[]'::jsonb,
  original_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_quote_price_tiers (
  id uuid primary key default gen_random_uuid(),
  supplier_quote_id uuid not null references public.supplier_quotes(id) on delete restrict,
  min_quantity numeric,
  max_quantity numeric,
  unit_price numeric not null,
  currency text not null,
  condition_text text,
  created_at timestamptz not null default now()
);

create table public.supplier_quote_conditions (
  id uuid primary key default gen_random_uuid(),
  supplier_quote_id uuid not null references public.supplier_quotes(id) on delete restrict,
  condition_type text not null,
  condition_text text not null,
  deadline date,
  stackable boolean,
  created_at timestamptz not null default now()
);

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency text not null,
  to_currency text not null,
  rate numeric(20,10) not null,
  valid_from date not null,
  valid_until date,
  source text,
  status text not null default 'proposed' check(status in ('proposed','approved','rejected')),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.customer_quotes (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  parent_quote_id uuid references public.customer_quotes(id) on delete restrict,
  reference text unique not null,
  revision_number integer not null default 0,
  status public.quote_status not null default 'draft',
  currency text not null,
  valid_until date,
  subject text,
  body text,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  sent_at timestamptz,
  decision_reason public.quote_decision_reason,
  decision_text text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_quote_items (
  id uuid primary key default gen_random_uuid(),
  customer_quote_id uuid not null references public.customer_quotes(id) on delete restrict,
  supplier_quote_id uuid references public.supplier_quotes(id) on delete restrict,
  product_id uuid references public.supplier_products(id) on delete restrict,
  quantity numeric not null,
  unit_price numeric not null,
  total numeric generated always as (quantity * unit_price) stored,
  exchange_rate_id uuid references public.exchange_rates(id) on delete restrict,
  supplier_cost numeric,
  supplier_currency text,
  created_at timestamptz not null default now()
);

create table public.quote_revision_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.customer_quotes(id) on delete restrict,
  reason public.revision_reason not null,
  free_text text,
  status text not null default 'pending_approval' check(status in ('pending_approval','approved','rejected','cancelled')),
  requested_by uuid references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  category public.notification_category not null,
  priority public.notification_priority not null default 'normal',
  title text not null,
  message text not null,
  record_type text,
  record_id uuid,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  assigned_to uuid references auth.users(id) on delete restrict,
  inquiry_id uuid references public.inquiries(id) on delete restrict,
  title text not null,
  description text,
  status text not null default 'open' check(status in ('open','in_progress','completed','cancelled')),
  priority public.notification_priority not null default 'normal',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.ai_alerts (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid references public.inquiries(id) on delete restrict,
  record_type text,
  record_id uuid,
  agent_id text not null,
  alert_type text not null,
  message text not null,
  priority public.notification_priority not null default 'normal',
  status public.ai_alert_status not null default 'open',
  created_at timestamptz not null default now()
);

create table public.ai_executions (
  id uuid primary key default gen_random_uuid(),
  task_key text unique not null,
  agent_id text not null,
  inquiry_id uuid references public.inquiries(id) on delete restrict,
  status public.ai_execution_status not null default 'queued',
  attempt_count integer not null default 0,
  input_ref jsonb not null default '{}'::jsonb,
  output_ref jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  event_type text not null,
  visibility public.timeline_visibility not null default 'admin',
  actor_type public.actor_type not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  agent_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type public.actor_type not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  action text not null,
  record_type text,
  record_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  is_secret boolean not null default false,
  updated_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index inquiries_customer_idx on public.inquiries(customer_id);
create index inquiries_status_idx on public.inquiries(status);
create index requirements_inquiry_idx on public.requirements(inquiry_id);
create index files_inquiry_idx on public.inquiry_files(inquiry_id);
create index research_inquiry_idx on public.research_cases(inquiry_id);
create index candidates_inquiry_idx on public.supplier_candidates(inquiry_id);
create index supplier_products_supplier_idx on public.supplier_products(supplier_id);
create index supplier_contacts_supplier_idx on public.supplier_contacts(supplier_id);
create index rfqs_inquiry_idx on public.rfqs(inquiry_id);
create index rfqs_supplier_idx on public.rfqs(supplier_id);
create index communications_thread_idx on public.communications(thread_id);
create index responses_inquiry_idx on public.supplier_responses(inquiry_id);
create index supplier_quotes_response_idx on public.supplier_quotes(supplier_response_id);
create index customer_quotes_inquiry_idx on public.customer_quotes(inquiry_id);
create index notifications_user_read_idx on public.notifications(user_id,read_at);
create index ai_alerts_status_idx on public.ai_alerts(status);
create index timeline_inquiry_idx on public.timeline_events(inquiry_id,created_at);
create index audit_record_idx on public.audit_logs(record_type,record_id);

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.inquiries enable row level security;
alter table public.inquiry_files enable row level security;
alter table public.requirements enable row level security;
alter table public.clarifications enable row level security;
alter table public.supplier_candidates enable row level security;
alter table public.notifications enable row level security;
alter table public.tasks enable row level security;
alter table public.timeline_events enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role='admin' and p.status='active') $$;

create or replace function public.current_customer_id()
returns uuid language sql stable security definer set search_path=public
as $$ select id from public.customers where user_id=auth.uid() and status='active' limit 1 $$;

create policy profiles_self_or_admin on public.profiles
for select using (user_id=auth.uid() or public.is_admin());

create policy customers_admin_or_self on public.customers
for select using (public.is_admin() or user_id=auth.uid());
create policy customers_admin_write on public.customers
for all using (public.is_admin()) with check (public.is_admin());

create policy inquiries_admin_or_owner on public.inquiries
for select using (public.is_admin() or customer_id=public.current_customer_id());
create policy inquiries_owner_insert on public.inquiries
for insert with check (customer_id=public.current_customer_id() or public.is_admin());
create policy inquiries_admin_update on public.inquiries
for update using (public.is_admin()) with check (public.is_admin());

create policy files_admin_or_owner on public.inquiry_files
for select using (public.is_admin() or inquiry_id in (select id from public.inquiries where customer_id=public.current_customer_id()));
create policy files_owner_insert on public.inquiry_files
for insert with check (inquiry_id in (select id from public.inquiries where customer_id=public.current_customer_id()) or public.is_admin());

create policy requirements_admin_or_owner on public.requirements
for select using (public.is_admin() or inquiry_id in (select id from public.inquiries where customer_id=public.current_customer_id()));
create policy requirements_owner_insert on public.requirements
for insert with check (public.is_admin() or inquiry_id in (select id from public.inquiries where customer_id=public.current_customer_id()));
create policy requirements_admin_update on public.requirements
for update using (public.is_admin()) with check (public.is_admin());

create policy clarification_admin_or_owner on public.clarifications
for select using (public.is_admin() or inquiry_id in (select id from public.inquiries where customer_id=public.current_customer_id()));
create policy clarification_admin_insert on public.clarifications
for insert with check (public.is_admin());

create policy candidate_admin_only on public.supplier_candidates
for all using (public.is_admin()) with check (public.is_admin());

create policy notifications_self on public.notifications
for select using (user_id=auth.uid());
create policy notifications_self_update on public.notifications
for update using (user_id=auth.uid()) with check (user_id=auth.uid());

create policy tasks_admin on public.tasks
for all using (public.is_admin()) with check (public.is_admin());

create policy timeline_customer_visible on public.timeline_events
for select using (
  public.is_admin()
  or (
    visibility='customer'
    and inquiry_id in (select id from public.inquiries where customer_id=public.current_customer_id())
  )
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;

create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger touch_customers before update on public.customers for each row execute function public.touch_updated_at();
create trigger touch_inquiries before update on public.inquiries for each row execute function public.touch_updated_at();
create trigger touch_requirements before update on public.requirements for each row execute function public.touch_updated_at();
create trigger touch_suppliers before update on public.suppliers for each row execute function public.touch_updated_at();
create trigger touch_supplier_products before update on public.supplier_products for each row execute function public.touch_updated_at();
create trigger touch_supplier_contacts before update on public.supplier_contacts for each row execute function public.touch_updated_at();
create trigger touch_supplier_emails before update on public.supplier_emails for each row execute function public.touch_updated_at();
create trigger touch_supplier_phones before update on public.supplier_phones for each row execute function public.touch_updated_at();
create trigger touch_supplier_candidates before update on public.supplier_candidates for each row execute function public.touch_updated_at();
create trigger touch_supplier_responses before update on public.supplier_responses for each row execute function public.touch_updated_at();
create trigger touch_supplier_quotes before update on public.supplier_quotes for each row execute function public.touch_updated_at();
create trigger touch_customer_quotes before update on public.customer_quotes for each row execute function public.touch_updated_at();


-- NOTE: supplier primary_* foreign keys are intentionally added after dependent tables exist.
-- AI service roles must use controlled server-side repositories; no general-agent SQL access.

-- Additional integrity constraints
create unique index if not exists supplier_primary_contact_unique on public.supplier_contacts(supplier_id) where is_primary=true;
create unique index if not exists supplier_primary_website_unique on public.supplier_websites(supplier_id) where is_primary=true;
create unique index if not exists supplier_primary_email_unique on public.supplier_emails(supplier_id) where is_primary=true;
create unique index if not exists supplier_primary_phone_unique on public.supplier_phones(supplier_id) where is_primary=true;
create unique index if not exists supplier_primary_address_unique on public.supplier_addresses(supplier_id) where is_primary=true;

-- Inquiry references are immutable identifiers; history records preserve changes instead of hard deletion.
create unique index if not exists supplier_product_pn_identity_idx
  on public.supplier_products(supplier_id, lower(regexp_replace(coalesce(model_part_number,''),'[-_[:space:]]','','g')))
  where model_part_number is not null and model_part_number <> '';

-- Quote revisions are ordered within an original quote family.
create unique index if not exists customer_quote_revision_idx
  on public.customer_quotes(inquiry_id, reference, revision_number);


-- Private customer inquiry file storage.
insert into storage.buckets (id, name, public)
values ('inquiry-files', 'inquiry-files', false)
on conflict (id) do update set public=false;
