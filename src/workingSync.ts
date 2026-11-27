import { client } from './cloud'
import { copyDeck } from './catalog'
import { digest } from './digest'
import {
  addWorkingMetadata,
  localWorkingDocument,
  registerWorking,
  updateWorking,
  workingAsset,
  workingRecords,
} from './storage'
import {
  packWorking,
  unpackWorking,
  workingDeck,
  type WorkingAttempt,
  type WorkingDocument,
  type WorkingKind,
  type WorkingMeta,
  type WorkingRecord,
} from './workingDocument'

const bucket = 'atlas-private-resources'
const initialized = new Map<string, Promise<void>>()
export const workingKey = (kind: WorkingKind, id: string) =>
  kind + ':' + id.toLowerCase()

class WorkingRemoteError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
  }
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!client) throw Error('Облако не настроено.')
  const { data, error } = await client
    .rpc(name, args)
    .retry(false)
    .abortSignal(AbortSignal.timeout(20000))
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883')
      throw Error(
        'Рабочая библиотека не настроена в Supabase. Примените cloud-sync.sql.'
      )
    throw new WorkingRemoteError(error.message, error.code)
  }
  return data as T
}
function sameAttempt(
  record: WorkingRecord | undefined,
  attempt: WorkingAttempt
) {
  return record?.attempt?.request === attempt.request
}
function clean(
  meta: WorkingMeta,
  generation = 0,
  localId?: string
): WorkingRecord {
  return {
    id: meta.id,
    kind: meta.kind,
    base: meta.revision,
    generation,
    localId,
    dirty: false,
    deleted: !!meta.deleted,
    meta,
  }
}

async function downloadAsset(owner: string, sha: string) {
  if (!client) throw Error('Облако не настроено.')
  const { data, error } = await client.storage
    .from(bucket)
    .download(owner + '/' + sha)
  if (error || !data)
    throw Error(error?.message ?? 'Приватный ресурс недоступен.')
  if ((await digest(data)) !== sha)
    throw Error('Получен повреждённый приватный ресурс.')
  await workingAsset(owner, sha, { blob: data, uploaded: true })
  return data
}
async function uploadAsset(owner: string, sha: string, force = false) {
  if (!client) throw Error('Облако не настроено.')
  const asset = await workingAsset(owner, sha)
  if (!asset) throw Error('Приватный ресурс отсутствует на устройстве.')
  if (asset.uploaded && !force) return
  const { error } = await client.storage
    .from(bucket)
    .upload(owner + '/' + sha, asset.blob, {
      upsert: false,
      cacheControl: '0',
    })
  if (error) {
    // A lost response or a concurrent upload may have already created the immutable object.
    await downloadAsset(owner, sha)
    return
  }
  await workingAsset(owner, sha, { ...asset, uploaded: true })
}

async function readWorking(owner: string, kind: WorkingKind, id: string) {
  return rpc<{ meta: WorkingMeta; document: WorkingDocument | null } | null>(
    'atlas_working_get',
    { expected_owner: owner, doc_kind: kind, doc_id: id }
  )
}
export async function workingMetadata(
  owner: string,
  kind: WorkingKind,
  id: string
) {
  return (await readWorking(owner, kind, id))?.meta
}
export async function fetchWorking(
  owner: string,
  kind: WorkingKind,
  id: string
) {
  const reply = await readWorking(owner, kind, id)
  if (!reply) throw Error('Облачный документ не найден.')
  const source = reply.document
  const document =
    source &&
    (await unpackWorking(
      reply.meta,
      source,
      async (sha) =>
        (await workingAsset(owner, sha))?.blob ?? downloadAsset(owner, sha)
    ))
  return { ...reply, document, source }
}

async function adopt(
  owner: string,
  meta: WorkingMeta,
  prior?: WorkingRecord,
  enabled = () => true
) {
  const remote = meta.deleted
    ? null
    : await fetchWorking(owner, meta.kind, meta.id)
  if (remote && (remote.meta.revision !== meta.revision || !remote.document))
    throw Error('Облачный документ снова изменился. Повторите синхронизацию.')
  const document = remote?.document ?? undefined
  return updateWorking(
    owner,
    meta.kind,
    meta.id,
    (current) => {
      if (
        !enabled() ||
        current?.generation !== prior?.generation ||
        current?.dirty ||
        (current?.base ?? 0) > meta.revision
      )
        return current
      return clean(
        meta,
        prior?.generation,
        document ? workingDeck(document).id : prior?.localId
      )
    },
    { document, original: remote?.source }
  )
}

