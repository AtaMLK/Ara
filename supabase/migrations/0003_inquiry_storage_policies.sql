-- Customer-owned private inquiry file access.
create policy inquiry_files_customer_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'inquiry-files'
  and split_part(name, '/', 1)::uuid in (
    select id from public.inquiries where customer_id = public.current_customer_id()
  )
);

create policy inquiry_files_customer_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'inquiry-files'
  and split_part(name, '/', 1)::uuid in (
    select id from public.inquiries where customer_id = public.current_customer_id()
  )
);

create policy inquiry_files_customer_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'inquiry-files'
  and split_part(name, '/', 1)::uuid in (
    select id from public.inquiries where customer_id = public.current_customer_id()
  )
);

create policy inquiry_files_admin_all
on storage.objects
for all
to authenticated
using (
  bucket_id = 'inquiry-files'
  and public.is_admin()
)
with check (
  bucket_id = 'inquiry-files'
  and public.is_admin()
);
