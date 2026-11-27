import { FileDialog } from './FileDialog'
import { useRef, useState } from 'react'
import {
  auditLocalAssets,
  auditLocalDocuments,
  currentWorkingOwner,
  migrateLocalLibrary,
  type MigrationLine,
} from './storage'
import {
  migrateCloudOnlyLibrary,
  recoverMaintenanceResource,
} from './workingSync'
import { auditCloudLibrary, indexLegacyImages } from './resources'

type Mode =
  | 'local-audit'
  | 'local-migrate'
  | 'cloud-migrate'
  | 'cloud-audit'
  | 'public-index'
const labels: Record<Mode, string> = {
  'local-audit': 'Проверить устройство',
  'local-migrate': 'Мигрировать локальные документы',
  'cloud-migrate': 'Мигрировать документы только в облаке',
  'cloud-audit': 'Проверить облако (SHA-256)',
  'public-index': 'Индексировать старые публичные изображения',
}
const statusLabels = {
  migrated: 'Мигрировано',
  verified: 'Проверено',
  skipped: 'Пропущено',
  error: 'Ошибка',
}
export function ResourceMaintenance({
  owner,
  online,
  onComplete,
  open,
  onClose,
}: {
  owner: string | null
  online: boolean
  onComplete: () => Promise<void>
  open: boolean
  onClose: () => void
}) {
  const [busy, setBusy] = useState<Mode | null>(null),
    [lines, setLines] = useState<MigrationLine[]>([]),
    [error, setError] = useState(''),
    [finished, setFinished] = useState(false)
  const lock = useRef(false)
  async function run(mode: Mode) {
    if (lock.current) return
    if (
      mode !== 'local-audit' &&
      mode !== 'cloud-audit' &&
      !confirm(
        'Запустить «' +
          labels[mode] +
          '»? Закройте редакторы во всех вкладках. Сначала экспортируйте важные документы. Изображения не удаляются.'
      )
    )
      return
    lock.current = true
    setBusy(mode)
    setLines([])
    setError('')
    setFinished(false)
    const all: MigrationLine[] = []
    const report = (line: MigrationLine) => {
      all.push(line)
      setLines([...all])
    }
    try {
      if (owner !== currentWorkingOwner()) throw Error('Изменился аккаунт.')
      if (mode === 'local-audit') {
        ;(await auditLocalDocuments(owner)).forEach(report)
        ;(await auditLocalAssets(owner)).forEach(report)
      } else if (mode === 'local-migrate') {
        await migrateLocalLibrary(
          owner,
          owner && online
            ? (sha) => recoverMaintenanceResource(owner, sha)
            : undefined,
          report
        )
      } else {
        if (!owner || !online)
          throw Error('Для этой операции нужны аккаунт и интернет.')
        if (mode === 'cloud-migrate')
          await migrateCloudOnlyLibrary(owner, report)
        if (mode === 'cloud-audit') await auditCloudLibrary(owner, report)
        if (mode === 'public-index') await indexLegacyImages(owner, report)
      }
      setFinished(true)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : String((e as { message?: string })?.message ?? e)
      )
    } finally {
      try {
        if (mode !== 'local-audit' && mode !== 'cloud-audit') await onComplete()
      } catch (e) {
        setError(
          (old) =>
            (old ? old + ' · ' : '') +
            'Не удалось обновить каталог: ' +
            String((e as { message?: string })?.message ?? e)
        )
      }
      lock.current = false
      setBusy(null)
    }
  }
  const download = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: 1,
            createdAt: new Date().toISOString(),
            finished,
            error,
            lines,
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = 'atlas-resource-audit.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  if (!open) return null
  return (
    <FileDialog title="Обслуживание библиотеки" close={onClose} locked={!!busy}>
      <div>
        <p className="files-note">
          Миграция не удаляет изображения, не создаёт облачные копии методичек и
          не меняет публикации. Проверка SHA скачивает облачные файлы целиком.
          Работайте в одной вкладке; закройте редакторы.
        </p>
        <div className="files-bar">
          {(Object.keys(labels) as Mode[]).map((mode) => (
            <button
              key={mode}
              className="secondary"
              disabled={
                !!busy ||
                ((mode === 'cloud-migrate' ||
                  mode === 'cloud-audit' ||
                  mode === 'public-index') &&
                  (!owner || !online))
              }
              onClick={() => void run(mode)}
            >
              {labels[mode]}
            </button>
          ))}
        </div>
        {busy && (
          <p role="status">
            {labels[busy]}… Обработано: {lines.length}
          </p>
        )}
        {finished && (
          <p role="status">
            Завершено. Мигрировано:{' '}
            {lines.filter((r) => r.status === 'migrated').length}; проверено:{' '}
            {lines.filter((r) => r.status === 'verified').length}; пропущено:{' '}
            {lines.filter((r) => r.status === 'skipped').length}; ошибок:{' '}
            {lines.filter((r) => r.status === 'error').length}.
          </p>
        )}
        {error && (
          <p className="files-error" role="alert">
            {error}
          </p>
        )}
        {!!lines.length && (
          <>
            <button className="secondary" onClick={download}>
              Скачать отчёт JSON
            </button>
            <details>
              <summary>Подробности ({lines.length})</summary>
              <div style={{ maxHeight: '20rem', overflow: 'auto' }}>
                {lines.map((line, i) => (
                  <p
                    key={line.kind + ':' + line.id + ':' + i}
                    className={
                      line.status === 'error' ? 'files-error' : 'files-note'
                    }
                  >
                    {statusLabels[line.status]} · {line.kind} · {line.title}
                    {line.detail ? ' — ' + line.detail : ''}
                  </p>
                ))}
              </div>
            </details>
          </>
        )}
      </div>
    </FileDialog>
  )
}
