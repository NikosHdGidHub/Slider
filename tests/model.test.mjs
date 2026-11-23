import test from 'node:test'
import assert from 'node:assert/strict'
import { imageSource, newDeck, newSlide, newText, validateDeck } from '../src/model.ts'

test('порядок слайдов, заметки, положение объектов и изображения выдерживают JSON round-trip', () => {
  const deck = newDeck('Тестовый урок')
  const slide = newSlide()
  const text = { ...newText(), x: 92.2, y: 223, w: 710, align: 'right', text: '<b>Буквальный текст</b>\nВторая строка' }
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv4kAAAAASUVORK5CYII='
  slide.notes = 'Только для преподавателя\n'.repeat(100)
  slide.background = 'https://example.org/photo.webp'
  slide.items = [text, { ...newText(), type: 'image', text: '', src }]
  deck.slides.unshift(slide)
  assert.deepEqual(validateDeck(JSON.stringify(deck)), deck)
  const copy = validateDeck(deck)
  copy.slides[0].items[0].text = 'Копия'
  assert.equal(deck.slides[0].items[0].text, text.text)
})

test('неподдерживаемые версии, дубликаты, некорректные типы, ссылки и размеры отклоняются', () => {
  const edits = [
    d => { d.version = 2 }, d => { d.slides = [] }, d => { d.slides.push(d.slides[0]) },
    d => { d.slides[0].items[0].w = NaN }, d => { d.slides[0].items[0].type = 'html' },
    d => { d.slides[0].items[0].color = 'url(foo)' },
    ...['blob:local', 'http://example.org/x', 'javascript:alert(1)', 'https://user:pass@example.org/a', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHN2Zz4='].map(src => d => { d.slides[0].background = src })
  ]
  for (const edit of edits) {
    const deck = newDeck('Проверка')
    deck.slides[0].items.push(newText())
    edit(deck)
    assert.throws(() => validateDeck(deck))
  }
  assert.throws(() => validateDeck('[}'))
  assert.throws(() => imageSource(null))
})
