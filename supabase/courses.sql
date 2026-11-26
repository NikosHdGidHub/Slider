-- Use the same lecturer UID as setup.sql and VITE_ADMIN_UUID.
begin;

create table if not exists public.atlas_course_access (
  owner_id uuid primary key references auth.users(id) on delete cascade
);
revoke all on public.atlas_course_access from public, anon, authenticated;
alter table public.atlas_course_access enable row level security;
insert into public.atlas_course_access(owner_id)
values ('43649fda-26cb-4b20-bbc1-0a398e9d8ce3')
on conflict do nothing;

create table if not exists public.atlas_courses (
  owner_id uuid not null references public.atlas_course_access(owner_id) on delete cascade,
  id uuid not null,
  title text not null check (title = btrim(title) and title ~ '[^[:space:]]' and char_length(title) between 1 and 120),
  color text not null check (color in ('#407f69','#426a9c','#795da5','#a16b33','#a05367','#52636f')),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, position) deferrable initially deferred
);
create table if not exists public.atlas_course_lessons (
  owner_id uuid not null,
  lesson_id uuid not null,
  course_id uuid not null,
  position integer not null check (position >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, lesson_id),
  foreign key (owner_id, course_id) references public.atlas_courses(owner_id, id) on delete cascade,
  unique (owner_id, course_id, position) deferrable initially deferred
);
create table if not exists public.atlas_course_revisions (
  owner_id uuid primary key references public.atlas_course_access(owner_id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0)
);
create table if not exists public.atlas_course_requests (
  owner_id uuid not null references public.atlas_course_access(owner_id) on delete cascade,
  request_id uuid not null,
  revision bigint not null check (revision > 0),
  primary key (owner_id, request_id)
);

alter table public.atlas_courses enable row level security;
alter table public.atlas_course_lessons enable row level security;
alter table public.atlas_course_revisions enable row level security;
alter table public.atlas_course_requests enable row level security;

revoke all on public.atlas_courses, public.atlas_course_lessons, public.atlas_course_revisions, public.atlas_course_requests from public, anon, authenticated;
grant select on public.atlas_courses, public.atlas_course_lessons to authenticated;
drop policy if exists atlas_course_owner on public.atlas_courses;
create policy atlas_course_owner on public.atlas_courses for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists atlas_course_lesson_owner on public.atlas_course_lessons;
create policy atlas_course_lesson_owner on public.atlas_course_lessons for select to authenticated
  using (owner_id = (select auth.uid()));

create or replace function public.atlas_get_courses(expected_owner uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  lecturer uuid := auth.uid();
begin
  if lecturer is null or lecturer is distinct from expected_owner or not exists (select 1 from public.atlas_course_access where owner_id = lecturer) then
    raise exception using errcode = '42501', message = 'Course library owner access required';
  end if;
  return (
    select jsonb_build_object(
      'revision', coalesce((select revision from public.atlas_course_revisions where owner_id = lecturer), 0),
      'courses', coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'color', c.color) order by c.position), '[]'::jsonb),
      'lessons', coalesce(jsonb_object_agg(c.id, coalesce(m.lessons, '[]'::jsonb)), '{}'::jsonb)
    )
    from public.atlas_courses c
    left join (
      select course_id, jsonb_agg(lesson_id order by position) as lessons
      from public.atlas_course_lessons where owner_id = lecturer group by course_id
    ) m on m.course_id = c.id
    where c.owner_id = lecturer
  );
end;
$$;

create or replace function public.atlas_save_courses(expected_owner uuid, expected_revision bigint, request_id uuid, courses jsonb, lessons jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  lecturer uuid := auth.uid();
  current_revision bigint;
begin
  if lecturer is null or lecturer is distinct from expected_owner or not exists (select 1 from public.atlas_course_access where owner_id = lecturer) then
    raise exception using errcode = '42501', message = 'Course library owner access required';
  end if;
  if request_id is null or expected_revision is null or expected_revision < 0
      or jsonb_typeof(courses) is distinct from 'array' or jsonb_typeof(lessons) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Invalid course snapshot';
  end if;

  insert into public.atlas_course_revisions(owner_id) values (lecturer) on conflict do nothing;
  select revision into current_revision from public.atlas_course_revisions where owner_id = lecturer for update;
  if exists (select 1 from public.atlas_course_requests r where r.owner_id = lecturer and r.request_id = atlas_save_courses.request_id) then
    return jsonb_build_object('accepted', true, 'snapshot', public.atlas_get_courses(lecturer));
  end if;
  if current_revision <> expected_revision then
    return jsonb_build_object('accepted', false, 'snapshot', public.atlas_get_courses(lecturer));
  end if;

  if exists (
    select 1 from jsonb_object_keys(lessons) as link(id)
    where not exists (select 1 from jsonb_array_elements(courses) c where c->>'id' = link.id)
  ) or exists (
    select 1 from jsonb_array_elements(courses) c
    where jsonb_typeof(c) is distinct from 'object'
       or c ? 'owner_id'
       or jsonb_typeof(lessons->(c->>'id')) is distinct from 'array'
  ) then
    raise exception using errcode = '22023', message = 'Invalid course membership';
  end if;

  if exists (
    select 1 from jsonb_array_elements(courses) c
    group by (c->>'id')::uuid having count(*) > 1
  ) or exists (
    select 1 from jsonb_each(lessons) c cross join lateral jsonb_array_elements_text(c.value) l
    group by l::uuid having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Duplicate course or lesson identifier';
  end if;

  insert into public.atlas_courses as original(owner_id, id, title, color, position)
  select lecturer, (c->>'id')::uuid, c->>'title', c->>'color', seq - 1
  from jsonb_array_elements(courses) with ordinality as source(c, seq)
  on conflict on constraint atlas_courses_pkey do update
    set title = excluded.title, color = excluded.color, position = excluded.position, updated_at = now()
    where (original.title, original.color, original.position) is distinct from (excluded.title, excluded.color, excluded.position);

  delete from public.atlas_course_lessons existing where existing.owner_id = lecturer and not exists (
    select 1 from jsonb_each(lessons) course cross join lateral jsonb_array_elements_text(course.value) as l(id)
    where l.id::uuid = existing.lesson_id
  );
  insert into public.atlas_course_lessons as original(owner_id, lesson_id, course_id, position)
  select lecturer, l.id::uuid, course.key::uuid, l.seq - 1
  from jsonb_each(lessons) course cross join lateral jsonb_array_elements_text(course.value) with ordinality as l(id, seq)
  on conflict on constraint atlas_course_lessons_pkey do update
    set course_id = excluded.course_id, position = excluded.position, updated_at = now()
    where (original.course_id, original.position) is distinct from (excluded.course_id, excluded.position);

  delete from public.atlas_courses existing where existing.owner_id = lecturer and not exists (
    select 1 from jsonb_array_elements(courses) c where (c->>'id')::uuid = existing.id
  );

  update public.atlas_course_revisions set revision = current_revision + 1 where owner_id = lecturer;
  insert into public.atlas_course_requests(owner_id, request_id, revision)
    values (lecturer, atlas_save_courses.request_id, current_revision + 1);
  return jsonb_build_object('accepted', true, 'snapshot', public.atlas_get_courses(lecturer));
end;
$$;

revoke all on function public.atlas_get_courses(uuid) from public, anon, authenticated;
revoke all on function public.atlas_save_courses(uuid, bigint, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.atlas_get_courses(uuid) to authenticated;
grant execute on function public.atlas_save_courses(uuid, bigint, uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
