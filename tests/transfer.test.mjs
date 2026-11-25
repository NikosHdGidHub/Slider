import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { openTransferDB, OWNER, OTHER, LESSON, SECOND } from './transfer-db.mjs'

const { db, rpc, asRole } = await openTransferDB()
after(() => db.close())
const teacher = { teacher: OWNER }
const outsider = { teacher: OTHER }
const hash = (token) => createHash('sha256').update(token).digest('hex')
const randomSecret = () => randomBytes(32).toString('hex')

async function start(actor) {
  const sender = randomSecret()
  const receiver = randomSecret()
  const details = await rpc('start', [hash(sender), hash(receiver)], actor)
  assert.equal(details.status, 'waiting')
  return { ...details, sender, receiver }
}

test('transfer creates separate device pairs and keeps hashes and records private', async () => {
  const a = await start(),
    b = await start()
  assert.notEqual(a.id, b.id)
  assert.notEqual(a.sender, a.receiver)
  assert.notEqual(a.sender, b.sender)
  assert.notEqual(a.receiver, b.receiver)
  assert.match(a.code, /^[0-9A-F]{6}$/)
  assert.equal(a.remaining_ms, 120000)
  const {
    rows: [record],
  } = await db.query(
    'select sender_hash, receiver_hash from atlas_transfer_private.requests where id=$1',
    [a.id]
  )
  assert.deepEqual(record, {
    sender_hash: hash(a.sender),
    receiver_hash: hash(a.receiver),
  })
  for (const actor of [{}, outsider, teacher]) {
    await assert.rejects(
      asRole(actor, (tx) =>
        tx.query('select * from atlas_transfer_private.requests')
      ),
      { code: '42501' }
    )
    await assert.rejects(
      asRole(actor, (tx) =>
        tx.query(
          'update atlas_transfer_private.requests set publication_id=$1',
          [LESSON]
        )
      ),
      { code: '42501' }
    )
  }
  assert.deepEqual(await rpc('start', [hash(a.sender), hash(a.sender)]), {
    status: 'invalid',
  })
  assert.deepEqual(await rpc('start', [hash(a.sender), hash(a.receiver)]), {
    status: 'invalid',
  })
  assert.deepEqual(await rpc('poll', [a.id, b.receiver]), { status: 'invalid' })
  assert.deepEqual(await rpc('poll', [a.id, a.sender]), { status: 'invalid' })
  assert.deepEqual(await rpc('inspect', [a.id, a.receiver], teacher), {
    status: 'invalid',
  })
  assert.deepEqual(await rpc('inspect', [a.id, b.sender], teacher), {
    status: 'invalid',
  })
  const inspect = await rpc('inspect', [a.id, a.sender], teacher)
  assert.equal(inspect.code, a.code)
  assert.ok(inspect.remaining_ms > 0 && inspect.remaining_ms <= 120000)
  assert.deepEqual(Object.keys(inspect).sort(), [
    'code',
    'remaining_ms',
    'status',
  ])
})

test('only the authenticated owner can send an existing public publication UUID', async () => {
  const a = await start()
  await assert.rejects(rpc('send', [a.id, a.sender, LESSON]), { code: '42501' })
  await assert.rejects(rpc('inspect', [a.id, a.sender]), { code: '42501' })
  assert.deepEqual(await rpc('send', [a.id, a.sender, LESSON], outsider), {
    status: 'forbidden',
  })
  assert.deepEqual(await rpc('inspect', [a.id, a.sender], outsider), {
    status: 'forbidden',
  })
  assert.deepEqual(await rpc('send', [a.id, a.receiver, LESSON], teacher), {
    status: 'invalid',
  })
  await assert.rejects(
    rpc('send', [a.id, a.sender, 'https://example.org/attack'], teacher),
    { code: '22P02' }
  )
  assert.deepEqual(await rpc('send', [a.id, a.sender, OTHER], teacher), {
    status: 'missing_publication',
  })
  assert.deepEqual(await rpc('send', [a.id, a.sender, randomUUID()], teacher), {
    status: 'missing_publication',
  })
  await db.exec(
    "update storage.buckets set public=false where id='presentations'"
  )
  try {
    assert.deepEqual(await rpc('send', [a.id, a.sender, LESSON], teacher), {
      status: 'missing_publication',
    })
  } finally {
    await db.exec(
      "update storage.buckets set public=true where id='presentations'"
    )
  }
  assert.deepEqual(await rpc('send', [a.id, a.sender, LESSON], teacher), {
    status: 'sent',
  })
  assert.deepEqual(await rpc('poll', [a.id, a.receiver]), {
    status: 'received',
    publication_id: LESSON,
  })
})

