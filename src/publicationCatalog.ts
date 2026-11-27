import { client, listPublishedFiles, readPublic } from './cloud'
import { validateDeck, type Deck } from './model'

export type PublishedRow = {
  id: string
  updated: string
  title: string | null
  slides: number | null
  thumbnail: string | null
  indexed: boolean
}

export async function publicationCatalog(owner: string, signal?: AbortSignal): Promise<PublishedRow[]> {
  if (!client) return []
  const query = client.rpc('atlas_publication_catalog', { expected_owner: owner })
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (!error) return data
  if (error.code !== 'PGRST202' && error.code !== '42883') throw Error(error.message)
  // A deployment can read existing public links before the catalog migration.
  return (await listPublishedFiles(signal)).map(({ id, updated }) => ({
    id, updated: new Date(updated || 0).toISOString(), title: null, slides: null,
    thumbnail: null, indexed: false,
  }))
}

export async function publicationDocument(id: string, signal?: AbortSignal) {
  const document = validateDeck(await readPublic(id, signal))
  if (document.id.toLowerCase() !== id) throw Error('Идентификатор публикации не совпадает.')
  return document
}

export async function recordPublication(owner: string, deck: Deck, updated: string | null) {
  if (!client) throw Error('Облако не настроено.')
  const first = deck.slides[0]
  const thumbnail = first.background || first.items.find((item) => item.type === 'image' && !item.hidden)?.src
  const { data, error } = await client.rpc('atlas_publication_record', {
    expected_owner: owner, doc_id: deck.id, version_updated: updated, doc_title: deck.title,
    slides: deck.slides.length, thumbnail_url: thumbnail?.startsWith('https:') ? thumbnail : null,
  })
  if (error || !data) throw Error(error?.message ?? 'Публикация изменилась во время индексирования.')
}

export async function indexPublications(owner: string, rows: PublishedRow[], progress: (checked: number) => void) {
  let checked = 0
  const failures: string[] = []
  for (const row of rows) {
    if (row.indexed) continue
    try {
      await recordPublication(owner, await publicationDocument(row.id), row.updated)
    } catch {
      failures.push(row.id)
    }
    progress(++checked)
  }
  return failures
}
