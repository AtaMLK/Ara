-- Email reply correlation and idempotency for customer clarification replies.

create unique index if not exists communications_provider_message_unique
  on public.communications(provider_message_id)
  where provider_message_id is not null;

create index if not exists communications_customer_email_idx
  on public.communications(customer_id, direction, channel, created_at);

create index if not exists clarifications_inquiry_status_idx
  on public.clarifications(inquiry_id, status, created_at);
