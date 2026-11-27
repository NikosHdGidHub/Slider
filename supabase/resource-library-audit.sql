-- Apply AFTER resource-library-delete.sql. This migration does not delete any bytes.
begin;
create or replace function public.atlas_resource_audit(expected_owner uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.atlas_working_allowed(expected_owner) then
    raise exception using errcode='42501', message='Resource library owner required';
  end if;
  return coalesce((select jsonb_agg(x.line) from (
    select jsonb_build_object('kind',d.kind,'id',d.id,'title',d.title,'status','error',
      'detail','Отсутствует объект Storage: '||coalesce(s.sha,'NULL')) as line
    from public.atlas_working_documents d cross join lateral unnest(d.resource_refs) s(sha)
    where d.owner_id=expected_owner and d.document is not null
      and (s.sha is null or not exists (select 1 from storage.objects o where o.bucket_id='atlas-private-resources' and o.name=expected_owner::text||'/'||s.sha))
    union all
    select jsonb_build_object('kind',d.kind,'id',d.id,'title',d.title,'status','skipped',
      'detail',case when d.deleted_at is not null then 'Старые ссылки в корзине; тело сохранено для восстановления.' else 'Старые внешние ссылки или встроенные изображения; нужна миграция.' end)
    from public.atlas_working_documents d
    where d.owner_id=expected_owner and d.document is not null and exists (
      select 1 from (
        select jsonb_path_query(case when d.kind='template' then d.document->'deck' else d.document end,'$.slides[*].background') as v
        union all select jsonb_path_query(case when d.kind='template' then d.document->'deck' else d.document end,'$.slides[*].items[*] ? (@.type == "image").src')
        union all select jsonb_path_query(case when d.kind='template' then d.document->'deck' else d.document end,'$.master.art.*.background')
        union all select jsonb_path_query(case when d.kind='template' then d.document->'deck' else d.document end,'$.master.art.*.items[*] ? (@.type == "image").src')
      ) urls where v #>> '{}' ~ '^(https?://|data:image/)'
    )
    union all
    select jsonb_build_object('kind','reservation','id',r.sha,'title',r.sha,'status','error',
      'detail','Незавершённое удаление. Требуется ручная проверка операции; резервирование не снимается.')
    from public.atlas_resource_delete_reservations r where r.owner_id=expected_owner
  ) x),'[]'::jsonb);
end;
$$;
revoke all on function public.atlas_resource_audit(uuid) from public,anon,authenticated;
grant execute on function public.atlas_resource_audit(uuid) to authenticated;
-- Historical images may be referenced by an offline device or exported JSON.
-- Refuse ordinary API deletes even if the current catalogue has no references.
drop policy if exists atlas_legacy_image_delete_guard on storage.objects;
create policy atlas_legacy_image_delete_guard on storage.objects as restrictive for delete to public
using (bucket_id <> 'images');
notify pgrst, 'reload schema';
commit;
