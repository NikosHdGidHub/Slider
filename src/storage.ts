import { validateTemplate, type Template } from './catalog'
import { validateDeck, type Deck } from './model'
import type { PublishedRow } from './publicationCatalog'
import { FORMAT_VERSION } from './schema'
import {
  appendCourseCommands,
  emptyCourseRecord,
  moveCommand,
  visibleCourses,
  type CourseRecord,
} from './courseModel'

import {
  workingDeck,
  type WorkingDocument,
  type WorkingKind,
  type WorkingRecord,
  type WorkingMeta,
} from './workingDocument'

export type Entry = {
  deck: Deck
  updated: number
  revision: number
  scope?: string
}
let workingOwner: string | null = null
export function setWorkingOwner(owner: string | null) {
  workingOwner = owner
}
export function currentWorkingOwner() {
  return workingOwner
}
const workingChanges = new EventTarget()
const workingChannel =
  typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('atlas-working-sync')
    : undefined
if (workingChannel)
  workingChannel.onmessage = ({ data }) => {
    if (typeof data === 'string') workingChanges.dispatchEvent(new Event(data))
  }
function reportWorkingChange(owner: string | null, notify = true) {
  if (!owner) return
  workingChanges.dispatchEvent(new Event(owner))
  if (notify) workingChannel?.postMessage(owner)
}
export function listenWorkingChanges(owner: string, callback: () => void) {
  workingChanges.addEventListener(owner, callback)
  return () => workingChanges.removeEventListener(owner, callback)
}
const docKey = (owner: string, kind: WorkingKind, id: string) => [
  owner,
  kind,
  id.toLowerCase(),
]
const ownerRange = (owner: string) => IDBKeyRange.bound([owner], [owner, []])
const belongs = (
  record: { scope?: string } | undefined,
  owner: string | null
) => !record?.scope || record.scope === owner

