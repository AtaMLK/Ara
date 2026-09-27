-- ARAT email infrastructure for self-hosted/domain email.
-- SMTP is used for outbound delivery and IMAP polling is used for inbound mail.

create unique index if not exists communications_provider_message_id_unique
  on public.communications(provider_message_id)
  where provider_message_id is not null;

insert into storage.buckets (id, name, public)
values ('supplier-email-attachments', 'supplier-email-attachments', false)
on conflict (id) do nothing;
