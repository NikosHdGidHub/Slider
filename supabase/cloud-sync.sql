-- Apply after setup.sql, templates.sql and courses.sql.
begin;
create table if not exists public.atlas_working_documents (
  owner_id uuid not null references public.atlas_course_access(owner_id) on delete cascade,
  kind text not null check (kind in ('lesson','template')),
  id uuid not null,
  title text not null check (char_length(title) between 1 and 1024 and title ~ '[^[:space:]]'),
  slide_count integer not null check (slide_count between 1 and 1000),
  template_kind text,
  template_format integer,
  document jsonb check (document is null or (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 67108864)),
  resource_refs text[] not null default '{}',
  revision bigint not null check (revision > 0),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner_id, kind, id),
  check ((kind = 'lesson' and template_kind is null) or (kind = 'template' and coalesce(template_kind in ('layout','presentation'), false)))
);
create index if not exists atlas_working_updated_idx on public.atlas_working_documents(owner_id, updated_at desc);
create table if not exists public.atlas_working_requests (
  owner_id uuid not null references public.atlas_course_access(owner_id) on delete cascade,
  request_id uuid not null,
  kind text not null,
  id uuid not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, request_id),
  foreign key (owner_id, kind, id) references public.atlas_working_documents(owner_id, kind, id) on delete cascade
);
create table if not exists public.atlas_working_presence (
  owner_id uuid not null references public.atlas_course_access(owner_id) on delete cascade,
  kind text not null check (kind in ('lesson','template')),
  id uuid not null,
  session_id uuid not null,
  until_at timestamptz not null,
  primary key (owner_id, kind, id, session_id)
);
alter table public.atlas_working_documents enable row level security;
alter table public.atlas_working_requests enable row level security;
alter table public.atlas_working_presence enable row level security;
revoke all on public.atlas_working_documents, public.atlas_working_requests, public.atlas_working_presence from public, anon, authenticated;

-- Preserve original templates for rollback. After the migration the working table is authoritative.
insert into public.atlas_working_documents(owner_id, kind, id, title, slide_count, template_kind, template_format, document, revision)
select t.owner_id, 'template', t.id, t.document->'deck'->>'title',
  jsonb_array_length(t.document->'deck'->'slides'), t.document->>'kind', (t.document->>'format')::integer, t.document, t.revision
from public.atlas_templates t
join public.atlas_course_access a using(owner_id)
where t.document->>'kind' in ('presentation','layout')
  and coalesce(t.document->>'format','') in ('','3','4')
  and t.document->'deck'->>'title' ~ '[^[:space:]]'
  and char_length(t.document->'deck'->>'title') <= 1024
  and case when jsonb_typeof(t.document->'deck'->'slides')='array'
    then jsonb_array_length(t.document->'deck'->'slides') between 1 and 1000 else false end
on conflict do nothing;
revoke insert, update, delete on public.atlas_templates from public, anon, authenticated;

create or replace function public.atlas_working_allowed(expected_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select expected_owner is not null and expected_owner is not distinct from auth.uid()
    and exists(select 1 from public.atlas_course_access where owner_id = expected_owner)
$$;
revoke all on function public.atlas_working_allowed(uuid) from public, anon, authenticated;
grant execute on function public.atlas_working_allowed(uuid) to anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values ('atlas-private-resources','atlas-private-resources',false,25165824)
on conflict (id) do update set public = false;
drop policy if exists atlas_private_resource_select on storage.objects;
create policy atlas_private_resource_select on storage.objects for select to authenticated using (
  bucket_id = 'atlas-private-resources' and split_part(name,'/',1) = (select auth.uid())::text
  and (select public.atlas_working_allowed(auth.uid()))
);
drop policy if exists atlas_private_resource_insert on storage.objects;
create policy atlas_private_resource_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'atlas-private-resources' and split_part(name,'/',1) = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}$'
  and (select public.atlas_working_allowed(auth.uid()))
);
drop policy if exists atlas_private_read_guard on storage.objects;
create policy atlas_private_read_guard on storage.objects as restrictive for select to public using (
  bucket_id <> 'atlas-private-resources' or (
    split_part(name,'/',1) = (select auth.uid())::text and (select public.atlas_working_allowed(auth.uid()))
  )
);
drop policy if exists atlas_private_insert_guard on storage.objects;
create policy atlas_private_insert_guard on storage.objects as restrictive for insert to public with check (
  bucket_id <> 'atlas-private-resources' or (
    split_part(name,'/',1) = (select auth.uid())::text and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}$'
    and (select public.atlas_working_allowed(auth.uid()))
  )
);
drop policy if exists atlas_private_update_guard on storage.objects;
create policy atlas_private_update_guard on storage.objects as restrictive for update to public
using (bucket_id <> 'atlas-private-resources') with check (bucket_id <> 'atlas-private-resources');
drop policy if exists atlas_private_delete_guard on storage.objects;
create policy atlas_private_delete_guard on storage.objects as restrictive for delete to public
using (bucket_id <> 'atlas-private-resources');

