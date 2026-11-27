import { validateTemplate, type Template } from './catalog.ts'
import { digest } from './digest.ts'
import { mediaSlides } from './grid.ts'
import { newDeck, validateDeck, type Deck } from './model.ts'

export type WorkingKind = 'lesson' | 'template'
export type WorkingDocument = Deck | Template
export type WorkingMeta = {
  id: string
  kind: WorkingKind
  title: string
  slides: number
  templateKind: Template['kind'] | null
  templateFormat: number | null
  revision: number
  hash: string | null
  updated: string
  deleted: string | null
  restorable: boolean
}
export type WorkingAttempt = {
  request: string
  generation: number
  base: number
  document: WorkingDocument | { title: string; templateKind?: Template['kind'] }
  hash: string
  refs: string[]
  deleted: boolean
  createCloud?: boolean
}
export type WorkingRecord = {
  kind: WorkingKind
  id: string
  base: number | null
  localId?: string
  title?: string
  templateKind?: Template['kind']
  localUpdated?: number
  localSlides?: number
  generation: number
  dirty: boolean
  createCloud?: boolean
  deleted: boolean
  previous?: WorkingDocument
  conflict?: WorkingMeta
  attempt?: WorkingAttempt
  meta?: WorkingMeta
}

const pointer =
  /^atlas-resource:([0-9a-f]{64}):(image\/(?:png|jpeg|webp)|font\/(?:woff2|woff|ttf|otf))$/

const cardDeck = newDeck('Без названия')
// A list row exposes identity and title. Editor actions must resolve its body.
export function workingCardDeck(id: string, title: string): Deck {
  return { ...cardDeck, id, title }
}

export function workingDeck(document: WorkingDocument) {
  return 'deck' in document ? document.deck : document
}
function validate(kind: WorkingKind, document: unknown) {
  return kind === 'template'
    ? validateTemplate(document)
    : validateDeck(document)
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    current && typeof current === 'object' && !Array.isArray(current)
      ? Object.fromEntries(
          Object.keys(current)
            .sort()
            .map((key) => [key, current[key]])
        )
      : current
  )
}

async function replaceResources(
  deck: Deck,
  transform: (source: string, font?: string) => Promise<string>
) {
  for (const slide of mediaSlides(deck)) {
    if (slide.background) slide.background = await transform(slide.background)
    for (const item of slide.items)
      if (item.type === 'image') item.src = await transform(item.src)
  }
  for (const font of deck.resources?.fonts ?? [])
    font.data = await transform(font.data, font.format)
}

export async function packWorking(kind: WorkingKind, source: WorkingDocument) {
  const document = structuredClone(validate(kind, source))
  const assets = new Map<string, Blob>()
  const converted = new Map<string, string>()
  await replaceResources(workingDeck(document), async (source, font) => {
    const url = font ? 'data:font/' + font + ';base64,' + source : source
    if (!url.startsWith('data:')) {
      const address = new URL(source)
      const temporary =
        /\/storage\/v1\/(?:object|render\/image)\/sign\//.test(
          address.pathname
        ) ||
        [...address.searchParams.keys()].some((key) =>
          /^(?:X-Amz-Signature|X-Goog-Signature|Signature)$/i.test(key)
        )
      if (!temporary) return source
    }
    const known = converted.get(url)
    if (known) return known
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!response.ok)
      throw Error(
        'Не удалось получить временное изображение. Вставьте его заново.'
      )
    const blob = await response.blob()
    if (
      !font &&
      (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ||
        blob.size > 18 * 1024 * 1024)
    )
      throw Error(
        'Ожидается изображение PNG, JPEG или WebP размером до 18 МиБ.'
      )
    const sha = await digest(blob)
    const result = 'atlas-resource:' + sha + ':' + blob.type
    assets.set(sha, blob)
    converted.set(url, result)
    return result
  })
  return {
    document,
    assets,
    hash: await digest(new Blob([canonical(document)])),
  }
}

function dataURI(bytes: Uint8Array, type: string) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return 'data:' + type + ';base64,' + btoa(binary)
}

export async function unpackWorking(
  meta: WorkingMeta,
  source: WorkingDocument,
  resource: (sha: string) => Promise<Blob>
) {
  if (meta.hash && meta.hash !== (await digest(new Blob([canonical(source)]))))
    throw Error('Контрольная сумма облачного документа не совпадает.')
  const document = meta.hash
    ? structuredClone(source)
    : validate(meta.kind, source)
  const converted = new Map<string, Uint8Array>()
  await replaceResources(workingDeck(document), async (value, font) => {
    if (!value.startsWith('atlas-resource:')) return value
    const match = pointer.exec(value)
    if (
      !match ||
      (font ? match[2] !== 'font/' + font : !match[2].startsWith('image/'))
    )
      throw Error('Некорректная ссылка на приватный ресурс.')
    const [, sha, type] = match
    let bytes = converted.get(sha)
    if (!bytes) {
      const blob = await resource(sha)
      if ((await digest(blob)) !== sha)
        throw Error('Контрольная сумма приватного ресурса не совпадает.')
      bytes = new Uint8Array(await blob.arrayBuffer())
      converted.set(sha, bytes)
    }
    const url = dataURI(bytes, type)
    return font ? url.slice(url.indexOf(',') + 1) : url
  })
  const result = validate(meta.kind, document)
  if (workingDeck(result).id.toLowerCase() !== meta.id)
    throw Error('Идентификатор облачного документа не совпадает.')
  return result
}
export type StoredWorkingDocument = {
  document: WorkingDocument
  hash: string
  refs: string[]
}

export async function packLocalDocument(
  kind: WorkingKind,
  document: WorkingDocument
) {
  const packed = await packWorking(kind, document)

  return {
    stored: {
      document: packed.document,
      hash: packed.hash,
      refs: [...packed.assets.keys()],
    },
    assets: packed.assets,
  }
}

export async function unpackLocalDocument(
  kind: WorkingKind,
  id: string,
  stored: StoredWorkingDocument,
  resource: (sha: string) => Promise<Blob>
) {
  const meta: WorkingMeta = {
    id: id.toLowerCase(),
    kind,
    title: workingDeck(stored.document).title,
    slides: workingDeck(stored.document).slides.length,
    templateKind: 'deck' in stored.document ? stored.document.kind : null,
    templateFormat: null,
    revision: 0,
    hash: stored.hash,
    updated: '',
    deleted: null,
    restorable: false,
  }

  return unpackWorking(meta, stored.document, resource)
}
