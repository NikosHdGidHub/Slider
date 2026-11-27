import { digest } from './digest'
import {
  client,
  adminId,
  withStorageLock,
  checkStorageWrite,
  type StorageWriter,
} from './cloud'
import { validateDeck } from './model'
import { optimize, originalImage } from './media'
import { currentWorkingOwner, retainLibraryImage, type MigrationLine } from './storage'
export type Resource = {
  sha: string | null
  name: string
  folder: string
  mime: string
  size: number
  created_at: string
  bucket: string
  path: string
}
export type ResourceDocument = {
  id: string
  title: string
  kind: 'lesson' | 'template'
  deleted: string | null
}

export type WorkingResource = {
  sha: string
  bucket: string
  path: string
  mime: string
  size: number | null
  created_at: string

  documents: ResourceDocument[]
  trash: ResourceDocument[]
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
      .from('atlas_file_inventory')
      .select('*')
      .order('bucket')
      .order('path')
      .range(offset, offset + 99)
    if (error) throw Error(error.message)
    rows.push(...data)
    if (data.length < 100) return rows
  }
}
export async function workingResources(
  owner: string
): Promise<WorkingResource[]> {
  const { data, error } = await db()
    .rpc('atlas_resource_library', {
      expected_owner: owner,
    })
    .abortSignal(AbortSignal.timeout(20000))

  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw Error(
        'Облачная библиотека ресурсов ' +
          'не настроена. Примените ' +
          'resource-library.sql.'
      )
    }

    throw Error(error.message)
  }

  if (!Array.isArray(data)) {
    throw Error('Получен некорректный каталог ресурсов.')
  }

  return data as WorkingResource[]
}
export async function workingImages(owner: string): Promise<WorkingResource[]> {
  const rows = await workingResources(owner)

  const supported = new Set(['image/png', 'image/jpeg', 'image/webp'])

  return rows.filter((row) => supported.has(row.mime))
}
export function imageUrl(row: Resource) {
  return db().storage.from(row.bucket).getPublicUrl(row.path).data.publicUrl
}
export function resourceKey(row: Pick<Resource, 'bucket' | 'path'>) {
  return row.bucket + '/' + row.path
}

const inventory = () => db().from('atlas_file_inventory')
async function register(row: Resource, sha: string) {
  const { error } = await db()
    .from('atlas_files')
    .upsert(
      { ...row, sha, owner_id: adminId },
      { onConflict: 'bucket,path', ignoreDuplicates: true }
    )
  if (error) throw error
}

export async function updateFile(
  row: Resource,
  patch: { name?: string; folder?: string }
) {
  return withStorageLock(async () => {
    if (!row.sha) await register(row, await digest(await downloadFile(row)))
    const { error } = await db()
      .from('atlas_files')
      .update(patch)
      .eq('bucket', row.bucket)
      .eq('path', row.path)
      .select('path')
      .single()
    if (error) throw error
  })
}

export async function purgeFile(row: Resource, bucket: StorageWriter) {
  const api = bucket(row.bucket)
  const { error } = await api.remove([row.path])
  checkStorageWrite(error, 'Не удалось удалить файл.')
  const { data, error: checkError } = await inventory()
    .select('path')
    .eq('bucket', row.bucket)
    .eq('path', row.path)
    .maybeSingle()
  if (checkError) throw checkError
  if (data) throw Error('Файл остался в хранилище. Повторите удаление.')
  const { error: cleanup } = await db()
    .from('atlas_files')
    .delete()
    .eq('bucket', row.bucket)
    .eq('path', row.path)
  if (cleanup)
    throw Error('Файл удалён из Storage. Не удалось очистить запись каталога.')
}

