-- Restore the Admin read path used by supplier verification and contact display.
-- RLS remains enabled; customers and anonymous users receive no read policy.
drop policy if exists suppliers_admin_select on public.suppliers;
create policy suppliers_admin_select on public.suppliers
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_websites_admin_select on public.supplier_websites;
create policy supplier_websites_admin_select on public.supplier_websites
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_emails_admin_select on public.supplier_emails;
create policy supplier_emails_admin_select on public.supplier_emails
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_phones_admin_select on public.supplier_phones;
create policy supplier_phones_admin_select on public.supplier_phones
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_addresses_admin_select on public.supplier_addresses;
create policy supplier_addresses_admin_select on public.supplier_addresses
  for select to authenticated using ((select public.is_admin()));

drop policy if exists supplier_contacts_admin_select on public.supplier_contacts;
create policy supplier_contacts_admin_select on public.supplier_contacts
  for select to authenticated using ((select public.is_admin()));
