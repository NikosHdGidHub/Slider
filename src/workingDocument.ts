import { validateTemplate, type Template } from './catalog.ts'
import { digest } from './digest.ts'
import { mediaSlides } from './grid.ts'
import { validateDeck, type Deck } from './model.ts'

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
  deleted: boolean
  previous?: WorkingDocument
  conflict?: WorkingMeta
  attempt?: WorkingAttempt
  meta?: WorkingMeta
}

const pointer = /^atlas-resource:([0-9a-f]{64}):(image\/(?:png|jpeg|webp)|font\/(?:woff2|woff|ttf|otf))$/

export function workingDeck(document: WorkingDocument) {
  return 'deck' in document ? document.deck : document
}
function validate(kind: WorkingKind, document: unknown) {
  return kind === 'template' ? validateTemplate(document) : validateDeck(document)
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    current && typeof current === 'object' && !Array.isArray(current)
      ? Object.fromEntries(Object.keys(current).sort().map((key) => [key, current[key]]))
      : current
  )
}

async function replaceResources(deck: Deck, transform: (source: string, font?: string) => Promise<string>) {
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
    if (!url.startsWith('data:')) return source
    const known = converted.get(url)
    if (known) return known
    const blob = await (await fetch(url)).blob()
    const sha = await digest(blob)
    const result = 'atlas-resource:' + sha + ':' + blob.type
    assets.set(sha, blob)
    converted.set(url, result)
    return result
  })
  return { document, assets, hash: await digest(new Blob([canonical(document)])) }
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
  if (meta.hash && !meta.deleted && meta.hash !== await digest(new Blob([canonical(source)])))
    throw Error('Контрольная сумма облачного документа не совпадает.')
  const document = structuredClone(source)
  const converted = new Map<string, Uint8Array>()
  await replaceResources(workingDeck(document), async (value, font) => {
    if (!value.startsWith('atlas-resource:')) return value
    const match = pointer.exec(value)
    if (!match || (font ? match[2] !== 'font/' + font : !match[2].startsWith('image/')))
      throw Error('Некорректная ссылка на приватный ресурс.')
    const [, sha, type] = match
    let bytes = converted.get(sha)
    if (!bytes) {
      const blob = await resource(sha)
      if (await digest(blob) !== sha) throw Error('Контрольная сумма приватного ресурса не совпадает.')
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
