import { validateTemplate, type Template } from './catalog'
import { validateDeck, type Deck } from './model'
import { FORMAT_VERSION } from './schema'
import {
  appendCourseCommands,
  emptyCourseRecord,
  moveCommand,
  visibleCourses,
  type CourseRecord,
} from './courseModel'

export type Entry = { deck: Deck; updated: number; revision: number }
const opened = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('atlas-lessons-v1', 4)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('lessons'))
      request.result.createObjectStore('lessons', { keyPath: 'deck.id' })
    if (!request.result.objectStoreNames.contains('images'))
      request.result.createObjectStore('images')
    if (!request.result.objectStoreNames.contains('templates'))
      request.result.createObjectStore('templates', {
        keyPath: 'template.deck.id',
      })
    if (!request.result.objectStoreNames.contains('originalDocuments'))
      request.result.createObjectStore('originalDocuments')
    if (!request.result.objectStoreNames.contains('libraryCourses'))
      request.result.createObjectStore('libraryCourses')
  }
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close()
    resolve(request.result)
  }
  request.onerror = () => reject(request.error)
  request.onblocked = () =>
    reject(
      Error('Закройте вкладки прежней версии Атласа и перезагрузите страницу.')
    )
})
type OriginalKind = 'lesson' | 'template'
function originalVersion(document: unknown) {
  if (!document || typeof document !== 'object') return undefined
  if ('deck' in document) return originalVersion(document.deck)
  return 'version' in document && typeof document.version === 'number'
    ? document.version
    : undefined
}
function storeOriginal(
  tx: IDBTransaction,
  kind: OriginalKind,
  id: string,
  source: unknown
) {
  const version = originalVersion(source)
  if (version === undefined || version >= FORMAT_VERSION) return
  const key = kind + ':' + id
  const store = tx.objectStore('originalDocuments')
  const exists = store.getKey(key)
  exists.onsuccess = () => {
    if (exists.result === undefined) store.add(source, key)
  }
}
export async function saveOriginal(
  kind: OriginalKind,
  id: string,
  source: unknown
) {
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('originalDocuments', 'readwrite')
    storeOriginal(tx, kind, id, source)
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(tx.error ?? new Error('Не удалось сохранить исходный JSON.'))
  })
}
export async function originalDocument(kind: OriginalKind, id: string) {
  const db = await opened
  return new Promise<unknown>((resolve, reject) => {
    const current = db
      .transaction('originalDocuments')
      .objectStore('originalDocuments')
      .get(kind + ':' + id)
    current.onsuccess = () => resolve(current.result)
    current.onerror = () => reject(current.error)
  })
}
export async function originalIds(kind: OriginalKind) {
  const db = await opened
  return new Promise<Set<string>>((resolve, reject) => {
    const query = db
      .transaction('originalDocuments')
      .objectStore('originalDocuments')
      .getAllKeys(IDBKeyRange.bound(kind + ':', kind + ';', false, true))
    query.onsuccess = () =>
      resolve(
        new Set(query.result.map((key) => String(key).slice(kind.length + 1)))
      )
    query.onerror = () => reject(query.error)
  })
}

export interface UnreadableDocument {
  title: string
  message: string
  source: unknown
}
const unreadable: Record<OriginalKind, UnreadableDocument[]> = {
  lesson: [],
  template: [],
}
export function unreadableDocuments(kind: OriginalKind) {
  return unreadable[kind]
}

async function listDocuments<T>(
  kind: OriginalKind,
  store: 'lessons' | 'templates',
  read: (record: T) => T
) {
  const db = await opened
  return new Promise<T[]>((resolve, reject) => {
    const query = db.transaction(store).objectStore(store).getAll()
    query.onsuccess = () => {
      const failures: UnreadableDocument[] = []
      const rows: T[] = []
      for (const record of query.result) {
        try {
          rows.push(read(record))
        } catch (error) {
          const source = record.template ?? record.deck
          failures.push({
            title: source?.title ?? source?.deck?.title ?? 'Документ',
            message:
              error instanceof Error
                ? error.message
                : 'Ошибка чтения документа.',
            source,
          })
        }
      }
      unreadable[kind] = failures
      resolve(rows)
    }
    query.onerror = () => reject(query.error)
  })
}

