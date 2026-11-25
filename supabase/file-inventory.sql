-- Apply after files.sql. The existing Atlas owner policies remain in force.
begin;

-- One card per physical object, including pre-existing duplicate content.
alter table public.atlas_files drop constraint atlas_files_pkey;
alter table public.atlas_files add primary key (bucket, path);
create index if not exists atlas_files_sha_idx on public.atlas_files(sha);
grant delete on public.atlas_files to authenticated;
revoke update(hidden) on public.atlas_files from authenticated;
update public.atlas_files set hidden = false where hidden;

create or replace view public.atlas_file_inventory
with (security_invoker = true) as
select o.bucket_id as bucket, o.name as path, f.sha,
       coalesce(f.name, regexp_replace(o.name, '^.*/', '')) as name,
       coalesce(f.folder, '') as folder,
       coalesce(f.mime, o.metadata->>'mimetype', 'application/octet-stream') as mime,
       coalesce(f.size, (o.metadata->>'size')::bigint, 0) as size,
       coalesce(f.created_at, o.created_at) as created_at
from storage.objects o
left join public.atlas_files f on f.bucket = o.bucket_id and f.path = o.name
where o.bucket_id in ('images', 'atlas-private');
revoke all on public.atlas_file_inventory from public, anon, authenticated;
grant select on public.atlas_file_inventory to authenticated;

-- The Storage service passes request headers into its policy transaction.
-- Hold the lease row until that transaction commits, so takeover cannot race it.
create or replace function public.atlas_holds_storage_lease()
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform 1 from public.atlas_publication_locks
  where id = '00000000-0000-4000-8000-000000000000'
    and expires_at > clock_timestamp()
    and (nullif(current_setting('request.headers', true), '')::jsonb->>'x-client-info')
          = 'atlas-storage/' || token::text
  for share;
  return found;
end;
$$;
revoke all on function public.atlas_holds_storage_lease() from public, anon;
grant execute on function public.atlas_holds_storage_lease() to authenticated;

do $setup$
declare
  guard constant text := '(bucket_id not in (''images'', ''presentations'', ''atlas-private'') or (select public.atlas_holds_storage_lease()))';
begin
  drop policy if exists "atlas leased insert" on storage.objects;
  drop policy if exists "atlas leased update" on storage.objects;
  drop policy if exists "atlas leased delete" on storage.objects;
  execute format('create policy "atlas leased insert" on storage.objects as restrictive for insert to authenticated with check %s', guard);
  execute format('create policy "atlas leased update" on storage.objects as restrictive for update to authenticated using %s with check %s', guard, guard);
  execute format('create policy "atlas leased delete" on storage.objects as restrictive for delete to authenticated using %s', guard);
end;
$setup$;
commit;
