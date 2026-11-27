import {
  adminId,
  client,
  listPublished,
  readPublishedForInventory,
  withStorageLock,
} from './cloud'
import { mediaSlides } from './grid'
import {
  entries,
  localTemplates,
  workingBackups,
  workingRecords,
} from './storage'
import { workingDeck } from './workingDocument'
import { validateDeck, type Deck } from './model'
import { purgeFile, resourceKey, type Resource } from './resources'

export function* imageSources(deck: Deck) {
  for (const slide of mediaSlides(deck)) {
    if (slide.background) yield slide.background
    for (const item of slide.items) if (item.type === 'image') yield item.src
  }
}

export function storageReference(src: string) {
  if (!src.startsWith('https:')) return
  const path = new URL(src).pathname
  const match =
    /^\/storage\/v1\/(?:object|render\/image)\/(?:(?:public|authenticated|sign)\/)?(images|atlas-private)\/(.+)$/.exec(
      path
    )
  if (match) return match[1] + '/' + decodeURIComponent(match[2])
}

type Publication = { id: string; title: string }
export async function publicationUsage() {
  const usage = new Map<string, Publication[]>()
  for (const id of await listPublished()) {
    const deck = validateDeck(await readPublishedForInventory(id))
    if (deck.id !== id) throw Error('Идентификатор публикации не совпадает.')
    const uses = new Set(Array.from(imageSources(deck), storageReference))
    for (const key of uses) {
      if (!key) continue
      const list = usage.get(key) ?? []
      list.push({ id, title: deck.title })
      usage.set(key, list)
    }
  }
  return usage
}

export function removeUnusedFile(row: Resource) {
  if (row.bucket === 'atlas-private-resources') {
    throw Error('Удаление приватных ресурсов ' + 'пока недоступно.')
  }
  return withStorageLock(async (bucket) => {
    const usage = await publicationUsage()
    if (usage.has(resourceKey(row)))
      throw Error(
        'Файл используется в публикациях. Сначала обновите или снимите их.'
      )
    const references = await client!.rpc('atlas_working_resource_urls', {
      expected_owner: adminId,
    })
    if (references.error || !Array.isArray(references.data)) {
      throw Error(
        'Не удалось проверить использование ' +
          'файла в облачных документах. ' +
          'Удаление отменено.'
      )
    }
    const [lessons, templates, backups, pending] = await Promise.all([
      entries(),
      localTemplates(),
      workingBackups(adminId),
      workingRecords(adminId),
    ])
    const local = [
      ...lessons.map(({ deck }) => deck),
      ...templates.map(({ template }) => template.deck),
      ...backups.map(({ document }) => workingDeck(document)),
      ...pending.flatMap(({ previous }) =>
        previous ? [workingDeck(previous)] : []
      ),
    ]
    if (
      (references.data as string[] | null)?.some(
        (url) => storageReference(url) === resourceKey(row)
      ) ||
      local.some((deck) =>
        Array.from(imageSources(deck)).some(
          (url) => storageReference(url) === resourceKey(row)
        )
      )
    )
      throw Error('Файл используется в облачном черновике или шаблоне.')
    await purgeFile(row, bucket)
  })
}