export async function entries(): Promise<Entry[]> {
  const rows = await listDocuments<Entry>('lesson', 'lessons', (entry) => ({
    ...entry,
    deck: validateDeck(entry.deck),
  }))
  return rows.sort((a, b) => b.updated - a.updated)
}
export async function saveEntry(
  deck: Deck,
  revision: number,
  remove = false,
  backupBeforeSync = false,
  placement?: { scope: string; course: string }
) {
  if (!remove) validateDeck(deck)
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const stores = ['lessons', 'originalDocuments']
    if (placement) stores.push('libraryCourses')
    const tx = db.transaction(stores, 'readwrite'),
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
        if (previous) storeOriginal(tx, 'lesson', deck.id, previous)
        if (backupBeforeSync && previous) {
          const backup = {
            ...previous,
            id: crypto.randomUUID(),
            title: previous.title.slice(0, 970) + ' — до синхронизации',
          }
          store.add({ deck: backup, revision: 1, updated: Date.now() })
        } else if (
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
        if (placement) {
          writeCourseRecord(
            tx,
            placement.scope,
            (record) =>
              appendCourseCommands(
                record,
                [
                  moveCommand(
                    visibleCourses(record),
                    [deck.id.toLowerCase()],
                    placement.course
                  ),
                ],
                placement.scope !== 'local'
              ),
            reject
          )
        }
      }
    }
    tx.oncomplete = () => {
      if (placement) reportCourseChange(placement.scope)
      resolve()
    }
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
export function localTemplates() {
  return listDocuments<TemplateEntry>('template', 'templates', (entry) => ({
    ...entry,
    template: validateTemplate(entry.template),
  }))
}
export async function writeTemplate(entry: TemplateEntry, remove = false) {
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['templates', 'originalDocuments'], 'readwrite'),
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
      else {
        if (q.result?.template)
          storeOriginal(tx, 'template', id, q.result.template)
        store.put({ ...entry, revision: entry.revision + 1 })
      }
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Запись шаблона прервана.'))
  })
}

// Offline integrity metadata shares the technical image store with upload receipts.
export async function rememberImage(hash: string, source: string) {
  if (!source.startsWith('data:'))
    await imageAddress('offline-url:' + hash, source)
  return imageAddress(
    'offline:' + hash,
    source.startsWith('data:') ? 'embedded' : source
  )
}

const courseEvents = new EventTarget()
const courseChannel =
  typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('atlas-library-courses-v1')
    : undefined
if (courseChannel)
  courseChannel.onmessage = (event) => {
    if (typeof event.data === 'string')
      courseEvents.dispatchEvent(new Event(event.data))
  }
function reportCourseChange(scope: string) {
  courseEvents.dispatchEvent(new Event(scope))
  courseChannel?.postMessage(scope)
}
export function listenCourseChanges(scope: string, listener: () => void) {
  courseEvents.addEventListener(scope, listener)
  return () => courseEvents.removeEventListener(scope, listener)
}
function writeCourseRecord(
  tx: IDBTransaction,
  scope: string,
  update: (record: CourseRecord) => CourseRecord,
  reject: (error: unknown) => void
) {
  const store = tx.objectStore('libraryCourses')
  const request = store.get(scope)
  let changed = false
  request.onsuccess = () => {
    try {
      const before: CourseRecord = request.result ?? emptyCourseRecord()
      const after = update(before)
      if (after === before) return
      store.put(after, scope)
      changed = true
    } catch (error) {
      reject(error)
      tx.abort()
    }
  }
  return () => changed
}
export async function readCourseRecord(scope: string): Promise<CourseRecord> {
  const db = await opened
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('libraryCourses')
      .objectStore('libraryCourses')
      .get(scope)
    request.onsuccess = () => resolve(request.result ?? emptyCourseRecord())
    request.onerror = () => reject(request.error)
  })
}
export async function updateCourseRecord(
  scope: string,
  update: (record: CourseRecord) => CourseRecord
) {
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('libraryCourses', 'readwrite')
    const changed = writeCourseRecord(tx, scope, update, reject)
    tx.oncomplete = () => {
      if (changed()) reportCourseChange(scope)
      resolve()
    }
    tx.onabort = () =>
      reject(
        tx.error ??
          Error('Не удалось сохранить структуру курсов на устройстве.')
      )
  })
}
