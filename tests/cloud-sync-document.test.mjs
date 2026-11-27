import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { newDeck, newText, validateDeck } from '../src/model.ts'
import { packWorking, unpackWorking } from '../src/workingDocument.ts'

const image =
  'data:image/png;base64,' +
  readFileSync(
    new URL('../public/icons/atlas-192.png', import.meta.url)
  ).toString('base64')

test('working documents deduplicate artwork and fonts while hashing tray and notes', async () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/algorithm-font.json', import.meta.url))
  )
  const deck = validateDeck(fixture)
  deck.slides[0].background = image
  deck.slides[1].background = image
  const original = structuredClone(deck)
  const packed = await packWorking('lesson', deck)
  assert.deepEqual(deck, original)
  assert.equal(packed.assets.size, 2)
  assert.equal(
    packed.document.slides[0].background,
    packed.document.slides[1].background
  )
  assert.match(
    packed.document.slides[0].background,
    /^atlas-resource:[a-f0-9]{64}:image\/png$/
  )
  assert.ok(!JSON.stringify(packed.document).includes('base64,'))
  const meta = { kind: 'lesson', id: deck.id, hash: packed.hash, deleted: null }
  const unpacked = await unpackWorking(meta, packed.document, async (sha) =>
    packed.assets.get(sha)
  )
  assert.deepEqual(unpacked, original)
  const notes = structuredClone(deck)
  notes.slides[0].notes += ' Дополнение'
  assert.notEqual((await packWorking('lesson', notes)).hash, packed.hash)
  const tray = structuredClone(deck)
  tray.slides[1].items.push({
    ...newText(),
    x: 0,
    y: 0,
    slot: 'tray',
    text: 'Не размещён',
  })
  assert.notEqual((await packWorking('lesson', tray)).hash, packed.hash)
  await assert.rejects(
    () => unpackWorking(meta, packed.document, async () => new Blob(['wrong'])),
    /Контрольная сумма приватного ресурса/
  )
  const tampered = { ...packed.document, title: 'Подмена' }
  await assert.rejects(
    () => unpackWorking(meta, tampered, async () => null),
    /облачного документа/
  )
})

test('permanent external references and canonical key order are preserved', async () => {
  const original = newDeck('Ссылка')
  original.slides[0].background = 'https://example.org/resource.png'
  const one = await packWorking('lesson', original)
  const reverse = Object.fromEntries(Object.entries(original).reverse())
  const two = await packWorking('lesson', reverse)
  assert.equal(one.hash, two.hash)
  assert.equal(one.assets.size, 0)
  assert.equal(one.document.slides[0].background, original.slides[0].background)
})
