import { builtins, validateTemplate, type Template } from './catalog'
import { FORMAT_VERSION } from './schema'
import {
  currentWorkingOwner,
  localTemplates,
  workingRecords,
  writeTemplate,
  type TemplateEntry,
} from './storage'
import { workingCardDeck, type WorkingMeta } from './workingDocument'
import { openWorking, removeWorkingCloud } from './workingSync'

export interface CatalogRow {
  template: Template
  entry?: TemplateEntry
  remote?: number
  meta?: WorkingMeta
  builtin?: boolean
}

export async function getCatalog(allowed: boolean) {
  const rows: CatalogRow[] = builtins.map((template) => ({
    template,
    builtin: true,
  }))
  if (!allowed) return { rows }
  const owner = currentWorkingOwner()
  const [local, state] = await Promise.all([
    localTemplates(),
    owner ? workingRecords(owner) : [],
  ])
  const user = new Map<string, CatalogRow>()
  const sync = new Map(
    state
      .filter((item) => item.kind === 'template')
      .map((item) => [item.id, item])
  )
  for (const entry of local) {
    const id = entry.template.deck.id.toLowerCase()
    const status = sync.get(id)
    user.set(id, {
      template: entry.template,
      entry: status
        ? { ...entry, dirty: status.dirty, cloudRevision: status.base ?? 0 }
        : entry,
      remote:
        status?.meta && !status.meta.deleted ? status.meta.revision : undefined,
    })
  }
  for (const status of sync.values()) {
    const meta = status.meta
    if (
      !meta ||
      !meta.templateKind ||
      status.dirty ||
      user.has(meta.id) ||
      meta.deleted
    )
      continue
    const deck = workingCardDeck(meta.id, meta.title)
    user.set(status.id, {
      template: {
        kind: meta.templateKind,
        description: '',
        deck,
        format:
          meta.templateFormat === FORMAT_VERSION ? FORMAT_VERSION : undefined,
      },
      meta,
      remote: meta.revision,
    })
  }
  return { rows: [...rows, ...user.values()] }
}

export async function loadCatalogRow(row: CatalogRow): Promise<CatalogRow> {
  if (!row.meta) return row
  const owner = currentWorkingOwner()
  if (!owner) throw Error('Для открытия шаблона войдите как преподаватель.')
  await openWorking(owner, row.meta)
  const entry = (await localTemplates()).find(
    (item) => item.template.deck.id.toLowerCase() === row.meta?.id
  )
  if (!entry) throw Error('Не удалось открыть шаблон на устройстве.')
  return { template: entry.template, entry, remote: row.meta.revision }
}

export async function saveLocal(template: Template, row?: CatalogRow) {
  if (row?.builtin) throw new Error('Для встроенного шаблона создайте копию.')
  await writeTemplate({
    template: validateTemplate(template),
    revision: row?.entry?.revision ?? 0,
    cloudRevision: row?.entry?.cloudRevision ?? 0,
    dirty: true,
  })
}

export async function deleteTemplate(row: CatalogRow, cloud = false) {
  if (row.builtin) throw Error('Встроенный шаблон защищён.')

  if (cloud) {
    const owner = currentWorkingOwner()

    if (!owner) throw Error('Необходимо войти в аккаунт.')

    await removeWorkingCloud(owner, 'template', row.template.deck.id)

    return
  }

  if (!row.entry) throw Error('Локальная копия отсутствует.')

  await writeTemplate(row.entry, true)
}
