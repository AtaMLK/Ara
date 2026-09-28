-- Private customer inquiry file storage.
insert into storage.buckets (id, name, public)
values ('inquiry-files', 'inquiry-files', false)
on conflict (id) do update set public=false;