test('competing sends and receives have one winner and return only the public UUID', async () => {
  const a = await start(),
    b = await start()
  const results = await Promise.all(
    [LESSON, SECOND].map((id) => rpc('send', [a.id, a.sender, id], teacher))
  )
  assert.deepEqual(results.map((result) => result.status).sort(), [
    'sent',
    'used',
  ])
  assert.deepEqual(await rpc('poll', [a.id, b.receiver]), { status: 'invalid' })
  assert.deepEqual(await rpc('poll', [b.id, b.receiver]), { status: 'waiting' })
  assert.deepEqual(await rpc('poll', [b.id, b.receiver]), {
    status: 'rate_limited',
  })
  const received = await Promise.all(
    [1, 2].map(() => rpc('poll', [a.id, a.receiver]))
  )
  assert.deepEqual(received.map((result) => result.status).sort(), [
    'received',
    'used',
  ])
  const delivered = received.find((result) => result.status === 'received')
  assert.deepEqual(delivered, {
    status: 'received',
    publication_id: results[0].status === 'sent' ? LESSON : SECOND,
  })
  assert.deepEqual(await rpc('inspect', [a.id, a.sender], teacher), {
    status: 'used',
  })
  assert.deepEqual(await rpc('send', [a.id, a.sender, LESSON], teacher), {
    status: 'used',
  })
  const {
    rows: [record],
  } = await db.query(
    'select publication_id from atlas_transfer_private.requests where id=$1',
    [a.id]
  )
  assert.equal(record.publication_id, null)
})

test('expiry, receiver cancellation, publication withdrawal and cleanup', async () => {
  const a = await start(),
    b = await start(),
    c = await start()
  assert.deepEqual(await rpc('cancel', [a.id, b.receiver]), {
    status: 'invalid',
  })
  await rpc('send', [a.id, a.sender, LESSON], teacher)
  assert.deepEqual(await rpc('cancel', [a.id, a.receiver]), {
    status: 'canceled',
  })
  assert.deepEqual(await rpc('poll', [a.id, a.receiver]), {
    status: 'canceled',
  })
  assert.deepEqual(await rpc('send', [a.id, a.sender, LESSON], teacher), {
    status: 'canceled',
  })
  await db.query(
    `
    update atlas_transfer_private.requests
    set expires_at=statement_timestamp()-interval '1 second',created_at=statement_timestamp()-interval '121 seconds'
    where id=$1`,
    [b.id]
  )
  assert.deepEqual(await rpc('inspect', [b.id, b.sender], teacher), {
    status: 'expired',
  })
  assert.deepEqual(await rpc('send', [b.id, b.sender, LESSON], teacher), {
    status: 'expired',
  })
  assert.deepEqual(await rpc('poll', [b.id, b.receiver]), { status: 'expired' })
  await start()
  assert.deepEqual(await rpc('poll', [b.id, b.receiver]), { status: 'invalid' })
  assert.deepEqual(await rpc('send', [c.id, c.sender, LESSON], teacher), {
    status: 'sent',
  })
  await db.query('delete from storage.objects where name=$1', [
    LESSON + '.json',
  ])
  try {
    assert.deepEqual(await rpc('poll', [c.id, c.receiver]), {
      status: 'missing_publication',
    })
    assert.deepEqual(await rpc('poll', [c.id, c.receiver]), { status: 'used' })
  } finally {
    await db.query("insert into storage.objects values ('presentations',$1)", [
      LESSON + '.json',
    ])
  }
})

test('creation attempts have both an address limit and a hard global limit', async () => {
  await db.exec('delete from atlas_transfer_private.requests')
  const address = { address: '203.0.113.8' }
  for (let i = 0; i < 12; i++) await start(address)
  assert.deepEqual(
    await rpc('start', [hash(randomSecret()), hash(randomSecret())], address),
    { status: 'rate_limited' }
  )
  for (let i = 0; i < 48; i++) await start()
  assert.deepEqual(
    await rpc('start', [hash(randomSecret()), hash(randomSecret())], {
      address: '203.0.113.9',
    }),
    { status: 'rate_limited' }
  )
  const {
    rows: [record],
  } = await db.query(
    'select count(*)::integer as count from atlas_transfer_private.requests'
  )
  assert.equal(record.count, 60)
})
