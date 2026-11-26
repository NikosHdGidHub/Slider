import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { createGridTemplate, validateTemplate } from '../src/catalog.ts'
import { cell, setStructure, switchMaster, slots } from '../src/grid.ts'
import {
  newDeck,
  newText,
  replaceStyle,
  sourceText,
  typography,
  validateDeck,
} from '../src/model.ts'
import { textTypeIds } from '../src/textTypes.ts'
import { fontCatalog } from '../src/fontCatalog.ts'
import { offlineFontPaths } from '../src/textFonts.ts'

const load = (name) =>
  JSON.parse(
    readFileSync(
      new URL('./fixtures/' + name + '.json', import.meta.url),
      'utf8'
    )
  )
const old = load('typography-vertex-v3')
const modern = load('typography-vertex-v4')
const occupant = (s, id) => s.items.find((item) => item.slot === 'm/' + id)

test('v3 typographic migration preserves visible footer priority, rich text, geometry and conflicting title sizes', () => {
  const before = structuredClone(old)
  const template = validateTemplate(old)
  const { deck } = template
  assert.deepEqual(old, before)
  assert.equal(template.format, 4)
  assert.equal(deck.version, 4)
  assert.deepEqual(validateTemplate(template), template)
  assert.deepEqual(validateTemplate(old), template)
  assert.equal(
    deck.master.schemes.title.cells.find((c) => c.id === 'bottom').value,
    old.deck.footer
  )
  assert.equal(occupant(deck.slides[0], 'bottom'), undefined)
  assert.equal(occupant(deck.slides[1], 'bottom').text, '')
  assert.equal(occupant(deck.slides[2], 'bottom').text, 'ФИНАЛ / ПРАКТИКА')
  assert.ok(!('footer' in deck) && deck.slides.every((s) => !('footer' in s)))
  for (const [i, role] of ['title', 'normal', 'end'].entries()) {
    const field = deck.master.schemes[role].cells[1]
    assert.equal(typography(newText(), deck, field).size, [64, 52, 88][i])
    if (i) assert.equal(field.bindingType, 'title')
    assert.equal(deck.slides[i].notes, old.deck.slides[i].notes)
    assert.deepEqual(
      deck.slides[i].items.find((o) => o.shape === 'path').nodes,
      old.deck.slides[i].items.find((o) => o.shape === 'path').nodes
    )
  }
  const detail = occupant(deck.slides[0], 'detail')
  assert.equal(detail.paragraphs[0].list, 'bullet')
  assert.equal(detail.paragraphs[0].indent, 12)
  assert.equal(detail.paragraphs[0].runs[0].weight, '700')
})

test('v1, v2 and unversioned template wrappers are accepted and produce stable v4', () => {
  const original = load('map-standard')
  const historicalItem = {
    id: original.slides[0].items[0].id,
    type: 'text',
    x: 20,
    y: 20,
    w: 100,
    h: 80,
    text: 'История',
    src: '',
    size: 41,
    color: '#447788',
    align: 'right',
  }
  const slide = {
    id: original.slides[0].id,
    color: '#ffffff',
    background: null,
    notes: 'заметка',
    items: [historicalItem],
  }
  const v1 = {
    id: original.id,
    title: 'Первый формат',
    version: 1,
    slides: [slide],
  }
  const v2 = {
    ...v1,
    version: 2,
    canvas: original.canvas,
    theme: original.theme,
    resources: original.resources,
  }
  for (const v of [v1, v2]) {
    const next = validateDeck(v)
    assert.deepEqual(next, validateDeck(next))
    assert.equal(next.slides[0].items[0].text, 'История')
    assert.equal(next.slides[0].items[0].overrides.size, 41)
    assert.equal(next.slides[0].notes, 'заметка')
  }
  const { format, ...wrapper } = old
  assert.equal(validateTemplate(wrapper).deck.version, 4)
})

