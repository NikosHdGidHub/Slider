import { storageReference } from './fileUsage'
import { digest } from './digest'
import { mediaSlides } from './grid.ts'
import {
  adminId,
  isProjectStorageUrl,
  publishDocument,
  withStorageLock,
} from './cloud'
import { recordPublication } from './publicationCatalog'
import { uploadImage } from './resources'
import { imageAddress } from './storage'
import { referencedFonts } from './textFonts'
import { validateDeck, type Deck } from './model'
export async function publish(deck: Deck, approve: () => Promise<boolean>) {
  return withStorageLock(async (bucket) => {
    if (!(await approve())) return false
    const copy = validateDeck(deck)
    const urls = new Map<string, string>()
    async function resolve(src: string) {
      if (urls.has(src)) return urls.get(src)!
      let url = src
      if (src.startsWith('data:')) {
        const blob = await (await fetch(src)).blob()
        url = await uploadImage(blob, bucket)
        await imageAddress(await digest(blob), url)
      }
      const reference = storageReference(url)
      if (reference?.startsWith('atlas-private-resources/'))
        throw Error(
          'Приватное изображение необходимо встроить перед публикацией.'
        )
      if (reference && isProjectStorageUrl(url)) {
        const separator = reference.indexOf('/')
        const { error } = await bucket(reference.slice(0, separator)).info(
          reference.slice(separator + 1)
        )
        if (error)
          throw Error(
            'Облачное изображение недоступно. Вставьте его заново перед публикацией.'
          )
      }
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
    const fonts = referencedFonts(copy)
    copy.resources.fonts = copy.resources.fonts.filter((font) =>
      fonts.has(font.id)
    )
    const document = validateDeck(copy)
    await publishDocument(copy.id, document, bucket)
    // The publication is usable while a failed index write awaits repair.
    await recordPublication(adminId, document, null).catch(() => {})
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
  const fonts = referencedFonts(copy)
  copy.resources.fonts = copy.resources.fonts.filter((font) =>
    fonts.has(font.id)
  )
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
