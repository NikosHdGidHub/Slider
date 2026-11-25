import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  builtins,
  validateTemplate,
  copyDeck,
  applyLayout,
  waterExample,
} from '../src/catalog.ts'
import {
  validateDeck,
  newDeck,
  newText,
  newShape,
  typography,
  richText,
} from '../src/model.ts'
import { instructions, referenceDecks } from '../src/instructions.ts'
import { shapes } from '../src/schema.ts'

test('v1 сохраняет геометрию, шрифт, переносы и порядок, исходник не изменяется', () => {
  const d = newDeck('Урок'),
    item = { ...newText(), text: 'а\nб' }
  d.slides[0].items = [item]
  const raw = { version: 1, id: d.id, title: d.title, slides: d.slides },
    copy = structuredClone(raw)
  const next = validateDeck(raw)
  assert.deepEqual(raw, copy)
  assert.deepEqual(next.slides[0].items[0], {
    ...item,
    overrides: { font: 'legacy', fit: false },
  })
  assert.deepEqual(validateDeck(JSON.stringify(next)), next)
})
test('вложенная схема строго проверяет поля, границы, ссылки и идентификаторы', () => {
  const edits = [
    (x) => (x.theme.extra = true),
    (x) => (x.slides[0].items[0].onclick = 'x'),
    (x) => (x.slides[0].items[0].shape = 'unknown'),
    (x) => (x.slides[0].items[0].w = -1),
    (x) => (x.slides[0].items[0].rotation = 361),
    (x) => (x.slides[0].items[0].style = 'missing'),
    (x) => (x.slides[0].items[0].fill = { type: 'linear', stops: [] }),
    (x) =>
      (x.slides[0].items[0].fill = {
        type: 'radial',
        stops: [
          { offset: 1, color: '#aaaaaa' },
          { offset: 0, color: '#bbbbbb' },
        ],
      }),
    (x) => (x.slides[0].items[0].id = x.id),
    (x) =>
      (x.resources.fonts = [
        { id: 'bad', label: 'X', format: 'woff2', data: 'AAAA' },
      ]),
    (x) =>
      (x.slides[0].items[0].paragraphs = [{ runs: [{ text: 'различие' }] }]),
    (x) => x.theme.styles.push(x.theme.styles[0]),
    (x) =>
      (x.slides[0].items[0].nodes = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
  ]
  for (const edit of edits) {
    const d = structuredClone(waterExample)
    edit(d)
    assert.throws(() => validateDeck(d))
  }
})
test('Rich Text, независимое наследование и оформление проходят полный цикл JSON', () => {
  const d = newDeck('Тест')
  const it = {
    ...newShape('path'),
    ...richText([
      {
        list: 'bullet',
        runs: [
          { text: 'Два ', bold: true },
          {
            text: 'слова',
            size: 42,
            italic: true,
            font: 'serif',
            highlight: '#fedcba',
            underline: true,
            strike: true,
          },
        ],
      },
      { list: 'number', runs: [{ text: 'Пункт' }] },
    ]),
    style: 'title',
    overrides: { color: '#007788' },
    rotation: 30,
    flipX: true,
    dash: [3, 6],
    shadow: { x: 8, y: -4, blur: 10, color: '#334455' },
  }
  d.slides[0].items.push(it)
  d.theme.styles[0].values.font = 'mono'
  assert.equal(typography(it, d).font, 'mono')
  assert.equal(typography(it, d).color, '#007788')
  assert.deepEqual(validateDeck(JSON.stringify(d)), d)
})
test('шаблоны отделены от копий, проверка числа слайдов сохраняет работу', () => {
  const t = structuredClone(builtins[0]),
    copy = copyDeck(t.deck)
  assert.notEqual(copy.slides[0].items[0].id, t.deck.slides[0].items[0].id)
  t.deck.slides.splice(1, 1)
  assert.throws(() => validateTemplate(t), /три/)
  assert.equal(t.deck.slides.length, 2)
  t.deck.slides = []
  assert.equal(copy.slides.length, 3)
  assert.throws(() => validateTemplate({ ...builtins[2], deck: copy }), /один/)
})
test('смена компоновки сохраняет оформление, шрифты темы и заметки', () => {
  const d = copyDeck(builtins[1].deck),
    s = d.slides[1]
  s.notes = 'Для преподавателя'
  const next = applyLayout(d, s.id, builtins[2]),
    n = next.slides[1]
  assert.equal(n.notes, s.notes)
  assert.equal(n.color, s.color)
  assert.deepEqual(
    n.items.filter((o) => o.role === 'decoration'),
    s.items.filter((o) => o.role === 'decoration')
  )
  assert.deepEqual(next.theme, d.theme)
  assert.equal(n.items.filter((o) => o.shape === 'rounded').length, 3)
  assert.throws(() => applyLayout(d, d.slides[0].id, builtins[2]))
})
test('генератор отражает текущий каталог, исключает адреса и выводит импортируемые эталоны', () => {
  const t = {
    ...builtins[0],
    description: 'Тест-запись',
    deck: copyDeck(builtins[0].deck, 'Мой экземпляр'),
  }
  t.deck.slides[0].background =
    'https://example.org/private?token=privateToken123'
  const fonts = ['Sans', 'Serif'].map((name, i) => {
    const entry = structuredClone(builtins[i])
    entry.deck.resources.fonts = [
      {
        id: 'localFont',
        label: name,
        format: 'woff',
        data: readFileSync(
          new URL('../src/assets/fonts/' + name + '.woff', import.meta.url)
        ).toString('base64'),
      },
    ]
    entry.deck.theme.styles[0].values.font = 'localFont'
    return entry
  })
  const catalog = instructions(fonts, 'Локально')
    .split('G. Каталог презентаций (данные)\n\n')[1]
    .split('\n\n')[0]
  const entries = JSON.parse(catalog)
  assert.notEqual(entries[0].fontIds[0], entries[1].fontIds[0])
  assert.equal(
    entries[1].deck.theme.styles[0].values.font,
    entries[1].fontIds[0]
  )
  const before = instructions([...builtins, t], 'Локально')
  assert.match(before, /Тест-запись/)
  assert.doesNotMatch(before, /privateToken123/)
  t.description = 'Обновление'
  assert.match(instructions([t], 'Локально'), /Обновление/)
  assert.doesNotMatch(instructions(builtins, 'Локально'), /Мой экземпляр/)
  const docs = before
    .split('\n')
    .filter((s) => s.startsWith('{"version"'))
    .map(validateDeck)
  assert.equal(docs.length, referenceDecks().length)
  assert.deepEqual(docs[0], waterExample)
  assert.deepEqual(
    new Set(docs.at(-1).slides.map((s) => s.items[0].shape)),
    new Set(Object.keys(shapes))
  )
  assert.deepEqual(
    validateDeck(
      readFileSync(
        new URL('./fixtures/water-cycle.json', import.meta.url),
        'utf8'
      )
    ),
    waterExample
  )
})

test('скачиваемый пример инструкции совпадает с актуальным генератором', () => {
  const actual = readFileSync(
    new URL('./fixtures/atlas-instructions.txt', import.meta.url),
    'utf8'
  )
  assert.equal(actual, instructions(builtins, 'Встроенные шаблоны') + '\n')
})
