import { digest } from './digest'
import { mediaSlides } from './grid.ts'
import { publishDocument, withPublicationLock } from './cloud'
import { uploadImage } from './resources'
import { imageAddress } from './storage'
import { validateDeck, type Deck } from './model'
const pending = new Map<string, Promise<string>>()
export function cloudImage(src: string, name?: string) {
  if (!src.startsWith('data:')) return Promise.resolve(src)
  const existing = pending.get(src)
  if (existing) return existing
  const job = (async () => {
    const blob = await (await fetch(src)).blob()
    const key = await digest(blob)
    const cached = await imageAddress(key)
    if (
      cached &&
      (await fetch(cached, { method: 'HEAD', cache: 'no-store' })).ok
    )
      return cached
    const url = await uploadImage(blob, name)
    await imageAddress(key, url)
    return url
  })().finally(() => pending.delete(src))
  pending.set(src, job)
  return job
}
export async function publish(deck: Deck, approve: () => Promise<boolean>) {
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
  const document = validateDeck(copy)
  return withPublicationLock(copy.id, async () => {
    if (!(await approve())) return false
    await publishDocument(copy.id, document)
    return true
  })
}

export async function fingerprint(deck: Deck) {
  const copy = structuredClone(validateDeck(deck))
  const ids = new Map<string, string>()
  async function identity(src: string) {
    if (!src.startsWith('data:'))
      return /\/images\/([a-f0-9]{64})\.(?:png|jpg|webp)$/.exec(src)?.[1] || src
    if (!ids.has(src)) {
      const sha = await digest(await (await fetch(src)).blob())
      const url =
        (await imageAddress(sha)) || (await imageAddress('offline-url:' + sha))
      ids.set(src, url && !url.includes('/' + sha + '.') ? url : sha)
    }
    return ids.get(src)!
  }
  for (const slide of mediaSlides(copy)) {
    slide.items = slide.items.filter((o) => o.slot !== 'tray')
    if (slide.background) slide.background = await identity(slide.background)
    for (const item of slide.items)
      if (item.type === 'image') item.src = await identity(item.src)
  }
  delete copy.migrated
  const canonical = JSON.stringify(copy, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]])
        )
      : value
  )
  return digest(new Blob([canonical]))
}
