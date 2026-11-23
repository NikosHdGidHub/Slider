import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { newDeck, newText } from '../src/model.ts'

// Load the same module graph as Vite, without starting an HTTP listener.
const vite = await createServer({configFile: false, optimizeDeps: {noDiscovery: true, include: []}, server: { middlewareMode: true, hmr: false, watch: null }})
const { embedImages, optimize } = await vite.ssrLoadModule('/src/media.ts')
after(() => vite.close())

test('пустой, неподдерживаемый и слишком большой файлы отклоняются до декодирования', async () => {
  await assert.rejects(optimize(new Blob([])), /размером/)
  await assert.rejects(optimize(new Blob(['text'], {type: 'text/plain'})), /JPEG/)
  await assert.rejects(optimize(new Blob([new Uint8Array(16 * 1024 * 1024 + 1)])), /размером/)
  await assert.rejects(optimize(new Blob(['<!DOCTYPE svg><svg/>'], {type: 'image/svg+xml'})), /SVG/)
})

test('ошибка загрузки обязательного фона прерывает офлайн-подготовку и сохраняет исходную методичку', async t => {
  const deck = newDeck('Офлайн')
  deck.slides[0].background = 'https://example.org/missing.webp'
  const original = structuredClone(deck)
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {status: 404}))
  await assert.rejects(embedImages(deck), /Не удалось сохранить изображение/)
  assert.deepEqual(deck, original)
})

test('один и тот же файл фона и объекта подготавливается один раз', async t => {
  const deck = newDeck('Копия')
  const url = 'https://example.org/thumbnail.png'
  deck.slides[0].background = url
  deck.slides[0].items.push({...newText(), type: 'image', text: '', src: url})
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv4kAAAAASUVORK5CYII=', 'base64')
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(bytes, {headers: {'Content-Type': 'image/png'}}))
  // Model the browser's asynchronous file reader and successful image decoder.
  globalThis.FileReader = class {
    async readAsDataURL(blob) {
      this.result = 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64')
      this.onload()
    }
  }
  globalThis.Image = class {naturalWidth = 1; naturalHeight = 1; async decode() {}}
  try {
    const copy = await embedImages(deck)
    assert.equal(fetchMock.mock.callCount(), 1)
    assert.match(copy.slides[0].background, /^data:image\/png;base64,/)
    assert.equal(copy.slides[0].items[0].src, copy.slides[0].background)
    assert.equal(deck.slides[0].background, url)
  } finally {
    delete globalThis.FileReader
    delete globalThis.Image
  }
})
