-- Use a disposable project with setup.sql, files.sql and file-inventory.sql applied.
begin;
insert into storage.objects(bucket_id,name,metadata) values
  ('images','legacy/example.png','{"mimetype":"image/png","size":123}'),
  ('atlas-private','hidden-file','{"mimetype":"application/pdf","size":32}');
insert into public.atlas_files (bucket,path,sha,owner_id,name,mime,size,hidden)
values ('atlas-private','hidden-file',repeat('a',64),'43649fda-26cb-4b20-bbc1-0a398e9d8ce3','Ранее скрытый.pdf','application/pdf',32,true);

set local role authenticated;
set local request.jwt.claim.sub='43649fda-26cb-4b20-bbc1-0a398e9d8ce3';
do $$
declare lease_id uuid='00000000-0000-4000-8000-000000000000';
        lease_token uuid=gen_random_uuid();
begin
  if (select count(*) from public.atlas_file_inventory where path in ('legacy/example.png','hidden-file')) <> 2
    then raise exception 'Legacy or hidden object missing'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('presentations','unleased.json');
    raise exception 'Unleased publish passed';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where name='legacy/example.png';
  if found then raise exception 'Unleased deletion passed'; end if;

  if not public.atlas_lock_publication(lease_id,lease_token)
    or public.atlas_lock_publication(lease_id,gen_random_uuid())
    then raise exception 'Exclusive lease failed'; end if;
  perform set_config('request.headers',jsonb_build_object('x-client-info','atlas-storage/'||lease_token)::text,true);
  insert into storage.objects(bucket_id,name) values('presentations','leased.json');
  delete from storage.objects where name='legacy/example.png';
  if not found then raise exception 'Authorized deletion failed'; end if;
  delete from storage.objects where name='hidden-file';
  delete from public.atlas_files where path='hidden-file';
  if exists(select from public.atlas_file_inventory where path='hidden-file')
    then raise exception 'Deleted file is still visible'; end if;

  update public.atlas_publication_locks set expires_at=now()-interval '1 second' where id=lease_id;
  delete from storage.objects where name='leased.json';
  if found then raise exception 'Expired lease still authorizes deletion'; end if;
end;
$$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000008';
do $$begin
  if exists(select from public.atlas_file_inventory) then raise exception 'Other account can list files'; end if;
end;$$;
set local role anon;
do $$begin
  begin
    perform * from public.atlas_file_inventory;
    raise exception 'Guest can list files';
  exception when insufficient_privilege then null;
  end;
end;$$;
rollback;
