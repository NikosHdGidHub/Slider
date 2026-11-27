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
  packLocalDocument,
  unpackLocalDocument,
  workingDeck,
  type StoredWorkingDocument,
  type WorkingDocument,
  type WorkingKind,
  type WorkingRecord,
} from './workingDocument'
import { prepareDocumentImages } from './media'
import { mediaSlides } from './grid'
import { digest } from './digest'

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
export function assetScope(owner: string | null): string {
  return owner ?? 'local'
}
type StoredDocumentRow = {
  packed?: StoredWorkingDocument
  deck?: unknown
  template?: unknown
  scope?: string
}

async function restoreStoredDocument(
  kind: WorkingKind,
  record: StoredDocumentRow,
  owner: string | null
): Promise<WorkingDocument> {
  if (!belongs(record, owner))
    throw Error('Документ принадлежит другому аккаунту.')
  if (!record.packed) {
    return kind === 'lesson'
      ? validateDeck(record.deck)
      : validateTemplate(record.template)
  }

  const id = workingDeck(record.packed.document).id

  return unpackLocalDocument(kind, id, record.packed, async (sha) => {
    const asset = await workingAsset(assetScope(record.scope ?? null), sha)

    if (!asset) throw Error('Отсутствует локальный ресурс: ' + sha.slice(0, 12))

    return asset.blob
  })
}
async function prepareStoredDocument(document: WorkingDocument) {
  const kind: WorkingKind = 'deck' in document ? 'template' : 'lesson'

  const prepared =
    'deck' in document
      ? validateTemplate({
          ...document,
          deck: await prepareDocumentImages(document.deck),
        })
      : await prepareDocumentImages(document)

  return packLocalDocument(kind, prepared)
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
  const request = indexedDB.open('atlas-lessons-v1', 6)
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
      'lessons',
      'templates',
      'workingState',
      'workingBackups',
      'workingAssets',
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
  read: (record: T) => T | Promise<T>
) {
  const owner = workingOwner
  const db = await opened

  const records = await new Promise<any[]>((resolve, reject) => {
    const query = db.transaction(store).objectStore(store).getAll()

    query.onsuccess = () => resolve(query.result)

    query.onerror = () => reject(query.error)
  })

  const failures: UnreadableDocument[] = []
  const rows: T[] = []

  for (const record of records) {
    if (!belongs(record, owner)) continue

    try {
      rows.push(await read(record))
    } catch (error) {
      const source = record.packed?.document ?? record.template ?? record.deck

      failures.push({
        title: source?.title ?? source?.deck?.title ?? 'Документ',

        message:
          error instanceof Error ? error.message : 'Ошибка чтения документа.',

        source,
      })
    }
  }

  unreadable[kind] = failures

  return rows
}