test('strict types are shared and reject inherited local formatting, while rich marks are partial', () => {
  const deck = validateTemplate(modern).deck
  assert.deepEqual(Object.keys(deck.theme.systemStyles), textTypeIds)
  const title = deck.master.schemes.title.cells[1]
  const strict = {
    ...newText(),
    slot: 'm/heading',
    style: deck.theme.styles[0].id,
  }
  deck.slides[0].items.push(strict)
  assert.throws(() => validateDeck(deck), /несовместим|Системный тип/)
  delete strict.style
  deck.theme.systemStyles.title.size = 70
  assert.equal(typography(strict, deck, title).size, 70)
  assert.equal(validateDeck(deck).slides[0].items.at(-1).id, strict.id)
  const rich = {
    ...newText(),
    text: 'цвет остальное',
    paragraphs: [
      { runs: [{ text: 'цвет', color: '#aa33ff' }, { text: ' остальное' }] },
    ],
  }
  deck.theme.systemStyles.text.size = 40
  assert.equal(typography(rich, deck).size, 40)
  assert.deepEqual(rich.paragraphs[0].runs[0], {
    text: 'цвет',
    color: '#aa33ff',
  })
  title.value = ''
  assert.equal(sourceText(title), '')
})

test('layout resources are copied and replaced safely; main template includes its own system styles', () => {
  const original = newDeck('Методичка')
  original.theme.styles = [{ id: 'box', label: 'Урок', values: { size: 41 } }]
  const layout = createGridTemplate('layout', 'Сетка')
  layout.deck.theme.styles = [
    { id: 'box', label: 'Сетка', values: { size: 27 } },
  ]
  layout.deck.slides[0].structure.cells[0].textStyle = 'box'
  layout.deck.theme.systemStyles.text.size = 80
  const next = setStructure(original, original.slides[0], layout.deck)
  const slot = slots(next.master, next.slides[0]).find((v) =>
    v.id.startsWith('s/')
  )
  assert.notEqual(slot.cell.textStyle, 'box')
  assert.equal(typography(newText(), next, slot.cell).size, 27)
  assert.equal(
    next.theme.systemStyles.text.size,
    original.theme.systemStyles.text.size
  )
  const replaced = replaceStyle(validateDeck(next), slot.cell.textStyle, 'box')
  assert.equal(replaced.slides[0].structure.cells[0].textStyle, 'box')
  const plain = replaceStyle(replaced, 'box')
  assert.equal(
    validateDeck(plain).slides[0].structure.cells[0].textStyle,
    undefined
  )
  assert.equal(layout.deck.slides[0].structure.cells[0].textStyle, 'box')
  const presentation = createGridTemplate('presentation', 'Главный')
  presentation.deck.theme.systemStyles.title.size = 90
  presentation.deck.master.schemes.normal.cells = [
    cell(0, 0, 'title', 'heading'),
  ]
  assert.equal(
    validateDeck(switchMaster(original, presentation.deck)).theme.systemStyles
      .title.size,
    90
  )
})

test('built-in assets exist and offline preparation excludes unrelated families', () => {
  const collection = Object.entries(fontCatalog).filter(
    ([id]) => id !== 'legacy'
  )
  assert.equal(collection.length, 21)
  for (const [id, font] of collection) {
    assert.ok(
      statSync(
        new URL('../public/fonts/' + id + '/LICENSE.txt', import.meta.url)
      ).size > 0
    )
    if (font.italic) assert.ok(font.faces.some((face) => face[2] === 'italic'))
    for (const [file] of font.faces)
      assert.equal(
        readFileSync(
          new URL('../public/fonts/' + id + '/' + file, import.meta.url)
        )
          .subarray(0, 4)
          .toString(),
        'wOF2'
      )
  }
  const paths = offlineFontPaths(modern.deck)
  assert.ok(paths.some((file) => file.startsWith('fonts/manrope/')))
  assert.ok(paths.some((file) => file.startsWith('fonts/jetbrains-mono/')))
  assert.ok(!paths.some((file) => file.startsWith('fonts/lora/')))
})

test('v4 worked examples import without migration and use the selected layout and typography', () => {
  const source = load('typography-lesson-v4')
  const deck = validateDeck(source)
  assert.deepEqual(deck, source)
  assert.equal(
    deck.slides[0].items.find((o) => o.slot === 'm/heading').text,
    'Где находится точка в 3D?'
  )
  assert.deepEqual(deck.master.schemes, modern.deck.master.schemes)
  assert.equal(deck.theme.systemStyles.title.font, 'manrope')
  const layout = validateTemplate(load('typography-layout-v4'))
  const original = newDeck('Опыт')
  const composed = setStructure(original, original.slides[0], layout.deck)
  assert.equal(
    layout.deck.slides[0].structure.cells.at(-1).textStyle,
    'conclusionStyle'
  )
  assert.ok(
    composed.theme.styles.some((style) => style.id === 'conclusionStyle')
  )
})
