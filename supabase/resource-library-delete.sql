-- Apply AFTER cloud-sync.sql, file-inventory.sql and resource-library.sql.
-- Never delete from storage.objects using SQL. Binary removal uses Storage API.
begin;
create table if not exists public.atlas_resource_delete_reservations (
  owner_id uuid not null references public.atlas_course_access(owner_id) on delete cascade,
  sha text not null check (sha ~ '^[0-9a-f]{64}$'),
  token uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, sha)
);
alter table public.atlas_resource_delete_reservations enable row level security;
revoke all on public.atlas_resource_delete_reservations from public, anon, authenticated;

create or replace function public.atlas_resource_owner_lock(o uuid)
returns void language sql volatile security definer set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('atlas-resource-owner:' || o::text, 0));
$$;

create or replace function public.atlas_resource_referenced(o uuid, s text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.atlas_working_documents d
    where d.owner_id=o and d.document is not null
      and (d.resource_refs @> array[s]::text[] or position(s in d.document::text)>0)
  );
$$;

create or replace function public.atlas_legacy_resource_uses(expected_owner uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode='42501', message='Resource library owner required';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', d.id, 'title', d.title, 'kind', d.kind, 'deleted', d.deleted_at,
    'urls', coalesce((select jsonb_agg(distinct v #>> '{}')
      from jsonb_path_query(d.document, '$.** ? (@.type() == "string" && @ like_regex "^https://.*?/storage/v1/")') v), '[]'::jsonb)
  )) from public.atlas_working_documents d
    where d.owner_id=expected_owner and d.document is not null), '[]'::jsonb);
end;
$$;