export async function entries(): Promise<Entry[]> {
  const owner = workingOwner

  const rows = await listDocuments<Entry>(
    'lesson',
    'lessons',

    async (entry) => {
      const document = await restoreStoredDocument('lesson', entry, owner)

      if ('deck' in document) throw Error('Ожидалась методичка.')

      return {
        ...entry,
        deck: document,
      }
    }
  )

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
  let packed: StoredWorkingDocument | undefined

  const assets = new Map<string, Blob>()

  if (!remove) {
    deck = await prepareDocumentImages(deck)

    const result = await packLocalDocument('lesson', deck)

    packed = result.stored

    for (const [sha, blob] of result.assets) assets.set(sha, blob)
  }

  const db = await opened
  let backupDocument: StoredWorkingDocument | undefined

  if (!remove && revision > 0) {
    const previousRow = await new Promise<any>((resolve, reject) => {
      const request = db
        .transaction('lessons')
        .objectStore('lessons')
        .get(deck.id)

      request.onsuccess = () => resolve(request.result)

      request.onerror = () => reject(request.error)
    })

    if (!previousRow) {
      throw Error('Локальная методичка не найдена.')
    }

    if (!belongs(previousRow, owner)) {
      console.error('[Atlas] Document owner mismatch', {
        documentId: deck.id,
        storedScope: previousRow.scope,
        requestedOwner: owner,
        currentOwner: workingOwner,
        expectedRevision: revision,
        actualRevision: previousRow.revision,
      })

      throw Error(
        'Изменился владелец методички. ' +
          'В базе: ' +
          (previousRow.scope ?? 'local') +
          '. При сохранении: ' +
          (owner ?? 'local') +
          '. Текущий: ' +
          (workingOwner ?? 'local')
      )
    }

    if (previousRow.revision !== revision) {
      console.error('[Atlas] Local revision mismatch', {
        id: deck.id,
        expected: revision,
        actual: previousRow.revision,
      })

      throw Error(
        'Версия документа изменилась. ' +
          'Ожидалась: ' +
          revision +
          ', в IndexedDB: ' +
          previousRow.revision
      )
    }

    const previous = previousRow.packed?.document ?? previousRow.deck

    const requiresBackup =
      backupBeforeSync ||
      (deck.migrated === false && (previous.version < 3 || previous.migrated))

    if (requiresBackup) {
      const restored = await restoreStoredDocument('lesson', previousRow, owner)

      if ('deck' in restored) throw Error('Ожидалась методичка.')

      const backup: Deck = {
        ...restored,

        id: crypto.randomUUID(),

        title: backupBeforeSync
          ? restored.title.slice(0, 970) + ' — до синхронизации'
          : restored.title.slice(0, 990) + ' — до смены шаблона',
      }

      const result = await prepareStoredDocument(backup)

      backupDocument = result.stored

      for (const [sha, blob] of result.assets) assets.set(sha, blob)
    }
  }
  return new Promise<void>((resolve, reject) => {
    const stores = [
      'lessons',
      'originalDocuments',
      'workingState',
      'workingAssets',
    ]
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
      if (!remove) retainDocumentAssets(tx, owner, assets)
      if (owner && (!remove || deleteCloud))
        enqueueWorking(tx, owner, 'lesson', deck, remove)
      if (remove) {
        store.delete(deck.id)
        if (owner && !deleteCloud)
          dropWorkingCache(tx, owner, 'lesson', deck.id)
      } else {
        const previous = read.result?.deck
        if (previous) storeOriginal(tx, 'lesson', deck.id, previous)
        if (backupDocument) {
          const backup = backupDocument.document

          store.add({
            deck: backup,
            packed: backupDocument,
            revision: 1,
            updated: Date.now(),
            scope: owner ?? undefined,
          })

          if (owner) {
            enqueueWorking(tx, owner, 'lesson', backup, false)
          }
        }
        store.put({
          deck: packed ? packed.document : deck,
          packed,
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
  const owner = workingOwner

  return listDocuments<TemplateEntry>(
    'template',
    'templates',

    async (entry) => {
      const document = await restoreStoredDocument('template', entry, owner)

      if (!('deck' in document)) throw Error('Ожидался шаблон.')

      return {
        ...entry,
        template: document,
      }
    }
  )
}
export async function writeTemplate(entry: TemplateEntry, remove = false) {
  const owner = workingOwner

  let packed: StoredWorkingDocument | undefined

  const assets = new Map<string, Blob>()

  if (!remove) {
    entry = {
      ...entry,
      template: validateTemplate({
        ...entry.template,
        deck: await prepareDocumentImages(entry.template.deck),
      }),
    }

    const result = await packLocalDocument('template', entry.template)

    packed = result.stored

    for (const [sha, blob] of result.assets) assets.set(sha, blob)
  }

  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
        ['templates', 'originalDocuments', 'workingState', 'workingAssets'],
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
      if (!remove) retainDocumentAssets(tx, owner, assets)
      if (owner && !remove && entry.dirty)
        enqueueWorking(tx, owner, 'template', entry.template, false)

      if (remove) {
        store.delete(id)

        if (owner) dropWorkingCache(tx, owner, 'template', id)
      } else {
        if (q.result?.template)
          storeOriginal(tx, 'template', id, q.result.template)
        store.put({
          ...entry,

          template: packed ? packed.document : entry.template,

          packed,

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
    const current: WorkingRecord | undefined = read.result

    if (!current) return

    // Never discard unconfirmed local changes.
    if (
      current.dirty ||
      current.attempt ||
      current.conflict ||
      current.createCloud
    ) {
      tx.abort()
      return
    }

    const hasCloud = !!current.meta && !current.meta.deleted

    store.put(
      {
        ...current,
        localId: undefined,
        dirty: false,
        deleted: !hasCloud,
        generation: current.generation + 1,
      },
      key
    )
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
    const hasCloud = !!before?.meta && !before.meta.deleted

    const shouldSync = hasCloud || !!before?.createCloud || !!before?.attempt
    const next: WorkingRecord = {
      ...before,
      kind,
      id,
      localId: workingDeck(document).id,
      dirty: shouldSync,
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
function transferLocalAssets(
  tx: IDBTransaction,
  owner: string,
  packed: StoredWorkingDocument
) {
  const store = tx.objectStore('workingAssets')

  for (const sha of new Set(packed.refs)) {
    const request = store.get(['local', sha])

    request.onsuccess = () => {
      const asset: Asset | undefined = request.result

      if (!asset) {
        tx.abort()
        return
      }

      retainAsset(tx, owner, sha, asset.blob)
    }
  }
}
export async function registerWorking(owner: string) {
  const db = await opened
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [
        'lessons',
        'templates',
        'workingState',
        'workingBackups',
        'workingAssets',
      ],
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
            document = existing.packed
              ? existing.packed.document
              : kind === 'lesson'
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
            if (!existing.scope) {
              if (existing.packed) {
                transferLocalAssets(tx, owner, existing.packed)
              }

              collection.put({
                ...existing,
                scope: owner,
              })
            }
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
              dirty: false,
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

  const table = state.kind === 'lesson' ? 'lessons' : 'templates'

  const row = await new Promise<any>((resolve, reject) => {
    const read = db
      .transaction(table)
      .objectStore(table)
      .get(state.localId ?? state.id)

    read.onsuccess = () => resolve(read.result)

    read.onerror = () => reject(read.error)
  })

  if (!row || !belongs(row, owner)) return undefined

  return restoreStoredDocument(state.kind, row, owner)
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
  const assets = new Map<string, Blob>()

  async function prepare(
    document?: WorkingDocument
  ): Promise<StoredWorkingDocument | undefined> {
    if (!document) return undefined

    const result = await prepareStoredDocument(document)

    for (const [sha, blob] of result.assets) assets.set(sha, blob)

    return result.stored
  }

  const packedDocument = await prepare(replacement?.document)
  const packedCopy = await prepare(replacement?.copy)
  const packedBackup = await prepare(replacement?.backup)
  const db = await opened
  return new Promise<boolean>((resolve, reject) => {
    const table = kind === 'lesson' ? 'lessons' : 'templates'
    const tx = db.transaction(
      [
        'workingState',
        table,
        'workingBackups',
        'originalDocuments',
        'workingAssets',
      ],
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
      retainDocumentAssets(tx, owner, assets)
      const documents = tx.objectStore(table)
      const document = packedDocument?.document
      const docId =
        read.result?.localId ?? (document ? workingDeck(document).id : id)
      const previous = documents.get(docId)
      previous.onsuccess = () => {
        if (!belongs(previous.result, owner)) {
          tx.abort()
          return
        }
        if (packedBackup)
          tx.objectStore('workingBackups').put(
            {
              document: packedBackup.document,
              packed: packedBackup,
              until: Date.now() + 7 * 86400000,
            },

            [...key, crypto.randomUUID()]
          )
        if (packedCopy) {
          const copy = packedCopy.document

          const data =
            'deck' in copy
              ? {
                  template: copy,
                  cloudRevision: 0,
                  dirty: true,
                }
              : {
                  deck: copy,
                  updated: Date.now(),
                }

          documents.add({
            ...data,

            packed: packedCopy,

            scope: owner,

            revision: 1,
          })

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
          packed: packedDocument,
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

export type Asset = {
  blob: Blob
  uploaded: boolean
  name?: string
  createdAt?: number
  retained?: boolean
}
function assetExtension(mime: string) {
  switch (mime) {
    case 'image/png':
      return 'png'

    case 'image/jpeg':
      return 'jpg'

    case 'image/webp':
      return 'webp'

    default:
      return 'bin'
  }
}

function retainAsset(
  tx: IDBTransaction,
  owner: string,
  sha: string,
  blob: Blob
) {
  const store = tx.objectStore('workingAssets')
  const key = [owner, sha]

  const request = store.get(key)

  request.onsuccess = () => {
    const existing: Asset | undefined = request.result

    if (existing?.retained && existing.blob.type === blob.type) return

    const next: Asset = {
      blob,

      uploaded: existing?.uploaded ?? false,

      retained: true,

      name:
        existing?.name ??
        (blob.type.startsWith('image/') ? 'Изображение-' : 'Ресурс-') +
          sha.slice(0, 12) +
          '.' +
          assetExtension(blob.type),
      createdAt: existing?.createdAt ?? Date.now(),
    }

    store.put(next, key)
  }
}

function retainDocumentAssets(
  tx: IDBTransaction,
  owner: string | null,
  assets: Map<string, Blob>
) {
  for (const [sha, blob] of assets) {
    retainAsset(tx, assetScope(owner), sha, blob)
  }
}
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
    let result: Asset | undefined

    request.onsuccess = () => {
      const existing: Asset | undefined = request.result

      result = existing

      if (!write) return

      result = {
        ...write,
        ...existing,

        blob: existing?.blob ?? write.blob,

        uploaded: !!existing?.uploaded || write.uploaded,

        retained: !!existing?.retained || !!write.retained,

        createdAt: existing?.createdAt ?? write.createdAt ?? Date.now(),
      }

      if (
        !existing ||
        result.uploaded !== existing.uploaded ||
        result.retained !== existing.retained ||
        !existing.createdAt
      ) {
        store.put(result, key)
      }
    }
    tx.oncomplete = () => resolve(result)
    tx.onabort = () =>
      reject(tx.error ?? Error('Не удалось сохранить приватный ресурс.'))
  })
}

export async function workingBackups(owner: string) {
  const db = await opened

  const rows = await new Promise<
    {
      document: WorkingDocument
      packed?: StoredWorkingDocument
      until: number
    }[]
  >((resolve, reject) => {
    const q = db
      .transaction('workingBackups')
      .objectStore('workingBackups')
      .getAll(ownerRange(owner))

    q.onsuccess = () =>
      resolve(q.result.filter((row) => row.until > Date.now()))

    q.onerror = () => reject(q.error)
  })

  const result: {
    document: WorkingDocument
    until: number
  }[] = []

  for (const row of rows) {
    let document = row.document

    if (row.packed) {
      const kind: WorkingKind = 'deck' in document ? 'template' : 'lesson'

      document = await unpackLocalDocument(
        kind,
        workingDeck(document).id,
        row.packed,

        async (sha) => {
          const asset = await workingAsset(owner, sha)

          if (!asset)
            throw Error(
              'Ресурс резервной копии отсутствует: ' + sha.slice(0, 12)
            )

          return asset.blob
        }
      )
    }

    result.push({
      document,
      until: row.until,
    })
  }

  return result
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
export type LocalAsset = Asset & {
  sha: string
}

export async function localAssets(owner = workingOwner): Promise<LocalAsset[]> {
  const db = await opened

  return new Promise((resolve, reject) => {
    const tx = db.transaction('workingAssets', 'readonly')

    const store = tx.objectStore('workingAssets')

    const result: LocalAsset[] = []

    const cursor = store.openCursor(ownerRange(assetScope(owner)))

    cursor.onsuccess = () => {
      const row = cursor.result

      if (!row) return

      const value: Asset = row.value
      const key = row.key

      if (
        Array.isArray(key) &&
        value.retained &&
        value.blob.type.startsWith('image/')
      ) {
        result.push({
          ...value,
          sha: String(key[1]),
        })
      }

      row.continue()
    }

    tx.oncomplete = () => {
      resolve(result.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)))
    }

    tx.onabort = () =>
      reject(tx.error ?? Error('Не удалось прочитать библиотеку изображений.'))
  })
}

// Explicit library import: verify bytes and preserve the owner-specific record.
export async function retainLibraryImage(
  owner: string | null,
  sha: string,
  blob: Blob,
  name?: string,
  uploaded = false
) {
  if (!/^[0-9a-f]{64}$/.test(sha) || (await digest(blob)) !== sha)
    throw Error('Контрольная сумма изображения не совпадает.')
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ||
    !blob.size ||
    blob.size > 16 * 1024 * 1024
  )
    throw Error('Недопустимый формат или размер изображения.')
  if (owner !== workingOwner) throw Error('Изменился аккаунт.')
  const db = await opened
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('workingAssets', 'readwrite')
    const store = tx.objectStore('workingAssets')
    const key = [assetScope(owner), sha]
    const request = store.get(key)
    request.onsuccess = () => {
      if (owner !== workingOwner) {
        tx.abort()
        return
      }
      const existing: Asset | undefined = request.result
      store.put(
        {
          ...existing,
          blob,
          retained: true,
          uploaded: !!existing?.uploaded || uploaded,
          name:
            existing?.name ??
            name ??
            'Изображение-' + sha.slice(0, 12) + '.' + assetExtension(blob.type),
          createdAt: existing?.createdAt ?? Date.now(),
        } satisfies Asset,
        key
      )
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(tx.error ?? Error('Не удалось сохранить изображение.'))
  })
  reportWorkingChange(owner)
}

// Inspect raw snapshots in the same IDB transaction as deletion. Old inline
// JSON is deliberately handled conservatively; historical originals are unscoped.
function referencesAsset(
  value: unknown,
  sha: string,
  bytes: Uint8Array
): boolean {
  if (typeof value === 'string') {
    if (value.includes(sha)) return true
    if (!/^data:image\//i.test(value)) return false
    const match = /^data:image\/[^;,]+;base64,([\s\S]*)$/i.exec(value)
    if (!match) return true // unknown image encoding: fail closed
    try {
      const binary = atob(match[1])
      if (binary.length !== bytes.length) return false
      for (let i = 0; i < bytes.length; i++)
        if (binary.charCodeAt(i) !== bytes[i]) return false
      return true
    } catch {
      return true
    }
  }
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some((v) => referencesAsset(v, sha, bytes))
}

export async function removeLocalLibraryImage(
  owner: string | null,
  sha: string
) {
  if (owner !== workingOwner || !/^[0-9a-f]{64}$/.test(sha))
    throw Error('Изменился аккаунт или неверный идентификатор ресурса.')
  const scope = assetScope(owner)
  const asset = await workingAsset(scope, sha)
  if (!asset?.retained)
    throw Error('Изображение отсутствует в локальной библиотеке.')
  if ((await digest(asset.blob)) !== sha)
    throw Error('Локальный ресурс повреждён.')
  const bytes = new Uint8Array(await asset.blob.arrayBuffer())
  const db = await opened
  const stores = [
    'lessons',
    'templates',
    'workingState',
    'workingBackups',
    'originalDocuments',
    'workingAssets',
  ]
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite')
    let reason = 'Не удалось проверить использование изображения.'
    let left = stores.length
    const fail = (message: string) => {
      reason = message
      tx.abort()
    }
    const done = () => {
      if (--left !== 0) return
      if (owner !== workingOwner) {
        fail('Изменился аккаунт.')
        return
      }
      tx.objectStore('workingAssets').delete([scope, sha])
    }
    for (const table of stores) {
      const store = tx.objectStore(table)
      if (table === 'workingAssets') {
        const q = store.get([scope, sha])
        q.onsuccess = () => {
          if (!q.result?.retained) {
            fail('Изображение уже изменилось.')
            return
          }
          done()
        }
        continue
      }
      // originalDocuments is not owner-scoped; don't guess which account owns it.
      const q =
        table === 'workingState' || table === 'workingBackups'
          ? owner
            ? store.getAll(ownerRange(owner))
            : undefined
          : store.getAll()
      if (!q) {
        done()
        continue
      }
      q.onsuccess = () => {
        try {
          for (const row of q.result) {
            if (
              (table === 'lessons' || table === 'templates') &&
              !belongs(row, owner)
            )
              continue
            if (table === 'workingBackups' && row.until <= Date.now()) continue
            if (referencesAsset(row, sha, bytes)) {
              fail(
                'Изображение используется документом, резервной копией, исходным JSON или операцией синхронизации.'
              )
              return
            }
          }
          done()
        } catch {
          fail('Не удалось проверить все локальные ссылки. Удаление отменено.')
        }
      }
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? Error(reason))
  })
  reportWorkingChange(owner)
}

// Stage 6: explicit, resumable maintenance. No automatic cloud creation or deletion.
export type MigrationLine = {
  kind: string
  id: string
  title: string
  status: 'migrated' | 'verified' | 'skipped' | 'error'
  detail?: string
}
type MaintenanceRow = StoredDocumentRow & {
  revision?: number
  document?: WorkingDocument
  until?: number
  [key: string]: unknown
}
type MaintenanceSnapshot = { key: IDBValidKey; row: MaintenanceRow }
function migrationMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
function assertMaintenanceOwner(owner: string | null) {
  if (owner !== workingOwner)
    throw Error('Изменился аккаунт. Операция остановлена.')
}
async function maintenanceRows(
  table: string,
  range?: IDBKeyRange
): Promise<MaintenanceSnapshot[]> {
  const db = await opened
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readonly')
    const rows: MaintenanceSnapshot[] = []
    const q = tx.objectStore(table).openCursor(range)
    q.onsuccess = () => {
      const c = q.result
      if (c) {
        rows.push({ key: c.primaryKey, row: c.value })
        c.continue()
      }
    }
    tx.oncomplete = () => resolve(rows)
    tx.onabort = () =>
      reject(tx.error ?? Error('Не удалось прочитать локальное хранилище.'))
  })
}
export async function maintenanceLocalKeys(
  owner: string | null
): Promise<Set<string>> {
  assertMaintenanceOwner(owner)
  const keys = new Set<string>()
  for (const [kind, table] of [
    ['lesson', 'lessons'],
    ['template', 'templates'],
  ] as const)
    for (const { key, row } of await maintenanceRows(table))
      if (belongs(row, owner)) keys.add(kind + ':' + String(key).toLowerCase())
  assertMaintenanceOwner(owner)
  return keys
}
// The bytes here come from packLocalDocument, which computes the SHA itself.
// Replace a damaged cached copy explicitly; preserve receipts and user metadata.
function writeVerifiedAssets(
  tx: IDBTransaction,
  owner: string | null,
  assets: Map<string, Blob>
) {
  const store = tx.objectStore('workingAssets')
  for (const [sha, blob] of assets) {
    const key = [assetScope(owner), sha],
      q = store.get(key)
    q.onsuccess = () => {
      const old: Asset | undefined = q.result
      store.put(
        {
          ...old,
          blob,
          retained: true,
          uploaded: old?.uploaded ?? false,
          createdAt: old?.createdAt ?? Date.now(),
          name:
            old?.name ??
            (blob.type.startsWith('image/') ? 'Изображение-' : 'Ресурс-') +
              sha.slice(0, 12) +
              '.' +
              assetExtension(blob.type),
        } satisfies Asset,
        key
      )
    }
  }
}
export async function migrateLocalLibrary(
  owner: string | null,
  recover?: (sha: string) => Promise<Blob>,
  onLine?: (line: MigrationLine) => void
): Promise<MigrationLine[]> {
  assertMaintenanceOwner(owner)
  const results: MigrationLine[] = []
  const report = (line: MigrationLine) => {
    results.push(line)
    onLine?.(line)
  }
  const tables: {
    table: string
    kind: 'lesson' | 'template' | 'backup'
    range?: IDBKeyRange
  }[] = [
    { table: 'lessons', kind: 'lesson' },
    { table: 'templates', kind: 'template' },
  ]
  if (owner)
    tables.push({
      table: 'workingBackups',
      kind: 'backup',
      range: ownerRange(owner),
    })
  for (const { table, kind, range } of tables) {
    for (const { key, row } of await maintenanceRows(table, range)) {
      assertMaintenanceOwner(owner)
      if (kind !== 'backup' && !belongs(row, owner)) continue
      if (kind === 'backup' && Number(row.until) <= Date.now()) continue
      const raw =
        row.packed?.document ??
        (kind === 'backup'
          ? row.document
          : kind === 'lesson'
            ? row.deck
            : row.template)
      const actualKind: WorkingKind =
        kind === 'backup'
          ? raw && typeof raw === 'object' && 'deck' in raw
            ? 'template'
            : 'lesson'
          : kind
      const id =
        kind === 'backup'
          ? String(Array.isArray(key) ? key[key.length - 1] : key)
          : String(key)
      const body =
        raw && typeof raw === 'object' && 'deck' in raw ? raw.deck : raw
      const title =
        body && typeof body === 'object' && 'title' in body
          ? String(body.title)
          : id
      try {
        let recovered = false
        const scope = kind === 'backup' ? owner : (row.scope ?? null)
        const document = row.packed
          ? await unpackLocalDocument(
              actualKind,
              workingDeck(row.packed.document).id,
              row.packed,
              async (sha) => {
                const cached = await workingAsset(assetScope(scope), sha)
                if (cached?.blob && (await digest(cached.blob)) === sha)
                  return cached.blob
                if (!recover || !owner || scope !== owner)
                  throw Error('Отсутствует или повреждён ресурс ' + sha)
                const blob = await recover(sha)
                if ((await digest(blob)) !== sha)
                  throw Error(
                    'Неверная контрольная сумма восстановленного ресурса ' + sha
                  )
                recovered = true
                return blob
              }
            )
          : actualKind === 'lesson'
            ? validateDeck(raw)
            : validateTemplate(raw)
        const result = await prepareStoredDocument(document)
        let needsWrite =
          recovered ||
          !row.packed ||
          row.packed.hash !== result.stored.hash ||
          (kind !== 'backup' && (row.scope ?? null) !== owner)
        for (const [sha, blob] of result.assets) {
          const saved = await workingAsset(assetScope(owner), sha)
          if (
            !saved?.retained ||
            saved.blob.type !== blob.type ||
            (await digest(saved.blob)) !== sha
          )
            needsWrite = true
        }
        if (!needsWrite) {
          report({ kind, id, title, status: 'verified' })
          continue
        }
        assertMaintenanceOwner(owner)
        const db = await opened
        const status = await new Promise<'migrated' | 'skipped'>(
          (resolve, reject) => {
            const stores = [
              table,
              'workingAssets',
              'workingState',
              'originalDocuments',
            ]
            const tx = db.transaction(stores, 'readwrite'),
              store = tx.objectStore(table),
              q = store.get(key)
            let outcome: 'migrated' | 'skipped' = 'skipped',
              reason = 'Локальная миграция отменена.'
            const fail = (message: string) => {
              reason = message
              tx.abort()
            }
            q.onsuccess = () => {
              const current: MaintenanceRow | undefined = q.result
              // Compare raw snapshots, not only revisions: registration can change scope.
              if (!current || JSON.stringify(current) !== JSON.stringify(row))
                return
              if (owner !== workingOwner) {
                fail('Изменился аккаунт.')
                return
              }
              if (kind === 'backup' && Number(current.until) <= Date.now())
                return
              const write = () => {
                if (owner !== workingOwner) {
                  fail('Изменился аккаунт.')
                  return
                }
                writeVerifiedAssets(tx, owner, result.assets)
                if (kind === 'backup')
                  store.put(
                    {
                      ...current,
                      document: result.stored.document,
                      packed: result.stored,
                    },
                    key
                  )
                else {
                  if (!current.packed) storeOriginal(tx, actualKind, id, raw)
                  const field = kind === 'lesson' ? 'deck' : 'template'
                  store.put({
                    ...current,
                    [field]: result.stored.document,
                    packed: result.stored,
                    scope: owner ?? undefined,
                    revision: (current.revision ?? 0) + 1,
                  })
                  if (owner)
                    enqueueWorking(tx, owner, actualKind, document, false)
                }
                outcome = 'migrated'
              }
              if (owner && kind !== 'backup') {
                const pending = tx
                  .objectStore('workingState')
                  .get(docKey(owner, actualKind, id))
                pending.onsuccess = () => {
                  const state: WorkingRecord | undefined = pending.result
                  if (
                    state &&
                    (state.dirty ||
                      state.attempt ||
                      state.conflict ||
                      state.createCloud ||
                      state.deleted)
                  )
                    return
                  write()
                }
              } else write()
            }
            tx.oncomplete = () => resolve(outcome)
            tx.onabort = () => reject(tx.error ?? Error(reason))
          }
        )
        report({
          kind,
          id,
          title,
          status,
          detail:
            status === 'skipped'
              ? 'Документ изменился или ожидает синхронизации; повторите после завершения.'
              : undefined,
        })
      } catch (error) {
        report({
          kind,
          id,
          title,
          status: 'error',
          detail: migrationMessage(error),
        })
      }
    }
  }
  reportWorkingChange(owner)
  return results
}
export async function auditLocalAssets(
  owner: string | null
): Promise<MigrationLine[]> {
  assertMaintenanceOwner(owner)
  const result: MigrationLine[] = []
  for (const { key, row } of await maintenanceRows(
    'workingAssets',
    ownerRange(assetScope(owner))
  )) {
    assertMaintenanceOwner(owner)
    const sha = String(Array.isArray(key) ? key[1] : key),
      asset = row as unknown as Asset
    try {
      if (!asset.blob || (await digest(asset.blob)) !== sha)
        throw Error('Контрольная сумма не совпадает.')
      result.push({
        kind: 'local-asset',
        id: sha,
        title: asset.name ?? sha,
        status: 'verified',
      })
    } catch (error) {
      result.push({
        kind: 'local-asset',
        id: sha,
        title: asset.name ?? sha,
        status: 'error',
        detail: migrationMessage(error),
      })
    }
  }
  return result
}
// Read-only document audit; no fetch of an external URL and no repair writes.
export async function auditLocalDocuments(
  owner: string | null
): Promise<MigrationLine[]> {
  assertMaintenanceOwner(owner)
  const result: MigrationLine[] = []
  const tables: {
    table: string
    kind: 'lesson' | 'template' | 'backup'
    range?: IDBKeyRange
  }[] = [
    { table: 'lessons', kind: 'lesson' },
    { table: 'templates', kind: 'template' },
  ]
  if (owner)
    tables.push({
      table: 'workingBackups',
      kind: 'backup',
      range: ownerRange(owner),
    })
  for (const { table, kind, range } of tables)
    for (const { key, row } of await maintenanceRows(table, range)) {
      assertMaintenanceOwner(owner)
      if (kind !== 'backup' && !belongs(row, owner)) continue
      if (kind === 'backup' && Number(row.until) <= Date.now()) continue
      const id =
        kind === 'backup'
          ? String(Array.isArray(key) ? key[key.length - 1] : key)
          : String(key)
      const raw =
        row.packed?.document ??
        (kind === 'backup'
          ? row.document
          : kind === 'lesson'
            ? row.deck
            : row.template)
      const actualKind: WorkingKind =
        kind === 'backup'
          ? raw && typeof raw === 'object' && 'deck' in raw
            ? 'template'
            : 'lesson'
          : kind
      const scope = kind === 'backup' ? owner : (row.scope ?? null)
      const body =
        raw && typeof raw === 'object' && 'deck' in raw ? raw.deck : raw
      const title =
        body && typeof body === 'object' && 'title' in body
          ? String(body.title)
          : id
      try {
        const document = row.packed
          ? await unpackLocalDocument(
              actualKind,
              workingDeck(row.packed.document).id,
              row.packed,
              async (sha) => {
                const a = await workingAsset(assetScope(scope), sha)
                if (!a?.blob) throw Error('Отсутствует ресурс ' + sha)
                if (!a.retained)
                  throw Error(
                    'Ресурс не закреплён в локальной библиотеке ' + sha
                  )
                return a.blob
              }
            )
          : actualKind === 'lesson'
            ? validateDeck(raw)
            : validateTemplate(raw)
        const links = mediaSlides(workingDeck(document)).some(
          (s) =>
            (!!s.background && !s.background.startsWith('data:')) ||
            s.items.some(
              (i) => i.type === 'image' && !i.src.startsWith('data:')
            )
        )
        result.push({
          kind,
          id,
          title,
          status: row.packed && !links ? 'verified' : 'skipped',
          detail: links
            ? 'Есть внешние ссылки; требуется миграция онлайн.'
            : row.packed
              ? undefined
              : 'Старый формат JSON; требуется миграция.',
        })
      } catch (e) {
        result.push({
          kind,
          id,
          title,
          status: 'error',
          detail: migrationMessage(e),
        })
      }
    }
  return result
}