create or replace function public.atlas_working_meta(d public.atlas_working_documents)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',d.id,'kind',d.kind,'title',d.title,'slides',d.slide_count,
    'templateKind',d.template_kind,'templateFormat',d.template_format,'revision',d.revision,'hash',d.content_hash,'updated',d.updated_at,
    'deleted',d.deleted_at,'restorable',d.deleted_at is not null and d.document is not null
      and d.deleted_at > now() - interval '30 days')
$$;

create or replace function public.atlas_working_list(expected_owner uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode = '42501', message = 'Working library owner required';
  end if;
  return coalesce((select jsonb_agg(public.atlas_working_meta(d) order by d.updated_at desc, d.id)
    from public.atlas_working_documents d where d.owner_id = expected_owner), '[]'::jsonb);
end; $$;

create or replace function public.atlas_working_get(expected_owner uuid, doc_kind text, doc_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d public.atlas_working_documents;
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode = '42501', message = 'Working library owner required';
  end if;
  select * into d from public.atlas_working_documents where owner_id = expected_owner and kind = doc_kind and id = doc_id;
  if not found then return null; end if;
  return jsonb_build_object('meta',public.atlas_working_meta(d),'document',
    case when d.deleted_at is null or d.deleted_at > now() - interval '30 days' then d.document else null end);
end; $$;

create or replace function public.atlas_working_save(
  expected_owner uuid, doc_kind text, doc_id uuid, expected_revision bigint, mutation uuid,
  payload jsonb, payload_hash text, refs text[], remove_doc boolean
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  old public.atlas_working_documents;
  saved public.atlas_working_documents;
  receipt public.atlas_working_requests;
  deck jsonb;
  doc_title text;
  doc_slides integer;
  doc_layout text;
  doc_format integer;
  payload_refs text[];
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode = '42501', message = 'Working library owner required';
  end if;
  if doc_kind is null or doc_kind not in ('lesson','template') or doc_id is null or mutation is null
     or expected_revision is null or expected_revision < 0 or remove_doc is null
     or payload_hash is null or payload_hash !~ '^[0-9a-f]{64}$' or refs is null then
    raise exception using errcode = '22023', message = 'Invalid working revision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(expected_owner::text || doc_kind || doc_id::text, 0));
  select * into old from public.atlas_working_documents where owner_id=expected_owner and kind=doc_kind and id=doc_id;
  select * into receipt from public.atlas_working_requests where owner_id=expected_owner and request_id=mutation;
  if found then
    if receipt.id <> doc_id or receipt.kind <> doc_kind then
      raise exception using errcode = '22023', message = 'Request belongs to another document';
    end if;
    return jsonb_build_object('accepted', true, 'committed', receipt.revision, 'meta',public.atlas_working_meta(old));
  end if;
  if coalesce(old.revision,0) <> expected_revision then
    return jsonb_build_object('accepted', false, 'meta',case when old.id is not null then public.atlas_working_meta(old) else null end);
  end if;
  if remove_doc and not (coalesce(payload,'{}'::jsonb) ? any(array['deck','slides'])) then
    if old.id is null then
      -- A locally created document can be removed before its first upload.
      doc_title := coalesce(nullif(payload->>'title',''), 'Удалённый документ');
      doc_slides := 1;
      doc_layout := case when doc_kind='template' then coalesce(payload->>'templateKind','presentation') end;
    else
      doc_title := old.title;
      doc_slides := old.slide_count;
      doc_layout := old.template_kind;
      doc_format := old.template_format;
    end if;
    payload := old.document;
    refs := coalesce(old.resource_refs,'{}');
  else
    deck := case when doc_kind='template' then payload->'deck' else payload end;
    if jsonb_typeof(deck) is distinct from 'object' or (deck->>'id')::uuid is distinct from doc_id
       or jsonb_typeof(deck->'slides') is distinct from 'array'
       or not (deck ? 'version') then
      raise exception using errcode = '22023', message = 'Invalid working document';
    end if;
    doc_title := deck->>'title';
    doc_slides := jsonb_array_length(deck->'slides');
    doc_layout := case when doc_kind='template' then payload->>'kind' end;
    doc_format := case when doc_kind='template' then (payload->>'format')::integer end;
    select coalesce(array_agg(distinct substring(value #>> '{}' from 16 for 64)), '{}')
      into payload_refs from (
        select jsonb_path_query(deck, '$.slides[*].background') as value
        union all select jsonb_path_query(deck, '$.slides[*].items[*] ? (@.type == "image").src')
        union all select jsonb_path_query(deck, '$.master.art.*.background')
        union all select jsonb_path_query(deck, '$.master.art.*.items[*] ? (@.type == "image").src')
        union all select jsonb_path_query(deck, '$.resources.fonts[*].data')
      ) assets where value #>> '{}' ~ '^atlas-resource:[0-9a-f]{64}:(image|font)/[a-z0-9]+$';
    if not (payload_refs <@ refs and refs <@ payload_refs) then
      raise exception using errcode = '22023', message = 'Invalid private resource references';
    end if;
    if exists (
      select 1 from unnest(refs) r
      where r is null or r !~ '^[0-9a-f]{64}$' or not exists (
        select 1 from storage.objects o where o.bucket_id='atlas-private-resources' and o.name=expected_owner::text || '/' || r
      )
    ) then raise exception using errcode = '23503', message = 'Missing private resource'; end if;
  end if;
  insert into public.atlas_working_documents(owner_id,kind,id,title,slide_count,template_kind,template_format,document,
    resource_refs,revision,content_hash,deleted_at)
  values (expected_owner,doc_kind,doc_id,doc_title,doc_slides,doc_layout,doc_format,payload,
    refs, expected_revision+1,payload_hash,case when remove_doc then now() end)
  on conflict (owner_id,kind,id) do update set title=excluded.title,slide_count=excluded.slide_count,
    template_kind=excluded.template_kind,template_format=excluded.template_format,document=excluded.document,resource_refs=excluded.resource_refs,
    revision=excluded.revision,content_hash=excluded.content_hash,deleted_at=excluded.deleted_at,updated_at=now()
  returning * into saved;
  insert into public.atlas_working_requests(owner_id,request_id,kind,id,revision)
  values (expected_owner,mutation,doc_kind,doc_id,saved.revision);
  return jsonb_build_object('accepted', true, 'committed', saved.revision, 'meta',public.atlas_working_meta(saved));
end; $$;

create or replace function public.atlas_working_editing(expected_owner uuid, doc_kind text, doc_id uuid, session_id uuid, release boolean)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode = '42501', message = 'Working library owner required';
  end if;
  delete from public.atlas_working_presence p where p.owner_id=expected_owner and
    (p.until_at < now() or (release and p.kind=doc_kind and p.id=doc_id and p.session_id=atlas_working_editing.session_id));
  if release then return false; end if;
  insert into public.atlas_working_presence values (expected_owner,doc_kind,doc_id,session_id,now()+interval '70 seconds')
  on conflict on constraint atlas_working_presence_pkey do update set until_at=excluded.until_at;
  return exists(select 1 from public.atlas_working_presence p where p.owner_id=expected_owner and p.kind=doc_kind
    and p.id=doc_id and p.session_id<>atlas_working_editing.session_id and p.until_at>=now());
end; $$;

revoke all on function public.atlas_working_meta(public.atlas_working_documents) from public, anon, authenticated;
revoke all on function public.atlas_working_list(uuid), public.atlas_working_get(uuid,text,uuid),
  public.atlas_working_save(uuid,text,uuid,bigint,uuid,jsonb,text,text[],boolean),
  public.atlas_working_editing(uuid,text,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.atlas_working_list(uuid), public.atlas_working_get(uuid,text,uuid),
  public.atlas_working_save(uuid,text,uuid,bigint,uuid,jsonb,text,text[],boolean),
  public.atlas_working_editing(uuid,text,uuid,uuid,boolean) to authenticated;
-- The index is a projection of current Storage objects. An interrupted indexing
-- request leaves a listed, indexable publication, and a deleted object is hidden.
create table if not exists public.atlas_publication_index (
  owner_id uuid not null references public.atlas_course_access(owner_id) on delete cascade,
  id uuid not null,
  object_updated timestamptz not null,
  title text not null check (char_length(title) between 1 and 1024),
  slide_count integer not null check (slide_count between 1 and 1000),
  thumbnail text check (thumbnail is null or (thumbnail ~ '^https://' and length(thumbnail) <= 8192)),
  primary key (owner_id,id)
);
alter table public.atlas_publication_index enable row level security;
revoke all on public.atlas_publication_index from public, anon, authenticated;

create or replace function public.atlas_publication_catalog(expected_owner uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode='42501', message='Publication catalog owner required';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id',left(o.name,36), 'updated',o.updated_at, 'title',i.title,
      'slides',i.slide_count, 'thumbnail',i.thumbnail, 'indexed',i.id is not null
    ) order by o.updated_at desc, o.name)
    from storage.objects o left join public.atlas_publication_index i
      on i.owner_id=expected_owner and i.id::text=left(o.name,36) and i.object_updated=o.updated_at
    where o.bucket_id='presentations' and o.name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$'), '[]'::jsonb);
end; $$;

create or replace function public.atlas_publication_record(expected_owner uuid, doc_id uuid,
  version_updated timestamptz, doc_title text, slides integer, thumbnail_url text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare actual timestamptz;
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode='42501', message='Publication catalog owner required';
  end if;
  select o.updated_at into actual from storage.objects o
    where o.bucket_id='presentations' and o.name=doc_id::text || '.json' for share;
  if actual is null or (version_updated is not null and actual <> version_updated) then return false; end if;
  insert into public.atlas_publication_index values (expected_owner,doc_id,actual,doc_title,slides,thumbnail_url)
  on conflict (owner_id,id) do update set object_updated=excluded.object_updated, title=excluded.title,
    slide_count=excluded.slide_count, thumbnail=excluded.thumbnail;
  return true;
end; $$;

create or replace function public.atlas_working_resource_urls(expected_owner uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode='42501', message='Working library owner required';
  end if;
  return coalesce((select jsonb_agg(distinct v #>> '{}')
    from public.atlas_working_documents d
    cross join lateral jsonb_path_query(d.document, '$.** ? (@.type() == "string" && @ like_regex "^https://.*?/storage/v1/")') as v
    where d.owner_id=expected_owner and (d.deleted_at is null or d.deleted_at > now()-interval '30 days')), '[]'::jsonb);
end; $$;

revoke all on function public.atlas_publication_catalog(uuid),
  public.atlas_publication_record(uuid,uuid,timestamptz,text,integer,text),
  public.atlas_working_resource_urls(uuid) from public, anon, authenticated;
grant execute on function public.atlas_publication_catalog(uuid),
  public.atlas_publication_record(uuid,uuid,timestamptz,text,integer,text),
  public.atlas_working_resource_urls(uuid) to authenticated;

-- Maintenance is explicitly operator-only. Keep revision/tombstone after expiring
-- its body. Resource candidates are an audit, not a Storage deletion command.
create or replace function public.atlas_expire_working_history()
returns void language sql volatile security definer set search_path = '' as $$
  update public.atlas_working_documents set document=null, resource_refs='{}'
    where deleted_at <= now()-interval '30 days' and document is not null;
  delete from public.atlas_working_requests where created_at <= now()-interval '45 days';
  delete from public.atlas_working_presence where until_at < now();
$$;
revoke all on function public.atlas_expire_working_history() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
