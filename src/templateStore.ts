import { client } from './cloud'
import { builtins, validateTemplate, type Template } from './catalog'
import { localTemplates, writeTemplate, type TemplateEntry } from './storage'
export interface CatalogRow {
  template: Template
  entry?: TemplateEntry
  remote?: number
  builtin?: boolean
}
export async function getCatalog(
  allowed: boolean,
  cloud: boolean
): Promise<{ rows: CatalogRow[]; connection?: 'offline' | 'error' }> {
  const rows: CatalogRow[] = builtins.map((template) => ({
    template,
    builtin: true,
  }))
  if (!allowed) return { rows }
  const local = await localTemplates()
  const user = new Map<string, CatalogRow>(
    local.map((entry) => [
      entry.template.deck.id,
      { template: entry.template, entry },
    ])
  )
  let connection: 'offline' | 'error' | undefined
  if (cloud && client && navigator.onLine) {
    const remote: CatalogRow[] = []
    try {
      for (let offset = 0; ; offset += 20) {
        const { data, error } = await client
          .from('atlas_templates')
          .select('id,revision,document')
          .order('id')
          .range(offset, offset + 19)
        if (error) throw error
        for (const row of data ?? []) {
          const template = validateTemplate(row.document)
          if (template.deck.id !== row.id)
            throw new Error('Некорректный ID в облаке')
          remote.push({ template, remote: row.revision })
        }
        if (data.length < 20) break
      }
      for (const row of remote) {
        const id = row.template.deck.id,
          cache = user.get(id)?.entry
        if (cache?.dirty) {
          user.set(id, {
            template: cache.template,
            entry: cache,
            remote: row.remote,
          })
          continue
        }
        if (cache?.cloudRevision === row.remote) {
          user.set(id, { ...row, entry: cache })
          continue
        }
        const entry = {
          template: row.template,
          revision: cache?.revision ?? 0,
          cloudRevision: row.remote!,
          dirty: false,
        }
        await writeTemplate(entry)
        user.set(id, {
          ...row,
          entry: { ...entry, revision: entry.revision + 1 },
        })
      }
      const available = new Set(remote.map((r) => r.template.deck.id))
      for (const entry of local) {
        const id = entry.template.deck.id
        if (!entry.cloudRevision || available.has(id)) continue
        if (entry.dirty) {
          const recovered = { ...entry, cloudRevision: 0 }
          await writeTemplate(recovered)
          user.set(id, {
            template: entry.template,
            entry: { ...recovered, revision: entry.revision + 1 },
          })
        } else {
          await writeTemplate(entry, true)
          user.delete(id)
        }
      }
    } catch {
      connection = 'error'
    }
  } else if (cloud) connection = 'offline'
  return { rows: [...rows, ...user.values()], connection }
}
export async function saveLocal(template: Template, row?: CatalogRow) {
  if (row?.builtin) throw new Error('Для встроенного шаблона создайте копию.')
  const entry = row?.entry
  await writeTemplate({
    template: validateTemplate(template),
    revision: entry?.revision ?? 0,
    cloudRevision: entry?.cloudRevision ?? 0,
    dirty: true,
  })
}
export async function syncTemplate(row: CatalogRow) {
  if (!client || !row.entry || row.builtin)
    throw new Error('Сначала сохраните пользовательский шаблон локально.')
  const { template, cloudRevision: rev } = row.entry
  const table = client.from('atlas_templates'),
    id = template.deck.id
  const result = rev
    ? await table
        .update({ document: template, revision: rev + 1 })
        .eq('id', id)
        .eq('revision', rev)
        .select('id')
        .single()
    : await table
        .insert({ id, revision: 1, document: template })
        .select('id')
        .single()
  if (result.error)
    throw new Error(
      'Облако отклонило запись. Проверьте версию шаблона и доступ владельца. ' +
        result.error.message
    )
  await writeTemplate({ ...row.entry, dirty: false, cloudRevision: rev + 1 })
}
export async function deleteTemplate(row: CatalogRow) {
  if (!row.entry || row.builtin) throw new Error('Встроенный шаблон защищён.')
  if (row.entry.cloudRevision) {
    if (!client || !navigator.onLine)
      throw new Error('Для удаления облачной копии восстановите подключение.')
    const { error } = await client
      .from('atlas_templates')
      .delete()
      .eq('id', row.template.deck.id)
      .eq('revision', row.entry.cloudRevision)
      .select('id')
      .single()
    if (error)
      throw new Error(
        'Облачная копия изменилась или недоступна. ' + error.message
      )
  }
  await writeTemplate(row.entry, true)
}
