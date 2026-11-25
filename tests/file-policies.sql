-- Run against a disposable copy of the Atlas schema, after files.sql.
begin;
set local role authenticated;
set local request.jwt.claim.sub='43649fda-26cb-4b20-bbc1-0a398e9d8ce3';
do $$declare d uuid=gen_random_uuid();begin
 if not public.atlas_lock_publication(d,gen_random_uuid()) or public.atlas_lock_publication(d,gen_random_uuid()) then
 raise exception 'Two devices acquired one publication';end if;
end$$;
insert into public.atlas_folders(name) values ('test') on conflict do nothing;
insert into public.atlas_files(sha,owner_id,name,folder,mime,size,bucket,path)
values(repeat('a',64),auth.uid(),'test.pdf','test','application/pdf',8,'atlas-private',repeat('a',64))
on conflict(sha) do nothing;
update public.atlas_files set hidden=true where sha=repeat('a',64);
insert into storage.objects(bucket_id,name) values('atlas-private','test');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000008';
do $$begin
 if exists(select from public.atlas_files) or exists(select from public.atlas_folders)
 or exists(select from storage.objects where bucket_id='atlas-private') then raise exception 'Other account can list files';end if;
 begin
  insert into storage.objects(bucket_id,name) values('atlas-private','other');
  raise exception 'Other account can upload';
 exception when insufficient_privilege then null;end;
end$$;
set local role anon;
do $$begin
 begin perform * from public.atlas_files;raise exception 'Guest can list files';
 exception when insufficient_privilege then null;end;
 if exists(select from storage.objects where bucket_id='atlas-private') then raise exception 'Guest can read private files'; end if;
end$$;
rollback;