create or replace function public.atlas_resource_delete_begin(expected_owner uuid, resource_sha text, delete_token uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode='42501', message='Resource library owner required';
  end if;
  if resource_sha is null or resource_sha !~ '^[0-9a-f]{64}$' or delete_token is null then
    raise exception using errcode='22023', message='Invalid resource';
  end if;
  perform public.atlas_resource_owner_lock(expected_owner);
  if not exists (select 1 from public.atlas_publication_locks l
    where l.id='00000000-0000-4000-8000-000000000000'::uuid and l.token=delete_token and l.expires_at>clock_timestamp()) then
    raise exception using errcode='42501', message='Storage lease required';
  end if;
  if public.atlas_resource_referenced(expected_owner, resource_sha) then
    raise exception using errcode='23503', message='Изображение используется рабочим документом или резервом корзины.';
  end if;
  if exists (select 1 from public.atlas_resource_delete_reservations r where r.owner_id=expected_owner and r.sha=resource_sha) then
    raise exception using errcode='55000', message='Предыдущее удаление не подтверждено. Требуется проверка оператором.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='atlas-private-resources' and o.name=expected_owner::text||'/'||resource_sha) then
    raise exception using errcode='22023', message='Ресурс уже отсутствует.';
  end if;
  insert into public.atlas_resource_delete_reservations(owner_id,sha,token) values(expected_owner,resource_sha,delete_token);
  return true;
end;
$$;

create or replace function public.atlas_resource_delete_finish(expected_owner uuid, resource_sha text, delete_token uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode='42501', message='Resource library owner required';
  end if;
  perform public.atlas_resource_owner_lock(expected_owner);
  if exists (select 1 from storage.objects o where o.bucket_id='atlas-private-resources' and o.name=expected_owner::text||'/'||resource_sha) then
    raise exception using errcode='55000', message='Объект ещё существует. Резервирование сохранено.';
  end if;
  delete from public.atlas_resource_delete_reservations r
    where r.owner_id=expected_owner and r.sha=resource_sha and r.token=delete_token;
  return found;
end;
$$;

-- Protect the commit even if an old browser does not know about reservations.
create or replace function public.atlas_guard_working_resources()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.atlas_resource_owner_lock(new.owner_id);
  if new.document is null then return new; end if;
  if exists (select 1 from public.atlas_resource_delete_reservations r
    where r.owner_id=new.owner_id and (new.resource_refs @> array[r.sha]::text[] or position(r.sha in new.document::text)>0)) then
    raise exception using errcode='55000', message='Ресурс зарезервирован для удаления. Повторите после завершения операции.';
  end if;
  if exists (select 1 from unnest(new.resource_refs) s where not exists (
    select 1 from storage.objects o where o.bucket_id='atlas-private-resources' and o.name=new.owner_id::text||'/'||s)) then
    raise exception using errcode='23503', message='Missing private resource';
  end if;
  -- New working copies must use verified resource pointers, not signed URLs.
  if new.deleted_at is null and exists (select 1 from jsonb_path_query(new.document, '$.** ? (@.type() == "string" && @ like_regex "^https://.*?/storage/v1/.*?/atlas-private-resources/")')) then
    raise exception using errcode='22023', message='Встройте приватные изображения в документ перед сохранением.';
  end if;
  return new;
end;
$$;
drop trigger if exists atlas_guard_working_resources on public.atlas_working_documents;
create trigger atlas_guard_working_resources before insert or update of document, resource_refs, owner_id
on public.atlas_working_documents for each row execute function public.atlas_guard_working_resources();

create or replace function public.atlas_resource_insert_allowed(path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare o uuid := auth.uid(); s text := split_part(path,'/',2);
begin
  if not public.atlas_working_allowed(o) or path<>o::text||'/'||s or s !~ '^[0-9a-f]{64}$' then return false; end if;
  perform public.atlas_resource_owner_lock(o);
  return not exists(select 1 from public.atlas_resource_delete_reservations r where r.owner_id=o and r.sha=s);
end;
$$;

create or replace function public.atlas_resource_delete_allowed(path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare o uuid := auth.uid(); s text := split_part(path,'/',2); header text;
begin
  if not public.atlas_working_allowed(o) or path<>o::text||'/'||s or s !~ '^[0-9a-f]{64}$' then return false; end if;
  perform public.atlas_resource_owner_lock(o);
  header := nullif(current_setting('request.headers',true),'')::jsonb->>'x-client-info';
  -- A lease token is single-operation scoped. Never allow a stale DELETE to hit a reuploaded object.
  perform 1 from public.atlas_resource_delete_reservations r
    join public.atlas_publication_locks l on l.token=r.token
    where r.owner_id=o and r.sha=s
      and l.id='00000000-0000-4000-8000-000000000000'::uuid
      and l.expires_at>clock_timestamp() and header='atlas-storage/'||r.token::text
    for share of l;
  if not found then return false; end if;
  return not public.atlas_resource_referenced(o,s);
end;
$$;

revoke all on function public.atlas_resource_owner_lock(uuid), public.atlas_resource_referenced(uuid,text),
  public.atlas_guard_working_resources(), public.atlas_resource_delete_begin(uuid,text,uuid),
  public.atlas_resource_delete_finish(uuid,text,uuid), public.atlas_resource_insert_allowed(text),
  public.atlas_resource_delete_allowed(text), public.atlas_legacy_resource_uses(uuid) from public, anon, authenticated;
grant execute on function public.atlas_resource_delete_begin(uuid,text,uuid), public.atlas_resource_delete_finish(uuid,text,uuid),
  public.atlas_legacy_resource_uses(uuid) to authenticated;
grant execute on function public.atlas_resource_insert_allowed(text), public.atlas_resource_delete_allowed(text) to anon, authenticated;

-- Keep the original restrictive read/insert/update guards. Replace only private DELETE guard.
drop policy if exists atlas_resource_insert_reservation_guard on storage.objects;
create policy atlas_resource_insert_reservation_guard on storage.objects as restrictive for insert to public
with check (bucket_id<>'atlas-private-resources' or public.atlas_resource_insert_allowed(name));
drop policy if exists atlas_private_delete_guard on storage.objects;
create policy atlas_private_delete_guard on storage.objects as restrictive for delete to public
using (bucket_id<>'atlas-private-resources' or public.atlas_resource_delete_allowed(name));
drop policy if exists atlas_resource_reserved_delete on storage.objects;
create policy atlas_resource_reserved_delete on storage.objects for delete to authenticated
using (bucket_id='atlas-private-resources' and public.atlas_resource_delete_allowed(name));
notify pgrst, 'reload schema';
commit;
