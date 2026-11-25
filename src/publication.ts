import { mediaSlides } from './grid.ts'
import { uploadImage, publishDocument } from './cloud'
import { imageAddress } from './storage'
import { validateDeck, type Deck } from './model'
const pending = new Map<string, Promise<string>>()
export function cloudImage(src: string) {
  if (!src.startsWith('data:')) return Promise.resolve(src)
  const existing = pending.get(src)
  if (existing) return existing
  const job = (async () => {
    const blob = await (await fetch(src)).blob()
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await blob.arrayBuffer()
    )
    const key = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, '0')
    ).join('')
    const cached = await imageAddress(key)
    if (
      cached &&
      (await fetch(cached, { method: 'HEAD', cache: 'no-store' })).ok
    )
      return cached
    const url = await uploadImage(blob)
    await imageAddress(key, url)
    return url
  })().finally(() => pending.delete(src))
  pending.set(src, job)
  return job
}
export async function publish(deck: Deck) {
  const copy = structuredClone(validateDeck(deck))
  const urls = new Map<string, string>()
  async function resolve(src: string) {
    if (urls.has(src)) return urls.get(src)!
    const url = await cloudImage(src)
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      throw new Error(
        'Изображение недоступно. Проверьте подключение и повторите публикацию.'
      )
    }
    urls.set(src, url)
    return url
  }
  for (const slide of mediaSlides(copy)) {
    slide.items = slide.items.filter((o) => o.slot !== 'tray')
    if (slide.background) slide.background = await resolve(slide.background)
    for (const item of slide.items)
      if (item.type === 'image') item.src = await resolve(item.src)
  }
  await publishDocument(copy.id, validateDeck(copy))
}
