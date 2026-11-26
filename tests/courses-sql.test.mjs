import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const owner = '43649fda-26cb-4b20-bbc1-0a398e9d8ce3'
const id = (n) => 'a7102026-0000-4000-8000-' + n.toString(16).padStart(12, '0')
const other = id(99999)
const sql = (name) => readFileSync(new URL('../supabase/' + name + '.sql', import.meta.url), 'utf8')
const course = (n) => ({ id: id(n), title: 'Курс ' + n, color: '#407f69' })

test('courses migration is repeatable and real PostgreSQL RLS/CAS protect the existing library', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public bool, file_size_limit int, allowed_mime_types text[]);
      create table storage.objects (bucket_id text, name text, primary key (bucket_id, name));
      alter table storage.objects enable row level security;
      insert into auth.users values ('${owner}'), ('${other}');
    `)
    await db.exec(sql('setup'))
    await db.exec(sql('templates'))
    await db.exec(`insert into storage.objects values ('presentations', '${id(2000)}.json');`)
    const before = await db.query('select * from storage.objects')
    await db.exec(sql('courses'))
    await db.exec(sql('courses'))
    assert.deepEqual(await db.query('select * from storage.objects'), before)

    async function user(role, uid = '') {
      await db.exec('reset role')
      await db.query('select set_config($1, $2, false)', ['test.uid', uid])
      await db.exec('set role ' + role)
    }
    async function read(uid = owner) {
      return (await db.query('select atlas_get_courses($1) as snapshot', [uid])).rows[0].snapshot
    }
    async function write(rev, request, courses, lessons, uid = owner) {
      return (await db.query('select atlas_save_courses($1,$2,$3,$4,$5) as receipt',
        [uid, rev, id(request), JSON.stringify(courses), JSON.stringify(lessons)])).rows[0].receipt
    }
    const courses = [course(1), course(2)]
    const members = { [id(1)]: [id(100), id(200)], [id(2)]: [] }
    await user('authenticated', owner)
    assert.deepEqual(await read(), { revision: 0, courses: [], lessons: {} })
    const first = await write(0, 10, courses, members)
    assert.equal(first.accepted, true)
    assert.deepEqual(first.snapshot, { revision: 1, courses, lessons: members })
    assert.deepEqual(await write(0, 10, courses, members), first)
    assert.equal((await write(0, 11, courses, members)).accepted, false)
    await assert.rejects(() => write(1, 11, courses, { ...members, [id(2)]: [id(100)] }), /Duplicate course or lesson/)
    await assert.rejects(() => write(1, 12, [courses[0]], members), /Invalid course membership/)
    await assert.rejects(() => write(1, 13, [{ ...courses[0], owner_id: other }], { [id(1)]: [] }), /Invalid course membership/)
    assert.deepEqual(await read(), first.snapshot)
    assert.deepEqual((await write(1, 14, [...courses].reverse(), { [id(1)]: [id(200), id(100)], [id(2)]: [id(201)] })).snapshot.lessons[id(1)], [id(200), id(100)])

    await user('anon')
    await assert.rejects(() => read(), /permission denied/)
    await assert.rejects(() => write(2, 15, [], {}), /permission denied/)
    await user('authenticated', other)
    assert.equal((await db.query('select * from atlas_courses')).rows.length, 0)
    assert.equal((await db.query('select * from atlas_course_lessons')).rows.length, 0)
    await assert.rejects(() => read(), /owner access required/)
    await assert.rejects(() => write(2, 15, [], {}, other), /owner access required/)
    await assert.rejects(() => write(2, 15, [], {}), /owner access required/)
    await assert.rejects(() => db.exec(`insert into atlas_courses(owner_id,id,title,color,position) values ('${owner}','${id(32)}','Title','#407f69',2)`), /permission denied/)
    await assert.rejects(() => db.exec('update atlas_courses set position = 0'), /permission denied/)
    await assert.rejects(() => db.exec('delete from atlas_course_lessons'), /permission denied/)

    await user('authenticated', owner)
    assert.equal((await read()).revision, 2)
    const deleted = await write(2, 16, [courses[1]], { [id(2)]: [id(201)] })
    assert.ok(deleted.accepted)
    assert.equal((await db.query('select * from atlas_course_lessons')).rows.length, 1)
    assert.equal((await write(0, 10, courses, members)).snapshot.revision, 3)

    const large = Array.from({ length: 50 }, (_, i) => course(1000 + i))
    const all = Object.fromEntries(large.map((c, i) => [c.id, i < 4 ? Array.from({ length: 125 }, (_, j) => id(5000 + i * 125 + j)) : []]))
    const start = performance.now()
    assert.ok((await write(3, 17, large, all)).accepted)
    assert.deepEqual((await read()).lessons, all)
    console.log('50 courses, 500 memberships, write and read:', Math.round(performance.now() - start), 'ms')
  } finally {
    await db.close()
  }
})
