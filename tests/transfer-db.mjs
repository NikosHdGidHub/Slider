import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { PGlite } from '@electric-sql/pglite'

export const OWNER = '43649fda-26cb-4b20-bbc1-0a398e9d8ce3'
export const OTHER = '39dbb63e-8038-43f9-b4dc-5998ada2ab2a'
export const LESSON = '11111111-1111-4111-8111-111111111111'
export const SECOND = '22222222-2222-4222-8222-222222222222'

export async function openTransferDB() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema storage;
    create function auth.uid() returns uuid language sql as $$
      select (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid
    $$;
    create function auth.role() returns text language sql as $$
      select current_setting('request.jwt.claims', true)::jsonb->>'role'
    $$;
    create table storage.buckets (id text primary key, public boolean);
    create table storage.objects (bucket_id text, name text, primary key(bucket_id,name));
    insert into storage.buckets values ('presentations', true), ('atlas-private', false);
    insert into storage.objects values ('presentations','${LESSON}.json'),
      ('presentations','${SECOND}.json'), ('atlas-private','${OTHER}.json');
  `)
  const migration = readFileSync(
    new URL('../supabase/qr-transfer.sql', import.meta.url),
    'utf8'
  )
  await db.exec(migration)
  await db.exec(migration)

  async function asRole({ teacher, address }, action) {
    const role = teacher ? 'authenticated' : 'anon'
    return db.transaction(async (tx) => {
      await tx.exec('set local role ' + role)
      await tx.query(
        "select set_config('request.jwt.claims',$1,true), set_config('request.headers',$2,true)",
        [
          JSON.stringify({ role, sub: teacher }),
          JSON.stringify(address ? { 'x-real-ip': address } : {}),
        ]
      )
      return action(tx)
    })
  }
  return {
    db,
    asRole,
    rpc: async (action, args, actor = {}) => {
      if (!['start', 'inspect', 'send', 'poll', 'cancel'].includes(action))
        throw Error('Unknown transfer action')
      return asRole(actor, async (tx) => {
        const params = args.map((_, index) => '$' + (index + 1)).join(',')
        const { rows } = await tx.query(
          'select public.atlas_transfer_' +
            action +
            '(' +
            params +
            ') as result',
          args
        )
        return rows[0].result
      })
    },
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { db, rpc } = await openTransferDB()
  console.log('ready')
  for await (const line of createInterface({ input: process.stdin })) {
    try {
      const { action, args, actor } = JSON.parse(line)
      console.log(JSON.stringify({ data: await rpc(action, args, actor) }))
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, code: error.code }))
    }
  }
  await db.close()
}