async function runRecord(
  owner: string,
  row: WorkingRecord,
  remote: WorkingMeta | undefined
) {
  let attempt = row.attempt
  if (!attempt) {
    const local = await localWorkingDocument(owner, row)
    if (!local) throw Error('Черновик для отправки недоступен на устройстве.')
    const packed = await packWorking(row.kind, local)
    const matches =
      remote &&
      !remote.deleted &&
      !row.deleted &&
      (remote.hash === packed.hash ||
        (!remote.hash &&
          (await (async () => {
            const saved = await fetchWorking(owner, row.kind, row.id)
            return (
              saved.meta.revision === remote.revision &&
              saved.document &&
              (await packWorking(row.kind, saved.document)).hash === packed.hash
            )
          })())))
    if (matches && remote?.hash) {
      await updateWorking(owner, row.kind, row.id, (current) =>
        current?.generation === row.generation && !current.attempt
          ? clean(remote, row.generation, row.localId)
          : current
      )
      return
    }
    if (remote && row.base !== remote.revision && !matches) {
      await updateWorking(owner, row.kind, row.id, (current) =>
        current?.generation === row.generation && !current.attempt
          ? { ...current, conflict: remote, meta: remote }
          : current
      )
      return
    }
    for (const [sha, blob] of packed.assets)
      await workingAsset(owner, sha, { blob, uploaded: false })
    const prepared: WorkingAttempt = {
      request: crypto.randomUUID(),
      generation: row.generation,
      base: remote?.revision ?? row.base ?? 0,
      document: packed.document,
      hash: packed.hash,
      refs: [...packed.assets.keys()],
      deleted: row.deleted,
    }
    if (
      !(await updateWorking(owner, row.kind, row.id, (current) =>
        current?.generation === row.generation &&
        !current.attempt &&
        !current.conflict
          ? { ...current, attempt: prepared }
          : current
      ))
    )
      return
    attempt = prepared
  }
  for (const sha of attempt.refs) await uploadAsset(owner, sha)
  let reply: { accepted: boolean; committed?: number; meta: WorkingMeta | null }
  try {
    reply = await rpc('atlas_working_save', {
      expected_owner: owner,
      doc_kind: row.kind,
      doc_id: row.id,
      expected_revision: attempt.base,
      mutation: attempt.request,
      payload: attempt.document,
      payload_hash: attempt.hash,
      refs: attempt.refs,
      remove_doc: attempt.deleted,
    })
  } catch (error) {
    if (error instanceof WorkingRemoteError && error.code === '23503')
      for (const sha of attempt.refs) await uploadAsset(owner, sha, true)
    throw error
  }
  const submitted = attempt
  await updateWorking(owner, row.kind, row.id, (current) => {
    if (!current || !sameAttempt(current, submitted)) return current
    if (
      !reply.accepted &&
      reply.meta?.hash === submitted.hash &&
      !!reply.meta.deleted === submitted.deleted
    ) {
      if (current.generation !== submitted.generation)
        return {
          ...current,
          base: reply.meta.revision,
          meta: reply.meta,
          attempt: undefined,
        }
      return clean(reply.meta, current.generation, current.localId)
    }
    if (!reply.accepted || !reply.meta) {
      if (!reply.meta) throw Error('Облачная ревизия недоступна.')
      return {
        ...current,
        attempt: undefined,
        conflict: reply.meta,
        meta: reply.meta,
      }
    }
    const committed = reply.committed!
    if (current.generation !== submitted.generation)
      return {
        ...current,
        base: committed,
        meta: reply.meta,
        attempt: undefined,
      }
    return {
      ...clean(reply.meta, current.generation, current.localId),
      base: committed,
    }
  })
}

