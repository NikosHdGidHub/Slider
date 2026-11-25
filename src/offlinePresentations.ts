import type { Deck } from './model'
import { validateDeck } from './model'

const CACHE_NAME = 'atlas-offline-presentations-v1'

function cacheRequest(id: string) {
  return new Request(
    new URL(
      './offline-presentation/' + encodeURIComponent(id),
      document.baseURI
    ).href
  )
}

export async function saveOfflinePresentation(deck: Deck) {
  if (!('caches' in window)) {
    throw new Error('Браузер не поддерживает офлайн-хранение.')
  }

  const cache = await caches.open(CACHE_NAME)

  await cache.put(
    cacheRequest(deck.id),
    new Response(JSON.stringify(deck), {
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

export async function readOfflinePresentation(
  id: string
): Promise<Deck | null> {
  if (!('caches' in window)) return null

  const cache = await caches.open(CACHE_NAME)
  const response = await cache.match(cacheRequest(id))

  if (!response) return null

  const deck = validateDeck(await response.json())

  if (deck.id.toLowerCase() !== id.toLowerCase()) {
    throw new Error('Идентификатор офлайн-копии не совпадает.')
  }

  return deck
}
