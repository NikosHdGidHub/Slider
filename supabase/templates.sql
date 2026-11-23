-- Use the same owner UID as VITE_ADMIN_UUID and setup.sql.
begin;
create table if not exists public.atlas_templates (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id),
  revision integer not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 67108864)
);
alter table public.atlas_templates enable row level security;
revoke all on public.atlas_templates from anon, public;
grant select, insert, update, delete on public.atlas_templates to authenticated;
drop policy if exists atlas_templates_owner on public.atlas_templates;
create policy atlas_templates_owner on public.atlas_templates for all to authenticated
using (owner_id = (select auth.uid()) and owner_id = '43649fda-26cb-4b20-bbc1-0a398e9d8ce3'::uuid)
with check (owner_id = (select auth.uid()) and owner_id = '43649fda-26cb-4b20-bbc1-0a398e9d8ce3'::uuid
  and document->'deck'->>'id' = id::text);
commit;
