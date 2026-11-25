import { validateTemplate, type Template } from './catalog'
import { validateDeck, type Deck } from './model'

export type Entry = { deck: Deck; updated: number; revision: number }
const opened = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('atlas-lessons-v1', 2)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('lessons'))
      request.result.createObjectStore('lessons', { keyPath: 'deck.id' })
    if (!request.result.objectStoreNames.contains('images'))
      request.result.createObjectStore('images')
    request.result.createObjectStore('templates', {
      keyPath: 'template.deck.id',
    })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
export async function entries(): Promise<Entry[]> {
  const db = await opened
  return new Promise((resolve, reject) => {
    const q = db.transaction('lessons').objectStore('lessons').getAll()
    q.onsuccess = () => {
      try {
        resolve(
          q.result
            .map((e: Entry) => ({ ...e, deck: validateDeck(e.deck) }))
            .sort((a: Entry, b: Entry) => b.updated - a.updated)
        )
      } catch (e) {
        reject(e)
      }
    }
    q.onerror = () => reject(q.error)
  })
}
export async function saveEntry(deck: Deck, revision: number, remove = false) {
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('lessons', 'readwrite'),
      store = tx.objectStore('lessons')
    const read = store.get(deck.id)
    read.onsuccess = () => {
      if ((read.result?.revision ?? 0) !== revision) {
        reject(
          new Error(
            'Версия на диске изменилась. Экспортируйте текущую работу и откройте библиотеку заново.'
          )
        )
        tx.abort()
      } else if (remove) store.delete(deck.id)
      else {
        const previous = read.result?.deck
        if (
          deck.migrated === false &&
          previous &&
          (previous.version < 3 || previous.migrated)
        ) {
          const backup = {
            ...previous,
            id: crypto.randomUUID(),
            title: previous.title.slice(0, 990) + ' — до смены шаблона',
          }
          store.add({ deck: backup, revision: 1, updated: Date.now() })
        }
        store.put({ deck, revision: revision + 1, updated: Date.now() })
      }
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(tx.error || new Error('Запись в браузер прервана.'))
  })
}
export async function imageAddress(
  key: string,
  url?: string
): Promise<string | undefined> {
  const db = await opened
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', url ? 'readwrite' : 'readonly')
    const store = tx.objectStore('images')
    const req = url ? store.put(url, key) : store.get(key)
    tx.oncomplete = () => resolve(url || req.result)
    tx.onabort = () => reject(tx.error)
  })
}
export interface TemplateEntry {
  template: Template
  revision: number
  cloudRevision: number
  dirty: boolean
}
export async function localTemplates(): Promise<TemplateEntry[]> {
  const db = await opened
  return new Promise((resolve, reject) => {
    const q = db.transaction('templates').objectStore('templates').getAll()
    q.onsuccess = () => {
      try {
        resolve(
          q.result.map((e: TemplateEntry) => ({
            ...e,
            template: validateTemplate(e.template),
          }))
        )
      } catch (err) {
        reject(err)
      }
    }
    q.onerror = () => reject(q.error)
  })
}
export async function writeTemplate(entry: TemplateEntry, remove = false) {
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('templates', 'readwrite'),
      store = tx.objectStore('templates'),
      id = entry.template.deck.id
    const q = store.get(id)
    q.onsuccess = () => {
      if ((q.result?.revision ?? 0) !== entry.revision) {
        reject(
          new Error(
            'Шаблон изменился в другой вкладке. Откройте библиотеку заново.'
          )
        )
        tx.abort()
        return
      }
      if (remove) store.delete(id)
      else store.put({ ...entry, revision: entry.revision + 1 })
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Запись шаблона прервана.'))
  })
}