export async function storeFile(
  blob: Blob,
  name: string,
  folder = '',
  writer?: StorageWriter
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
  async function save(write: StorageWriter) {
    const existing = await inventory()
      .select('*')
      .eq('sha', sha)
      .order('bucket')
      .order('path')
      .limit(1)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) return existing.data as Resource
    // Recover metadata from the actual bytes. Keep every historic object path.
    for (const row of await resources()) {
      if (
        row.sha ||
        (row.size && row.size !== blob.size) ||
        row.bucket !== (image ? 'images' : 'atlas-private')
      )
        continue
      const recovered = await digest(await downloadFile(row))
      await register(row, recovered)
      if (recovered === sha) return { ...row, sha }
    }
    const bucket = image ? 'images' : 'atlas-private'
    const path = image ? sha + '.' + (ext === 'jpeg' ? 'jpg' : ext) : sha
    const { error } = await write(bucket).upload(path, blob, {
      contentType: mime,
      cacheControl: '31536000',
    })
    checkStorageWrite(error, 'Не удалось загрузить файл.')
    const row = {
      sha,
      name,
      folder,
      mime,
      size: blob.size,
      bucket,
      path,
      created_at: new Date().toISOString(),
    }
    await register(row, sha)
    return row
  }
  return writer ? save(writer) : withStorageLock(save)
}
export async function downloadFile(row: Resource) {
  const { data, error } = await db()
    .storage.from(row.bucket)
    .download(
      row.path,
      {},
      { cache: 'no-store', signal: AbortSignal.timeout(30000) }
    )
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

export async function uploadImage(
  blob: Blob,
  writer: StorageWriter
): Promise<string> {
  const extension = imageTypes[blob.type]
  if (!extension)
    throw new Error('Загрузите растровое изображение PNG, WebP или JPEG.')
  return imageUrl(await storeFile(blob, 'Изображение.' + extension, '', writer))
}
export async function readWorkingImage(
  owner: string,
  row: WorkingResource
): Promise<Blob> {
  if (
    row.bucket !== 'atlas-private-resources' ||
    row.path !== owner + '/' + row.sha ||
    !/^[0-9a-f]{64}$/.test(row.sha)
  ) {
    throw Error('Некорректный путь облачного ресурса.')
  }

  const supported = new Set(['image/png', 'image/jpeg', 'image/webp'])

  if (!supported.has(row.mime)) {
    throw Error('Формат изображения не поддерживается.')
  }

  const { data, error } = await db()
    .storage.from(row.bucket)
    .download(
      row.path,
      {},
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
      }
    )

  if (error || !data) {
    throw Error(error?.message ?? 'Облачное изображение недоступно.')
  }

  if ((await digest(data)) !== row.sha) {
    throw Error('Контрольная сумма изображения ' + 'не совпадает.')
  }

  return new Blob([data], { type: row.mime })
}
export async function saveWorkingImageLocally(
  owner: string,
  row: WorkingResource
) {
  const blob = await readWorkingImage(owner, row)

  await retainLibraryImage(owner, row.sha, blob, undefined, true)
}

export type LegacyResourceUse = ResourceDocument & { urls: string[] }

export async function legacyResourceUses(
  owner: string
): Promise<LegacyResourceUse[]> {
  const { data, error } = await db()
    .rpc('atlas_legacy_resource_uses', { expected_owner: owner })
    .abortSignal(AbortSignal.timeout(30000))
  if (error) throw Error(error.message)
  if (!Array.isArray(data))
    throw Error('Не удалось проверить ссылки старых документов.')
  return data as LegacyResourceUse[]
}

// No public URL for a private object. Reuse the exact source bytes.
export async function readLibraryLegacyImage(row: Resource): Promise<Blob> {
  if (
    row.bucket !== 'images' ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(row.mime)
  )
    throw Error('Неподдерживаемое изображение.')
  const blob = await downloadFile(row)
  if (row.sha && (await digest(blob)) !== row.sha)
    throw Error('Контрольная сумма изображения не совпадает.')
  return new Blob([blob], { type: row.mime })
}

export async function saveLegacyImageLocally(
  owner: string | null,
  row: Resource
) {
  const blob = await readLibraryLegacyImage(row)
  await retainLibraryImage(owner, await digest(blob), blob, row.name)
}

// Standalone upload is private, independent of the existence of any methodical document.
export async function uploadLibraryImage(
  owner: string,
  blob: Blob,
  name?: string
) {
  if (owner !== currentWorkingOwner()) throw Error('Изменился аккаунт.')
  const sha = await digest(blob)
  await retainLibraryImage(owner, sha, blob, name)
  const path = owner + '/' + sha
  const api = db().storage.from('atlas-private-resources')
  const { data: existing } = await api.info(path)
  if (!existing) {
    const { error } = await api.upload(path, blob, {
      upsert: false,
      contentType: blob.type,
      cacheControl: '0',
    })
    if (error) {
      // A competing upload may already have succeeded; only verified bytes count.
      const { data, error: check } = await api.download(path)
      if (check || !data || (await digest(data)) !== sha)
        throw Error(error.message)
    }
  }
  const { data, error } = await api.download(path)
  if (error || !data || (await digest(data)) !== sha)
    throw Error('Облачный ресурс не подтверждён.')
  await retainLibraryImage(owner, sha, blob, name, true)
}

