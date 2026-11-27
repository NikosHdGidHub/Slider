import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const owner = '43649fda-26cb-4b20-bbc1-0a398e9d8ce3'
const id = (n) => 'a7102026-0000-4000-8000-' + n.toString(16).padStart(12, '0')
const other = id(999)
const sha = 'ab'.repeat(32)
const source = (n, title) => ({
  version: 4,
  id: id(n),
  title,
  slides: [{ background: null }],
})
const sql = (name) =>
  readFileSync(new URL('../supabase/' + name + '.sql', import.meta.url), 'utf8')

test('working-library migration preserves templates, prevents cross-owner access and separates working versions from publications', async () => {
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
      create table storage.objects (bucket_id text, name text, updated_at timestamptz default now(), primary key (bucket_id, name));
      grant usage on schema storage to anon, authenticated;
      grant select, insert, update, delete on storage.objects to anon, authenticated;
      alter table storage.objects enable row level security;
      create policy deliberately_broad on storage.objects for all to public using (true) with check (true);
      insert into auth.users values ('${owner}'), ('${other}');
    `)
    for (const name of ['setup', 'templates', 'courses'])
      await db.exec(sql(name))
    const template = {
      kind: 'layout',
      format: 4,
      deck: source(72, 'Существующий шаблон'),
    }
    await db.query('insert into atlas_templates values($1,$2,8,$3)', [
      id(72),
      owner,
      JSON.stringify(template),
    ])
    await db.query(
      'insert into storage.objects(bucket_id,name) values($1,$2)',
      ['presentations', id(1) + '.json']
    )
    await db.exec(sql('cloud-sync'))
    await db.exec(sql('cloud-sync'))

    const role = async (name, uid = '') => {
      await db.exec('reset role')
      await db.query('select set_config($1,$2,false)', ['test.uid', uid])
      await db.exec('set role ' + name)
    }
    const rpc = async (call, args = []) =>
      (await db.query('select ' + call + ' as value', args)).rows[0].value
    const list = () => rpc('atlas_working_list($1)', [owner])
    const read = (doc = 1, kind = 'lesson') =>
      rpc('atlas_working_get($1,$2,$3)', [owner, kind, id(doc)])
    const catalog = () => rpc('atlas_publication_catalog($1)', [owner])
    const write = (
      doc,
      base,
      request,
      payload,
      refs = [],
      remove = false,
      kind = 'lesson'
    ) =>
      rpc('atlas_working_save($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        owner,
        kind,
        id(doc),
        base,
        id(request),
        JSON.stringify(payload),
        sha,
        refs,
        remove,
      ])
    await role('authenticated', owner)
    assert.equal((await list()).length, 1)
    assert.deepEqual((await read(72, 'template')).document, template)
    assert.equal((await read(72, 'template')).meta.revision, 8)
    assert.equal((await list())[0].templateFormat, 4)
    assert.equal((await catalog())[0].title, null)
    assert.equal((await catalog())[0].indexed, false)
    assert.equal(
      await rpc('atlas_publication_record($1,$2,null,$3,1,null)', [
        owner,
        id(1),
        'Публичное название',
      ]),
      true
    )

    const first = source(1, 'Черновик')
    first.slides[0].background = 'atlas-resource:' + sha + ':image/png'
    await assert.rejects(
      () => write(1, 0, 10, first, [sha]),
      /Missing private resource/
    )
    await db.query(
      'insert into storage.objects(bucket_id,name) values($1,$2)',
      ['atlas-private-resources', owner + '/' + sha]
    )
    const receipt = await write(1, 0, 10, first, [sha])
    assert.equal(receipt.committed, 1)
    assert.deepEqual(await write(1, 0, 10, first, [sha]), receipt)
    const second = source(1, 'Новая версия')
    assert.equal((await write(1, 1, 11, second)).committed, 2)
    assert.equal((await write(1, 1, 12, first, [sha])).accepted, false)
    const replay = await write(1, 0, 10, first, [sha])
    assert.equal(replay.committed, 1)
    assert.equal(replay.meta.revision, 2)
    assert.equal(
      (await write(2, 0, 13, source(2, 'Независимая'))).accepted,
      true
    )
    assert.equal(
      (await list()).some((row) => 'document' in row || 'resource_refs' in row),
      false
    )
    assert.equal((await catalog())[0].title, 'Публичное название')
    assert.equal(
      (await write(1, 2, 14, second, [], true)).meta.restorable,
      true
    )
    assert.deepEqual((await read()).document, second)
    assert.equal((await write(1, 3, 15, second)).meta.deleted, null)
    assert.equal((await catalog())[0].id, id(1))
    assert.equal(
      await rpc('atlas_working_editing($1,$2,$3,$4,false)', [
        owner,
        'lesson',
        id(1),
        id(81),
      ]),
      false
    )
    assert.equal(
      await rpc('atlas_working_editing($1,$2,$3,$4,false)', [
        owner,
        'lesson',
        id(1),
        id(82),
      ]),
      true
    )
    await rpc('atlas_working_editing($1,$2,$3,$4,true)', [
      owner,
      'lesson',
      id(1),
      id(81),
    ])
    assert.equal(
      await rpc('atlas_working_editing($1,$2,$3,$4,false)', [
        owner,
        'lesson',
        id(1),
        id(82),
      ]),
      false
    )

    const version = (await catalog())[0].updated
    await role('authenticated', '')
    await assert.rejects(list, /owner required/)
    await role('authenticated', other)
    await assert.rejects(list, /owner required/)
    await assert.rejects(read, /owner required/)
    await assert.rejects(catalog, /owner required/)
    await assert.rejects(() => write(1, 4, 17, first, [sha]), /owner required/)
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='atlas-private-resources'"
        )
      ).rows.length,
      0
    )
    await assert.rejects(
      () =>
        db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
          'atlas-private-resources',
          owner + '/' + 'cd'.repeat(32),
        ]),
      /row-level security/
    )
    await role('anon')
    await assert.rejects(list, /permission denied/)
    await assert.rejects(catalog, /permission denied/)
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='atlas-private-resources'"
        )
      ).rows.length,
      0
    )

    await db.exec('reset role')
    await db.exec(
      "update storage.objects set updated_at=updated_at+interval '1 second' where bucket_id='presentations'"
    )
    await role('authenticated', owner)
    assert.equal((await catalog())[0].indexed, false)
    assert.equal(
      await rpc('atlas_publication_record($1,$2,$3,$4,1,null)', [
        owner,
        id(1),
        version,
        'Устаревшее',
      ]),
      false
    )
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where bucket_id='atlas-private-resources' returning name"
        )
      ).rows.length,
      0
    )
    assert.equal((await write(1, 4, 31, second, [], true)).committed, 5)
    await assert.rejects(
      () => rpc('atlas_expire_working_history()'),
      /permission denied/
    )
    await db.exec('reset role')
    await db.exec(`
      update atlas_working_documents set deleted_at=now()-interval '31 days' where deleted_at is not null;
      update atlas_working_requests set created_at=now()-interval '46 days';
      select atlas_expire_working_history();
    `)
    await role('authenticated', owner)
    const expired = await read()
    assert.equal(expired.meta.revision, 5)
    assert.equal(expired.meta.restorable, false)
    assert.equal(expired.document, null)
    assert.equal((await write(1, 4, 32, second)).accepted, false)
    assert.equal((await catalog())[0].id, id(1))
  } finally {
    await db.close()
  }
})
