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

export async function withPublicationLock<T>(
  id: string,
  action: () => Promise<T>
): Promise<T> {
  if (!client) throw Error('Подключите Supabase.')
  const token = crypto.randomUUID()
  const { data, error } = await client.rpc('atlas_lock_publication', {
    document_id: id,
    lock_token: token,
  })
  if (error) throw Error(error.message)
  if (!data)
    throw Error(
      'Другое устройство обновляет публикацию. Повторите попытку позже.'
    )
  try {
    return await action()
  } finally {
    // Expiration releases the lock if the connection is lost during cleanup.
    await client
      .from('atlas_publication_locks')
      .delete()
      .eq('id', id)
      .eq('token', token)
  }
}

export async function publishDocument(
  id: string,
  document: unknown
): Promise<void> {
  const file = new Blob([JSON.stringify(document)], {
    type: 'application/json',
  })
  const { error } = await storage()
    .from('presentations')
    .upload(documentPath(id), file, {
      upsert: true,
      cacheControl: '0',
      contentType: 'application/json',
    })
  if (error)
    throw new Error('Не удалось опубликовать методичку. ' + error.message)
}

export async function readPublic(id: string): Promise<unknown> {
  const address = new URL(
    storage()
      .from('presentations')
      .getPublicUrl(documentPath(id)).data.publicUrl
  )
  address.searchParams.set('revision', crypto.randomUUID())
  const response = await fetch(address, { cache: 'no-store' })
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

export async function unpublish(id: string): Promise<void> {
  const { error } = await withPublicationLock(id, async () =>
    storage()
      .from('presentations')
      .remove([documentPath(id)])
  )
  if (error)
    throw new Error('Не удалось снять методичку с публикации. ' + error.message)
}

export async function listPublished(): Promise<string[]> {
  const ids: string[] = []
  const bucket = storage().from('presentations')
  const limit = 100
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await bucket.list('', {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
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
