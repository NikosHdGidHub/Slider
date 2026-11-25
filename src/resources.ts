import { digest } from './digest'
import { client, adminId } from './cloud'
import { validateDeck } from './model'
import { optimize } from './media'

export type Resource = {
  sha: string
  name: string
  folder: string
  mime: string
  size: number
  created_at: string
  bucket: string
  path: string
}
const types: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  json: 'application/json',
}
function db() {
  if (!client) throw Error('Подключите Supabase.')
  return client
}
export async function resources(): Promise<Resource[]> {
  const rows: Resource[] = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db()
      .from('atlas_files')
      .select('*')
      .eq('hidden', false)
      .order('sha')
      .range(offset, offset + 99)
    if (error) throw Error(error.message)
    rows.push(...data)
    if (data.length < 100) return rows
  }
}
export function imageUrl(row: Resource) {
  return db().storage.from(row.bucket).getPublicUrl(row.path).data.publicUrl
}
export async function updateFile(
  sha: string,
  patch: { name?: string; folder?: string; hidden?: boolean }
) {
  const { error } = await db()
    .from('atlas_files')
    .update(patch)
    .eq('sha', sha)
    .select('sha')
    .single()
  if (error) throw Error(error.message)
}
export async function storeFile(
  blob: Blob,
  name: string,
  folder = ''
): Promise<Resource> {
  let ext = name.split('.').pop()!.toLowerCase()
  if (blob.size > 50 * 1024 * 1024 || !blob.size)
    throw Error('Допустимый размер файла — до 50 МиБ.')
  if (ext === 'svg') {
    blob = await (await fetch((await optimize(blob)).src)).blob()
    ext = 'webp'
    name = name.replace(/\.svg$/i, '.webp')
  }
  const mime = types[ext]
  if (!mime) throw Error('Формат файла не поддерживается.')
  if (mime === 'application/json') validateDeck(await blob.text())
  if (ext === 'pdf' && !(await blob.slice(0, 1024).text()).includes('%PDF-'))
    throw Error('У файла нет заголовка PDF.')
  if (ext === 'pptx' && (await blob.slice(0, 4).text()) !== 'PK\x03\x04')
    throw Error('Файл не содержит архив PPTX.')
  const sha = await digest(blob)
  const catalog = db().from('atlas_files')
  const existing = await catalog.select('*').eq('sha', sha).maybeSingle()
  if (existing.error) throw Error(existing.error.message)
  if (existing.data) {
    if (existing.data.hidden) await updateFile(sha, { hidden: false })
    return existing.data
  }
  const image = mime.startsWith('image/')
  if (image) {
    if (blob.size > 16 * 1024 * 1024)
      throw Error('Изображение превышает 16 МиБ.')
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
    const signature = String.fromCharCode(...header)
    const matches =
      mime === 'image/png'
        ? signature.startsWith('\x89PNG\r\n\x1a\n')
        : mime === 'image/jpeg'
          ? header[0] === 255 && header[1] === 216
          : signature.startsWith('RIFF') && signature.endsWith('WEBP')
    if (!matches)
      throw Error('Содержимое изображения не соответствует расширению.')
    const bitmap = await createImageBitmap(blob)
    bitmap.close()
  }
  const bucket = image ? 'images' : 'atlas-private'
  const path = image ? sha + '.' + (ext === 'jpeg' ? 'jpg' : ext) : sha
  const { error } = await db()
    .storage.from(bucket)
    .upload(path, blob, { contentType: mime, cacheControl: '31536000' })
  if (error && !['409', '400'].includes(String(error.statusCode)))
    throw Error(error.message)
  if (error && !/duplicate|already exists/i.test(error.message))
    throw Error(error.message)
  const row = {
    sha,
    name,
    folder,
    mime,
    size: blob.size,
    bucket,
    path,
    owner_id: adminId,
  }
  const saved = await catalog.upsert(row, {
    onConflict: 'sha',
    ignoreDuplicates: true,
  })
  if (saved.error) throw Error(saved.error.message)
  const result = await catalog.select('*').eq('sha', sha).single()
  if (result.error) throw Error(result.error.message)
  return result.data
}
export async function downloadFile(row: Resource) {
  const { data, error } = await db().storage.from(row.bucket).download(row.path)
  if (error) throw Error(error.message)
  return data
}

export async function listFolders(): Promise<string[]> {
  const { data, error } = await db()
    .from('atlas_folders')
    .select('name')
    .order('name')
  if (error) throw Error(error.message)
  return data.map((row) => row.name)
}
export async function createFolder(name: string) {
  const { error } = await db()
    .from('atlas_folders')
    .upsert({ name }, { onConflict: 'name', ignoreDuplicates: true })
  if (error) throw Error(error.message)
}

const imageTypes: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

export async function uploadImage(blob: Blob, name?: string): Promise<string> {
  const extension = imageTypes[blob.type]
  if (!extension)
    throw new Error('Загрузите растровое изображение PNG, WebP или JPEG.')
  return imageUrl(
    await storeFile(
      blob,
      (name?.replace(/\.[^.]+$/, '') || 'Изображение') + '.' + extension
    )
  )
}
