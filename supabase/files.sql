-- Используйте выделенный проект. Укажите User UID владельца во всех политиках и переменной admin_id.
begin;
do $setup$
declare
  admin_id constant uuid := '43649fda-26cb-4b20-bbc1-0a398e9d8ce3';
  scope text := 'bucket_id in (''atlas-private'')';
  allowed text := format('(select auth.uid()) = %L::uuid', admin_id);
  action text;
begin
  if not exists (select 1 from auth.users where id = admin_id) then
    raise exception 'Укажите существующий User UID администратора';
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('atlas-private','atlas-private',false,52428800,array['application/pdf','application/json','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- Ограничительные политики сохраняют запрет для чужих UID даже при наличии
  -- дополнительных permissive-политик.
  foreach action in array array['select','insert','update','delete'] loop
    execute format('drop policy if exists %I on storage.objects', 'atlas files owner ' || action);
    execute format('drop policy if exists %I on storage.objects', 'atlas files guard ' || action);
    if action = 'insert' then
      execute format('create policy %I on storage.objects for insert to authenticated with check (%s and %s)',
        'atlas files owner ' || action, scope, allowed);
      execute format('create policy %I on storage.objects as restrictive for insert to public with check (not (%s) or %s)',
        'atlas files guard ' || action, scope, allowed);
    elsif action = 'update' then
      execute format('create policy %I on storage.objects for update to authenticated using (%s and %s) with check (%s and %s)',
        'atlas files owner ' || action, scope, allowed, scope, allowed);
      execute format('create policy %I on storage.objects as restrictive for update to public using (not (%s) or %s) with check (not (%s) or %s)',
        'atlas files guard ' || action, scope, allowed, scope, allowed);
    else
      execute format('create policy %I on storage.objects for %s to authenticated using (%s and %s)',
        'atlas files owner ' || action, action, scope, allowed);
      execute format('create policy %I on storage.objects as restrictive for %s to public using (not (%s) or %s)',
        'atlas files guard ' || action, action, scope, allowed);
    end if;
  end loop;
end; $setup$;
create table if not exists public.atlas_files (
 sha text primary key check(sha ~ '^[0-9a-f]{64}$'), owner_id uuid not null references auth.users,
 name text not null, folder text not null default '', mime text not null, size bigint not null,
 bucket text not null check(bucket in ('images','atlas-private')), path text not null,
 created_at timestamptz not null default now(), hidden boolean not null default false
);
alter table public.atlas_files enable row level security;
revoke all on public.atlas_files from public, anon, authenticated;
grant select, insert on public.atlas_files to authenticated;
grant update(name,folder,hidden) on public.atlas_files to authenticated;
drop policy if exists atlas_file_owner on public.atlas_files;
create policy atlas_file_owner on public.atlas_files to authenticated
 using(owner_id=auth.uid() and owner_id='43649fda-26cb-4b20-bbc1-0a398e9d8ce3')
 with check(owner_id=auth.uid() and owner_id='43649fda-26cb-4b20-bbc1-0a398e9d8ce3');
create table if not exists public.atlas_folders (
 name text primary key check(length(trim(name)) between 1 and 250),
 owner_id uuid not null default auth.uid() references auth.users
);
alter table public.atlas_folders enable row level security;
revoke all on public.atlas_folders from public, anon, authenticated;
grant select, insert on public.atlas_folders to authenticated;
drop policy if exists atlas_folder_owner on public.atlas_folders;
create policy atlas_folder_owner on public.atlas_folders to authenticated
 using(owner_id=auth.uid() and owner_id='43649fda-26cb-4b20-bbc1-0a398e9d8ce3')
 with check(owner_id=auth.uid() and owner_id='43649fda-26cb-4b20-bbc1-0a398e9d8ce3');
-- Serialize the final check and Storage write across teacher devices.
create table if not exists public.atlas_publication_locks (
 id uuid primary key, token uuid not null, expires_at timestamptz not null
);
alter table public.atlas_publication_locks enable row level security;
revoke all on public.atlas_publication_locks from public, anon, authenticated;
grant select,insert,update,delete on public.atlas_publication_locks to authenticated;
drop policy if exists atlas_publication_owner on public.atlas_publication_locks;
create policy atlas_publication_owner on public.atlas_publication_locks to authenticated
 using(auth.uid()='43649fda-26cb-4b20-bbc1-0a398e9d8ce3')
 with check(auth.uid()='43649fda-26cb-4b20-bbc1-0a398e9d8ce3');
create or replace function public.atlas_lock_publication(document_id uuid, lock_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 insert into public.atlas_publication_locks(id,token,expires_at)
 values(document_id,lock_token,clock_timestamp()+interval '10 minutes')
 on conflict(id) do update set token=excluded.token,expires_at=excluded.expires_at
 where public.atlas_publication_locks.expires_at < clock_timestamp();
 return found;
end; $$;
revoke all on function public.atlas_lock_publication(uuid,uuid) from public,anon;
grant execute on function public.atlas_lock_publication(uuid,uuid) to authenticated;
commit;