// A reservation stays in place after any ambiguous failure; no automatic expiry.
// The storage lease serializes publication changes and private deletion requests.
export async function removePrivateResource(
  owner: string,
  row: WorkingResource,
  checkPublic: () => Promise<void>
) {
  if (
    owner !== currentWorkingOwner() ||
    row.bucket !== 'atlas-private-resources' ||
    row.path !== owner + '/' + row.sha ||
    !/^[0-9a-f]{64}$/.test(row.sha)
  )
    throw Error('Некорректный ресурс или аккаунт.')
  return withStorageLock(async (writer, token) => {
    await checkPublic()
    if (owner !== currentWorkingOwner()) throw Error('Изменился аккаунт.')
    const args = {
      expected_owner: owner,
      resource_sha: row.sha,
      delete_token: token,
    }
    const reserve = await db().rpc('atlas_resource_delete_begin', args)
    if (reserve.error) throw Error(reserve.error.message)
    if (reserve.data !== true)
      throw Error('Резервирование удаления не подтверждено.')
    const result = await writer(row.bucket).remove([row.path])
    checkStorageWrite(
      result.error,
      'Не удалось удалить приватный ресурс. Резервирование сохранено.'
    )
    const finish = await db().rpc('atlas_resource_delete_finish', args)
    if (finish.error || finish.data !== true)
      throw Error(
        finish.error?.message ??
          'Удаление не подтверждено. Резервирование сохранено.'
      )
  })
}

// Historical public copies remain physically separate. Only verified bytes may establish SHA identity.
export async function indexLegacyImages(owner:string,onLine?:(line:MigrationLine)=>void):Promise<MigrationLine[]> {
  if(owner!==currentWorkingOwner())throw Error('Изменился аккаунт.')
  const result:MigrationLine[]=[]
  for(const row of await resources()){
    if(row.bucket!=='images'||!['image/png','image/jpeg','image/webp'].includes(row.mime))continue
    const info={kind:'public-image',id:row.path,title:row.name}
    let line:MigrationLine
    try{
      if(owner!==currentWorkingOwner())throw Error('Изменился аккаунт.')
      await withStorageLock(async()=>{
        const fresh=await inventory().select('*').eq('bucket',row.bucket).eq('path',row.path).single()
        if(fresh.error||!fresh.data)throw Error('Публичный объект изменился или отсутствует.')
        const current=fresh.data as Resource
        const blob=await readLibraryLegacyImage(current)
        const sha=await digest(blob)
        await originalImage(blob)
        if(owner!==currentWorkingOwner())throw Error('Изменился аккаунт.')
        if(!current.sha){
          await register({...current,size:blob.size},sha)
          const check=await inventory().select('sha').eq('bucket',row.bucket).eq('path',row.path).single()
          if(check.error||check.data?.sha!==sha)throw Error('Индексирование не подтверждено.')
        }
        line={...info,status:current.sha?'verified':'migrated'}
      })
      result.push(line!);onLine?.(line!)
    }catch(error){line={...info,status:'error',detail:error instanceof Error?error.message:String((error as {message?:string})?.message??error)};result.push(line);onLine?.(line)}
  }
  return result
}
export async function auditCloudLibrary(owner:string,onLine?:(line:MigrationLine)=>void):Promise<MigrationLine[]>{
  if(owner!==currentWorkingOwner())throw Error('Изменился аккаунт.')
  const {data,error}=await db().rpc('atlas_resource_audit',{expected_owner:owner}).abortSignal(AbortSignal.timeout(30000))
  if(error||!Array.isArray(data))throw Error(error?.message??'Аудит не настроен. Примените resource-library-audit.sql.')
  const rows:MigrationLine[]=data.map((r:MigrationLine)=>({...r}))
  rows.forEach(r=>onLine?.(r))
  // Explicit deep verification: authenticated Storage download for each object, including fonts.
  for(const row of await workingResources(owner)){
    if(owner!==currentWorkingOwner())throw Error('Изменился аккаунт.')
    const info={kind:'private-asset',id:row.sha,title:row.path}
    let line:MigrationLine
    try{
      if(row.bucket!=='atlas-private-resources'||row.path!==owner+'/'+row.sha||! /^[0-9a-f]{64}$/.test(row.sha))throw Error('Некорректный путь ресурса.')
      const {data:blob,error:failure}=await db().storage.from(row.bucket).download(row.path,{}, {cache:'no-store',signal:AbortSignal.timeout(30000)})
      if(failure||!blob||await digest(blob)!==row.sha)throw Error(failure?.message??'Контрольная сумма не совпадает.')
      line={...info,status:'verified'}
    }catch(e){line={...info,status:'error',detail:e instanceof Error?e.message:String(e)}}
    rows.push(line);onLine?.(line)
  }
  return rows
}
