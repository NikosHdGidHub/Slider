import { MAX_DOCUMENT_BYTES, readJSON } from './model'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
export const adminId = String(import.meta.env.VITE_ADMIN_UUID || '')
  .trim()
  .toLowerCase()
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function isPublicKey(value: string) {
  if (value.startsWith('sb_publishable_')) return true
  try {
    const payload = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).role === 'anon'
  } catch {
    return false
  }
}

function configure(): SupabaseClient | null {
  try {
    const endpoint = new URL(url)
    if (
      endpoint.protocol !== 'https:' ||
      !isPublicKey(key) ||
      !uuidPattern.test(adminId)
    )
      return null
    return createClient(endpoint.origin, key)
  } catch {
    return null
  }
}

export const client = configure()

let guestClient: SupabaseClient | undefined
export function createGuestClient() {
  if (!client) return null
  guestClient ??= createClient(new URL(url).origin, key, {
    auth: {
      storageKey: 'atlas-transfer-guest',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return guestClient
}

export function isProjectStorageUrl(src: string) {
  return new URL(src).origin === new URL(url).origin
}

function storage() {
  if (!client)
    throw new Error('Заполните настройки Supabase и пересоберите приложение.')
  return client.storage
}

function documentPath(id: string) {
  if (!uuidPattern.test(id))
    throw new Error('Некорректный идентификатор публикации.')
  return id.toLowerCase() + '.json'
}

const storageLockId = '00000000-0000-4000-8000-000000000000'
export type StorageWriter = (
  bucket: string
) => ReturnType<ReturnType<typeof storage>['from']>

class UnconfirmedStorageWrite extends Error {}

export function checkStorageWrite(
  error: { message: string; status?: number } | null,
  message: string
) {
  if (!error) return
  const failure = message + ' ' + error.message
  // A lost response or a server failure can leave the write running.
  // Keep the lease in that case so another client cannot act on stale data.
  if (!error.status || error.status >= 500)
    throw new UnconfirmedStorageWrite(
      failure +
        ' Результат операции не подтверждён. Обновите список, затем повторите попытку.'
    )
  throw Error(failure)
}

export async function withStorageLock<T>(
  action: (bucket: StorageWriter) => Promise<T>
): Promise<T> {
  if (!client) throw Error('Подключите Supabase.')
  const token = crypto.randomUUID()
  let acquired = false
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await client.rpc('atlas_lock_publication', {
      document_id: storageLockId,
      lock_token: token,
    })
    if (error) throw Error(error.message)
    if (data) {
      acquired = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!acquired)
    throw Error(
      'Другая операция с облачными файлами ещё выполняется. Повторите попытку позже.'
    )
  let release = true
  try {
    return await action((bucket) =>
      storage()
        .from(bucket)
        .setHeader('x-client-info', 'atlas-storage/' + token)
    )
  } catch (error) {
    release = !(error instanceof UnconfirmedStorageWrite)
    throw error
  } finally {
    // Expiration releases the lock if the connection is lost during cleanup.
    if (release)
      await client
        .from('atlas_publication_locks')
        .delete()
        .eq('id', storageLockId)
        .eq('token', token)
  }
}

export async function publishDocument(
  id: string,
  document: unknown,
  bucket: StorageWriter
): Promise<void> {
  const file = new Blob([JSON.stringify(document)], {
    type: 'application/json',
  })
  const { error } = await bucket('presentations').upload(
    documentPath(id),
    file,
    {
      upsert: true,
      cacheControl: '0',
      contentType: 'application/json',
    }
  )
  checkStorageWrite(error, 'Не удалось опубликовать методичку.')
}

export async function readPublic(
  id: string,
  signal?: AbortSignal
): Promise<unknown> {
  const address = new URL(
    storage()
      .from('presentations')
      .getPublicUrl(documentPath(id)).data.publicUrl
  )
  address.searchParams.set('revision', crypto.randomUUID())
  const response = await fetch(address, { cache: 'no-store', signal })
  if (!response.ok)
    throw new Error(
      'Публикация недоступна. Проверьте ссылку и подключение к сети.'
    )
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Публикация пуста.')
  const decoder = new TextDecoder(),
    parts: string[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DOCUMENT_BYTES) {
        await reader.cancel()
        throw new Error('Публикация превышает 64 МиБ.')
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return readJSON(parts.join(''))
  } finally {
    reader.releaseLock()
  }
}

export async function readPublishedForInventory(id: string): Promise<unknown> {
  const { data, error } = await storage()
    .from('presentations')
    .download(
      documentPath(id),
      { cacheNonce: crypto.randomUUID() },
      { cache: 'no-store', signal: AbortSignal.timeout(30000) }
    )
  if (error) throw error
  if (data.size > MAX_DOCUMENT_BYTES)
    throw Error('Публикация превышает 64 МиБ.')
  return readJSON(await data.text())
}

export async function unpublish(id: string): Promise<void> {
  await withStorageLock(async (bucket) => {
    const { error } = await bucket('presentations').remove([documentPath(id)])
    checkStorageWrite(error, 'Не удалось снять методичку с публикации.')
  })
}

export async function listPublished(signal?: AbortSignal): Promise<string[]> {
  const ids: string[] = []
  const bucket = storage().from('presentations')
  const limit = 100
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await bucket.list(
      '',
      {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      },
      { signal }
    )
    if (error)
      throw new Error(
        'Не удалось загрузить список публикаций. ' + error.message
      )
    for (const file of data) {
      const id = file.name.replace(/\.json$/, '')
      if (file.name.endsWith('.json') && uuidPattern.test(id)) ids.push(id)
    }
    if (data.length < limit) return ids
  }
}
