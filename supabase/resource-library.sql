-- Apply after cloud-sync.sql.
begin;

create index if not exists
  atlas_working_resource_refs_idx
on public.atlas_working_documents
using gin (resource_refs);


create or replace function
  public.atlas_resource_library(
    expected_owner uuid
  )
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin

  if not public.atlas_working_allowed(
    expected_owner
  ) then
    raise exception using
      errcode = '42501',
      message = 'Resource library owner required';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'sha', r.sha,
          'bucket', r.bucket,
          'path', r.path,
          'mime', r.mime,
          'size', r.size,
          'created_at', r.created_at,

          'documents', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', d.id,
                  'title', d.title,
                  'kind', d.kind,
                  'deleted', d.deleted_at
                )
                order by d.title, d.id
              )
              from public.atlas_working_documents d
              where d.owner_id = expected_owner
                and d.deleted_at is null
                and d.resource_refs
                    @> array[r.sha]::text[]
            ),
            '[]'::jsonb
          ),

          'trash', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', d.id,
                  'title', d.title,
                  'kind', d.kind,
                  'deleted', d.deleted_at
                )
                order by d.deleted_at desc
              )
              from public.atlas_working_documents d
              where d.owner_id = expected_owner
                and d.deleted_at is not null
                and d.document is not null
                and d.deleted_at >
                    now() - interval '30 days'
                and d.resource_refs
                    @> array[r.sha]::text[]
            ),
            '[]'::jsonb
          )

        )
        order by r.created_at desc, r.sha
      )
      from (
        select
          split_part(o.name, '/', 2) as sha,
          o.bucket_id as bucket,
          o.name as path,

          coalesce(
            o.metadata->>'mimetype',
            'application/octet-stream'
          ) as mime,

          case
            when o.metadata->>'size'
                 ~ '^[0-9]{1,15}$'
            then
              (o.metadata->>'size')::bigint
            else null
          end as size,

          o.created_at

        from storage.objects o

        where
          o.bucket_id = 'atlas-private-resources'

          and split_part(o.name, '/', 1)
              = expected_owner::text

          and o.name ~
              '^[0-9a-f-]{36}/[0-9a-f]{64}$'
      ) r
    ),
    '[]'::jsonb
  );

end;
$$;


revoke all on function
  public.atlas_resource_library(uuid)
from public, anon, authenticated;

grant execute on function
  public.atlas_resource_library(uuid)
to authenticated;


notify pgrst, 'reload schema';

commit;