import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { newDeck, newText, newShape, validateDeck } from '../src/model.ts'
import {
  builtins,
  frameTemplate,
  twoByTwo,
  templateFrom,
  instantiate,
  validateTemplate,
} from '../src/catalog.ts'
import {
  cell,
  cellTypes,
  blankGrid,
  slots,
  pose,
  target,
  rectangles,
  validateGrid,
  fitArea,
  structureSlide,
  setStructure,
  switchMaster,
  linkCaptions,
  applyKind,
} from '../src/grid.ts'
import { templateInstructions } from '../src/instructions.ts'
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const image = () => ({
  ...newText(),
  type: 'image',
  text: '',
  src: 'https://example.org/water.png',
})
const areaGrid = () => ({ ...blankGrid(), padding: [180, 320, 180, 320] })
const visual = (o, all) => {
  const p = pose(o, all)
  return [
    p.x + p.item.x * p.k,
    p.y + p.item.y * p.k,
    p.item.w * p.k,
    p.item.h * p.k,
  ]
}
test('weighted merged cells, independent insets and 16:9 containment', () => {
  const g = structuredClone(twoByTwo.deck.slides[0].structure)
  assert.doesNotThrow(() => validateGrid(g, true))
  assert.deepEqual(rectangles(g)[0].box, { x: 44, y: 44, w: 576, h: 408 })
  assert.deepEqual(rectangles(g)[2].outer, { x: 24, y: 472, w: 1232, h: 224 })
  assert.deepEqual(fitArea({ x: 0, y: 50, w: 1280, h: 360 }), {
    x: 320,
    y: 50,
    w: 640,
    h: 360,
  })
  for (const edit of [
    (g) => g.cells.pop(),
    (g) => (g.cells[2].row = 0),
    (g) => (g.cells[0].row = 0.5),
    (g) => (g.rows[0] = 0),
    (g) => (g.cells[0].type = 'area'),
    (g) => (g.cells[1].id = g.cells[0].id),
    (g) => (g.padding[2] = 900),
    (g) => (g.cells[0].padding[1] = 999),
  ]) {
    const invalid = structuredClone(g)
    edit(invalid)
    assert.throws(() => validateGrid(invalid, true))
  }
})
test('migration preserves a shipped v2 deck and semantic-free placement on every slide', () => {
  const old = JSON.parse(read('./water-v2.json')),
    deck = validateDeck(old)
  assert.equal(deck.version, 3)
  assert.equal(deck.master.name, 'По умолчанию')
  assert.equal(deck.migrated, true)
  assert.deepEqual(deck.slides, old.slides)
  assert.deepEqual(deck.theme, old.theme)
  assert.deepEqual(deck.resources, old.resources)
  for (const s of deck.slides)
    for (const o of s.items)
      assert.deepEqual(visual(o, slots(deck.master, s)), [o.x, o.y, o.w, o.h])
  assert.deepEqual(validateDeck(JSON.stringify(deck)), deck)
  const changed = validateDeck(switchMaster(deck, frameTemplate.deck))
  for (const [i, s] of changed.slides.entries()) {
    assert.equal(s.items.length, old.slides[i].items.length)
    for (const [j, o] of s.items.entries()) {
      const { slot, priorSlot, ...rest } = o
      assert.equal(slot, 'tray')
      assert.equal(priorSlot, 'free')
      assert.deepEqual(rest, old.slides[i].items[j])
    }
  }
  assert.throws(() => validateDeck({ ...old, master: deck.master }))
})
test('a nested free composition scales as a unit without drift or local resize distortion', () => {
  const full = newDeck('Полный'),
    small = newDeck('Половинный')
  small.master.schemes.normal = areaGrid()
  const g = blankGrid('free'),
    d = newDeck('Группа')
  const s = d.slides[0]
  s.structure = g
  s.items = [newShape('arrow'), newShape('circle'), newText(), image()].map(
    (o, i) => ({
      ...o,
      x: 10 + i * 43,
      y: 25 + i * 19,
      slot: 's/body',
      group: 'drawing',
    })
  )
  let current = validateDeck(d)
  for (let n = 0; n < 12; n++) {
    current = validateDeck(switchMaster(current, small))
    current.slides[0].items.forEach((o, i) => {
      const orig = s.items[i]
      assert.deepEqual(visual(o, slots(current.master, current.slides[0])), [
        320 + orig.x / 2,
        180 + orig.y / 2,
        orig.w / 2,
        orig.h / 2,
      ])
    })
    current = validateDeck(JSON.stringify(switchMaster(current, full)))
    assert.deepEqual(current.slides[0].items, s.items)
  }
  g.padding = [0, 30, 80, 0]
  assert.deepEqual(visual(s.items[0], slots(d.master, s)), [
    10,
    25,
    s.items[0].w,
    s.items[0].h,
  ])
})
test('compatible semantic roles survive ID changes, exact matches win, ambiguous slots stay in tray', () => {
  const make = (ids) => ({
    ...blankGrid(),
    cols: ids.map(() => 1),
    cells: ids.map((id, i) => cell(0, i, 'title', id)),
  })
  const a = newDeck('Из'),
    b = newDeck('В')
  a.master.schemes.normal = make(['old', 'keep'])
  b.master.schemes.normal = make(['new', 'keep'])
  a.slides[0].items = ['old', 'keep'].map((id) => ({
    ...newText(),
    slot: 'm/' + id,
    relation: 'shared',
  }))
  let next = switchMaster(a, b)
  assert.deepEqual(next.slides[0].items.map(target), ['m/new', 'm/keep'])
  b.master.schemes.normal = make(['one', 'two', 'keep'])
  next = validateDeck(switchMaster(a, b))
  assert.deepEqual(next.slides[0].items.map(target), ['tray', 'm/keep'])
  assert.equal(next.slides[0].items[0].relation, 'shared')
})
test('structure conversion keeps image crop, visual boxes, text and semantic links', () => {
  const d = newDeck('Урок'),
    s = d.slides[0]
  d.master.schemes.normal = areaGrid()
  s.items = [image(), newText()]
  const g = twoByTwo.deck.slides[0].structure
  let n = structureSlide(d.master, s, g)
  assert.deepEqual(n.items.map(target), ['tray', 'tray'])
  n.items[0] = {
    ...n.items[0],
    slot: 's/image',
    imageFit: 'cover',
    focusX: 25,
    relation: 'rain',
  }
  n.items[1] = { ...n.items[1], slot: 's/description', relation: 'rain' }
  const old = n.items.map((o) => visual(o, slots(d.master, n)))
  n = structureSlide(d.master, n)
  validateDeck({ ...d, slides: [n] })
  assert.deepEqual(
    n.items.map((o) => visual(o, slots(d.master, n))),
    old
  )
  assert.equal(n.items[0].focusX, 25)
  assert.equal(n.items[1].relation, 'rain')
  const capped = {
    ...s,
    structure: {
      ...blankGrid(),
      rows: [2, 1],
      cells: [cell(0, 0, 'image', 'img'), cell(1, 0, 'caption', 'cap')],
    },
    items: [
      { ...image(), slot: 's/img' },
      { ...newText(), slot: 's/cap' },
    ],
  }
  const linked = linkCaptions(d.master, capped)
  assert.ok(linked.items[0].relation)
  assert.equal(linked.items[0].relation, linked.items[1].relation)
  assert.equal(linked.items[1].group, undefined)
})
test('custom structure fonts survive collisions and repeated master switches reuse styles', () => {
  const d = newDeck('Урок'),
    t = structuredClone(twoByTwo.deck)
  for (const [deck, name] of [
    [d, 'Sans'],
    [t, 'Serif'],
  ])
    deck.resources.fonts = [
      {
        id: 'project',
        label: name,
        format: 'woff',
        data: readFileSync(
          new URL('../src/assets/fonts/' + name + '.woff', import.meta.url)
        ).toString('base64'),
      },
    ]
  t.slides[0].structure.cells[0].style = { font: 'project', size: 27 }
  const next = validateDeck(setStructure(d, d.slides[0], t))
  const assigned = next.slides[0].structure.cells[0].style.font
  assert.notEqual(assigned, 'project')
  assert.equal(
    next.resources.fonts.find((f) => f.id === assigned).data,
    t.resources.fonts[0].data
  )
  const b = structuredClone(frameTemplate.deck)
  b.theme.styles[0].values.size = 89
  let deck = d
  for (let i = 0; i < 10; i++) deck = switchMaster(deck, b)
  assert.equal(deck.theme.styles.length, d.theme.styles.length + 1)
})
test('save as template selects first occurrence of each role and produces independent references', () => {
  const d = instantiate(frameTemplate)
  const [title, normal, end] = d.slides
  normal.items = [newText(), newText()].map((o) => ({
    ...o,
    group: 'oldGroup',
    relation: 'oldRelation',
  }))
  d.slides = [
    end,
    normal,
    { ...normal, id: crypto.randomUUID(), items: [] },
    title,
  ]
  const t = templateFrom(d)
  assert.equal(t.deck.title, d.title + ' — шаблон')
  assert.deepEqual(
    t.deck.slides.map((s) => s.kind),
    ['title', 'normal', 'end']
  )
  const items = t.deck.slides[1].items
  assert.equal(items[0].group, items[1].group)
  assert.notEqual(items[0].group, normal.items[0].group)
  assert.notEqual(items[0].id, normal.items[0].id)
  t.deck.master.schemes.title.cells[0].value = 'Новый'
  assert.notEqual(d.master.schemes.title.cells[0].value, 'Новый')
  assert.throws(() => templateFrom({ ...d, slides: [normal] }))
})
test('template guide and reference responses agree with the live importer', () => {
  const guide = templateInstructions(builtins, 'Встроенные шаблоны')
  assert.equal(read('../docs/grid/template-instructions.txt'), guide + '\n')
  for (const name of Object.keys(cellTypes))
    assert.ok(guide.includes('"' + name + '"'))
  const samples = guide
    .split('\n')
    .filter((s) => s.startsWith('{"format"'))
    .map((s) => validateTemplate(JSON.parse(s)))
  assert.deepEqual(samples, [frameTemplate, twoByTwo])
  for (const [i, name] of ['main-frame', 'structure-2x2'].entries())
    assert.deepEqual(
      JSON.parse(read('../docs/grid/' + name + '.json')),
      samples[i]
    )
})

test('new slides recover master decorations after deleting the template sample and reimporting', () => {
  const t = structuredClone(frameTemplate)
  const s = t.deck.slides[1]
  s.color = '#fafafa'
  s.items = [{ ...newShape('circle'), role: 'decoration' }]
  const deck = instantiate(t)
  deck.slides = deck.slides.filter((o) => o.kind !== 'normal')
  const restored = validateDeck(JSON.stringify(deck))
  const page = applyKind(restored.master, restored.slides[0], 'normal')
  assert.equal(page.color, s.color)
  assert.equal(page.items[0].shape, 'circle')
  assert.ok(page.items[0].fixed)
  assert.notEqual(page.items[0].id, restored.master.art.normal.items[0].id)
})
