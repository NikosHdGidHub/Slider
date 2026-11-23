-- Используйте выделенный проект. Замените нулевой UUID на User UID владельца.
begin;
do $setup$
declare
  admin_id constant uuid := '43649fda-26cb-4b20-bbc1-0a398e9d8ce3';
  scope text := 'bucket_id in (''images'', ''presentations'')';
  allowed text := format('(select auth.uid()) = %L::uuid', admin_id);
  action text;
begin
  if not exists (select 1 from auth.users where id = admin_id) then
    raise exception 'Укажите существующий User UID администратора';
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('images','images',true,20971520,array['image/webp','image/png','image/jpeg']),
         ('presentations','presentations',true,52428800,array['application/json'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- Ограничительные политики сохраняют запрет для чужих UID даже при наличии
  -- дополнительных permissive-политик. Публичный URL объекта обслуживает Storage.
  foreach action in array array['select','insert','update','delete'] loop
    execute format('drop policy if exists %I on storage.objects', 'atlas owner ' || action);
    execute format('drop policy if exists %I on storage.objects', 'atlas guard ' || action);
    if action = 'insert' then
      execute format('create policy %I on storage.objects for insert to authenticated with check (%s and %s)',
        'atlas owner ' || action, scope, allowed);
      execute format('create policy %I on storage.objects as restrictive for insert to public with check (not (%s) or %s)',
        'atlas guard ' || action, scope, allowed);
    elsif action = 'update' then
      execute format('create policy %I on storage.objects for update to authenticated using (%s and %s) with check (%s and %s)',
        'atlas owner ' || action, scope, allowed, scope, allowed);
      execute format('create policy %I on storage.objects as restrictive for update to public using (not (%s) or %s) with check (not (%s) or %s)',
        'atlas guard ' || action, scope, allowed, scope, allowed);
    else
      execute format('create policy %I on storage.objects for %s to authenticated using (%s and %s)',
        'atlas owner ' || action, action, scope, allowed);
      execute format('create policy %I on storage.objects as restrictive for %s to public using (not (%s) or %s)',
        'atlas guard ' || action, action, scope, allowed);
    end if;
  end loop;
end; $setup$;
commit;