const opened = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('atlas-lessons-v1', 5)
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
    for (const name of [
      'workingState',
      'workingAssets',
      'workingBackups',
      'publicCatalog',
    ])
      if (!request.result.objectStoreNames.contains(name))
        request.result.createObjectStore(name)
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
  const owner = workingOwner
  const db = await opened
  return new Promise<T[]>((resolve, reject) => {
    const query = db.transaction(store).objectStore(store).getAll()
    query.onsuccess = () => {
      const failures: UnreadableDocument[] = []
      const rows: T[] = []
      for (const record of query.result) {
        if (!belongs(record, owner)) continue
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
  placement?: { scope: string; course: string },
  deleteCloud = false,
  owner = workingOwner
) {
  if (!remove) validateDeck(deck)
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const stores = ['lessons', 'originalDocuments', 'workingState']
    if (placement) stores.push('libraryCourses')
    const tx = db.transaction(stores, 'readwrite'),
      store = tx.objectStore('lessons')
    const read = store.get(deck.id)
    read.onsuccess = () => {
      if (
        !belongs(read.result, owner) ||
        (read.result?.revision ?? 0) !== revision
      ) {
        reject(
          new Error(
            'Версия на диске изменилась. Экспортируйте текущую работу и откройте библиотеку заново.'
          )
        )
        tx.abort()
        return
      }
      if (owner && (!remove || deleteCloud))
        enqueueWorking(tx, owner, 'lesson', deck, remove)
      if (remove) {
        store.delete(deck.id)
        if (owner && !deleteCloud)
          dropWorkingCache(tx, owner, 'lesson', deck.id)
      } else {
        const previous = read.result?.deck
        if (previous) storeOriginal(tx, 'lesson', deck.id, previous)
        if (backupBeforeSync && previous) {
          const backup = {
            ...previous,
            id: crypto.randomUUID(),
            title: previous.title.slice(0, 970) + ' — до синхронизации',
          }
          store.add({
            deck: backup,
            revision: 1,
            updated: Date.now(),
            scope: owner ?? undefined,
          })
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
          store.add({
            deck: backup,
            revision: 1,
            updated: Date.now(),
            scope: owner ?? undefined,
          })
        }
        store.put({
          deck,
          revision: revision + 1,
          updated: Date.now(),
          scope: owner ?? undefined,
        })
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
      reportWorkingChange(owner)
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
  scope?: string
}
export function localTemplates() {
  return listDocuments<TemplateEntry>('template', 'templates', (entry) => ({
    ...entry,
    template: validateTemplate(entry.template),
  }))
}
export async function writeTemplate(entry: TemplateEntry, remove = false) {
  const owner = workingOwner
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
        ['templates', 'originalDocuments', 'workingState'],
        'readwrite'
      ),
      store = tx.objectStore('templates'),
      id = entry.template.deck.id
    const q = store.get(id)
    q.onsuccess = () => {
      if (
        !belongs(q.result, owner) ||
        (q.result?.revision ?? 0) !== entry.revision
      ) {
        reject(
          new Error(
            'Шаблон изменился в другой вкладке. Откройте библиотеку заново.'
          )
        )
        tx.abort()
        return
      }
      if (owner && (entry.dirty || remove))
        enqueueWorking(tx, owner, 'template', entry.template, remove)
      if (remove) store.delete(id)
      else {
        if (q.result?.template)
          storeOriginal(tx, 'template', id, q.result.template)
        store.put({
          ...entry,
          revision: entry.revision + 1,
          scope: owner ?? undefined,
        })
      }
    }
    tx.oncomplete = () => {
      reportWorkingChange(owner)
      resolve()
    }
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

function dropWorkingCache(
  tx: IDBTransaction,
  owner: string,
  kind: WorkingKind,
  id: string
) {
  const store = tx.objectStore('workingState')
  const key = docKey(owner, kind, id)
  const read = store.get(key)
  read.onsuccess = () => {
    // The device-only action must never discard an unconfirmed edit.
    if (read.result?.dirty) tx.abort()
    else if (read.result) store.put({ ...read.result, localId: undefined }, key)
  }
}

function enqueueWorking(
  tx: IDBTransaction,
  owner: string,
  kind: WorkingKind,
  document: WorkingDocument,
  deleted: boolean
) {
  const store = tx.objectStore('workingState')
  const id = workingDeck(document).id.toLowerCase()
  const key = docKey(owner, kind, id)
  const read = store.get(key)
  read.onsuccess = () => {
    const before: WorkingRecord | undefined = read.result
    const next: WorkingRecord = {
      ...before,
      kind,
      id,
      localId: workingDeck(document).id,
      dirty: true,
      deleted,
      title: workingDeck(document).title,
      templateKind: 'deck' in document ? document.kind : undefined,
      localUpdated: Date.now(),
      localSlides: workingDeck(document).slides.length,
      base: before ? before.base : null,
      generation: (before?.generation ?? 0) + 1,
      previous: deleted ? document : undefined,
    }
    store.put(next, key)
  }
}

export async function registerWorking(owner: string) {
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      ['lessons', 'templates', 'workingState', 'workingBackups'],
      'readwrite'
    )
    const state = tx.objectStore('workingState')
    for (const kind of ['lesson', 'template'] as const) {
      const collection = tx.objectStore(
        kind === 'lesson' ? 'lessons' : 'templates'
      )
      const documents = collection.getAll()
      documents.onsuccess = () => {
        for (const existing of documents.result) {
          if (!belongs(existing, owner)) continue
          const source = kind === 'lesson' ? existing.deck : existing.template
          let document: WorkingDocument
          try {
            document =
              kind === 'lesson'
                ? validateDeck(source)
                : validateTemplate(source)
          } catch {
            continue
          }
          const id = workingDeck(document).id.toLowerCase()
          const key = docKey(owner, kind, id)
          const read = state.get(key)
          read.onsuccess = () => {
            if (read.result && existing.scope) return
            if (!existing.scope) collection.put({ ...existing, scope: owner })
            if (read.result?.dirty) return
            const previous: WorkingRecord = {
              id,
              kind,
              localId: workingDeck(document).id,
              title: workingDeck(document).title,
              templateKind: 'deck' in document ? document.kind : undefined,
              localUpdated: existing.updated,
              localSlides: workingDeck(document).slides.length,
              base: existing.cloudRevision || null,
              generation: 1,
              dirty: true,
              deleted: false,
            }
            state.put(previous, key)
          }
        }
      }
    }
    const backups = tx
      .objectStore('workingBackups')
      .openCursor(ownerRange(owner))
    backups.onsuccess = () => {
      const cursor = backups.result
      if (!cursor) return
      if (cursor.value.until < Date.now()) cursor.delete()
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(tx.error ?? Error('Не удалось подготовить локальную библиотеку.'))
  })
}

export async function addWorkingMetadata(owner: string, rows: WorkingRecord[]) {
  if (!rows.length) return
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('workingState', 'readwrite')
    const store = tx.objectStore('workingState')
    for (const row of rows) {
      const key = docKey(owner, row.kind, row.id)
      const read = store.getKey(key)
      read.onsuccess = () => {
        if (read.result === undefined) store.add(row, key)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(tx.error ?? Error('Не удалось сохранить каталог черновиков.'))
  })
}

export async function workingRecords(owner: string): Promise<WorkingRecord[]> {
  const db = await opened
  return new Promise((resolve, reject) => {
    const read = db
      .transaction('workingState')
      .objectStore('workingState')
      .getAll(ownerRange(owner))
    read.onsuccess = () => resolve(read.result)
    read.onerror = () => reject(read.error)
  })
}

export async function localWorkingDocument(
  owner: string,
  state: WorkingRecord
): Promise<WorkingDocument | undefined> {
  if (state.deleted) return state.previous
  const db = await opened
  return new Promise((resolve, reject) => {
    const table = state.kind === 'lesson' ? 'lessons' : 'templates'
    const read = db
      .transaction(table)
      .objectStore(table)
      .get(state.localId ?? state.id)
    read.onsuccess = () => {
      const row = read.result
      if (!row || !belongs(row, owner)) return resolve(undefined)
      try {
        resolve(
          row.deck ? validateDeck(row.deck) : validateTemplate(row.template)
        )
      } catch (error) {
        reject(error)
      }
    }
    read.onerror = () => reject(read.error)
  })
}

export async function updateWorking(
  owner: string,
  kind: WorkingKind,
  id: string,
  update: (before: WorkingRecord | undefined) => WorkingRecord | undefined,
  replacement?: {
    document?: WorkingDocument
    backup?: WorkingDocument
    original?: unknown
    preserve?: boolean
    copy?: WorkingDocument
  }
) {
  const db = await opened
  return new Promise<boolean>((resolve, reject) => {
    const table = kind === 'lesson' ? 'lessons' : 'templates'
    const tx = db.transaction(
      ['workingState', table, 'workingBackups', 'originalDocuments'],
      'readwrite'
    )
    const state = tx.objectStore('workingState')
    const key = docKey(owner, kind, id)
    let changed = false
    const read = state.get(key)
    read.onsuccess = () => {
      let next: WorkingRecord | undefined
      try {
        next = update(read.result)
      } catch (error) {
        reject(error)
        tx.abort()
        return
      }
      if (!next || next === read.result) return
      state.put(next, key)
      changed = true
      if (!replacement) return
      const documents = tx.objectStore(table)
      const document = replacement.document
      const docId =
        read.result?.localId ?? (document ? workingDeck(document).id : id)
      const previous = documents.get(docId)
      previous.onsuccess = () => {
        if (!belongs(previous.result, owner)) {
          tx.abort()
          return
        }
        if (replacement.backup)
          tx.objectStore('workingBackups').put(
            { document: replacement.backup, until: Date.now() + 7 * 86400000 },
            [...key, crypto.randomUUID()]
          )
        if (replacement.copy) {
          const copy = replacement.copy
          const data =
            'deck' in copy
              ? { template: copy, cloudRevision: 0, dirty: true }
              : { deck: copy, updated: Date.now() }
          documents.add({ ...data, scope: owner, revision: 1 })
          enqueueWorking(tx, owner, kind, copy, false)
        }
        if (replacement.preserve) return
        if (replacement.original)
          storeOriginal(tx, kind, id, replacement.original)
        if (!document) {
          documents.delete(docId)
          return
        }
        if (docId !== workingDeck(document).id) documents.delete(docId)
        const data =
          'deck' in document
            ? {
                template: document,
                cloudRevision: next.base,
                dirty: next.dirty,
              }
            : {
                deck: document,
                updated: new Date(next.meta?.updated ?? Date.now()).getTime(),
              }
        documents.put({
          ...data,
          scope: owner,
          revision: (previous.result?.revision ?? 0) + 1,
        })
      }
    }
    tx.oncomplete = () => resolve(changed)
    tx.onabort = () =>
      reject(
        tx.error ?? Error('Локальная копия изменилась. Повторите попытку.')
      )
  })
}

type Asset = { blob: Blob; uploaded: boolean }
export async function workingAsset(
  owner: string,
  sha: string,
  write?: Asset
): Promise<Asset | undefined> {
  const db = await opened
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workingAssets', write ? 'readwrite' : 'readonly')
    const store = tx.objectStore('workingAssets')
    const key = [owner, sha]
    const request = store.get(key)
    request.onsuccess = () => {
      if (
        write &&
        (!request.result || (write.uploaded && !request.result.uploaded))
      )
        store.put(write, key)
    }
    tx.oncomplete = () => resolve(write ?? request.result)
    tx.onabort = () =>
      reject(tx.error ?? Error('Не удалось сохранить приватный ресурс.'))
  })
}

export async function workingBackups(owner: string) {
  const db = await opened
  return new Promise<{ document: WorkingDocument; until: number }[]>(
    (resolve, reject) => {
      const q = db
        .transaction('workingBackups')
        .objectStore('workingBackups')
        .getAll(ownerRange(owner))
      q.onsuccess = () =>
        resolve(q.result.filter((row) => row.until > Date.now()))
      q.onerror = () => reject(q.error)
    }
  )
}

export async function savedPublicCatalog(
  owner: string,
  write?: PublishedRow[]
) {
  const db = await opened
  return new Promise<PublishedRow[]>((resolve, reject) => {
    const tx = db.transaction('publicCatalog', write ? 'readwrite' : 'readonly')
    const store = tx.objectStore('publicCatalog')
    const req = write ? store.put(write, owner) : store.get(owner)
    tx.oncomplete = () => resolve(write ?? req.result ?? [])
    tx.onabort = () =>
      reject(tx.error ?? Error('Не удалось открыть каталог на устройстве.'))
  })
}