export async function syncWorking(
  owner: string,
  active: () => string | undefined,
  stillActive: () => boolean
) {
  if (!initialized.has(owner))
    initialized.set(
      owner,
      registerWorking(owner).catch((error) => {
        initialized.delete(owner)
        throw error
      })
    )
  await initialized.get(owner)
  const catalog = await rpc<WorkingMeta[]>('atlas_working_list', {
    expected_owner: owner,
  })
  if (!stillActive()) return []
  const cloud = new Map(
    catalog.map((meta) => [workingKey(meta.kind, meta.id), meta])
  )
  const failures: string[] = []
  for (const row of await workingRecords(owner)) {
    if (!stillActive() || !navigator.onLine) break
    const key = workingKey(row.kind, row.id)
    const meta = cloud.get(key)
    try {
      if (row.conflict) {
        if (meta && meta.revision !== row.conflict.revision)
          await updateWorking(owner, row.kind, row.id, (current) =>
            current?.conflict ? { ...current, conflict: meta, meta } : current
          )
        continue
      }
      if (row.dirty) {
        await runRecord(owner, row, meta)
      } else if (meta && meta.revision > (row.base ?? 0) && active() !== key) {
        if (row.localId)
          await adopt(owner, meta, row, () => stillActive() && active() !== key)
        else
          await updateWorking(owner, row.kind, row.id, (current) =>
            current && !current.dirty && (current.base ?? 0) < meta.revision
              ? clean(meta, current.generation, current.localId)
              : current
          )
      }
    } catch (error) {
      failures.push(
        (row.title ?? meta?.title ?? row.id) +
          ' — ' +
          (error instanceof Error ? error.message : String(error))
      )
    }
    cloud.delete(key)
  }
  if (stillActive())
    await addWorkingMetadata(
      owner,
      Array.from(cloud.values(), (meta) => clean(meta))
    )
  return failures
}

export async function openWorking(owner: string, meta: WorkingMeta) {
  const existing = (await workingRecords(owner)).find(
    (row) => row.id === meta.id && row.kind === meta.kind
  )
  if (existing?.dirty) {
    const local = await localWorkingDocument(owner, existing)
    if (local && !existing.deleted) return
    throw Error('Сначала разрешите незавершённое изменение этого документа.')
  }
  if (!(await adopt(owner, meta, existing)) && !existing)
    throw Error('Документ изменился в другой вкладке. Обновите библиотеку.')
}

export async function resolveWorking(
  owner: string,
  row: WorkingRecord,
  choice: 'local' | 'remote' | 'both' | 'restore'
) {
  const shown = row.conflict ?? row.meta
  if (!shown) throw Error('Облачная версия недоступна.')
  const remote = await fetchWorking(owner, row.kind, row.id)
  if (remote.meta.revision !== shown.revision)
    throw Error('Облачная версия изменилась. Обновите панель.')
  if (choice === 'restore' && (!shown.restorable || !remote.document))
    throw Error('Срок восстановления истёк.')
  const backup = await localWorkingDocument(owner, row)
  const keepLocal = choice === 'local'
  const restore = choice === 'restore'
  const document =
    shown.deleted && !restore ? undefined : (remote.document ?? undefined)
  const localId = document ? workingDeck(document).id : row.localId
  let copy: WorkingDocument | undefined
  if (choice === 'both' && backup) {
    const original = workingDeck(backup)
    const deck = copyDeck(
      original,
      original.title.slice(0, 970) + ' — локальная копия'
    )
    copy = 'deck' in backup ? { ...backup, deck } : deck
  }
  const changed = await updateWorking(
    owner,
    row.kind,
    row.id,
    (current) => {
      if (
        !current ||
        current.generation !== row.generation ||
        (current.conflict ?? current.meta)?.revision !== shown.revision
      )
        return current
      if (keepLocal)
        return {
          ...current,
          attempt: undefined,
          conflict: undefined,
          base: shown.revision,
          generation: current.generation + 1,
        }
      const next = clean(shown, current.generation + 1, localId)
      return restore ? { ...next, dirty: true, deleted: false } : next
    },
    keepLocal
      ? { preserve: true, backup: remote.document ?? undefined }
      : { document, backup, copy, original: remote.source }
  )
  if (!changed) throw Error('Локальный документ изменился. Обновите панель.')
}

export function workingPresence(
  owner: string,
  kind: WorkingKind,
  id: string,
  session: string,
  release: boolean
) {
  return rpc<boolean>('atlas_working_editing', {
    expected_owner: owner,
    doc_kind: kind,
    doc_id: id,
    session_id: session,
    release,
  })
}
