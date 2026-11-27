import { Cloud, CloudAlert, CloudCheck, CloudOff, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { CourseLibrary } from './courseSync'
import { localWorkingDocument, workingBackups } from './storage'
import { workingDeck, type WorkingRecord } from './workingDocument'
import { fetchWorking, resolveWorking } from './workingSync'
import type { useWorkingSync } from './useWorkingSync'
import type { Deck } from './model'
import { download } from './instructions'

type Sync = ReturnType<typeof useWorkingSync>
export function syncSummary(sync: Sync, courses: CourseLibrary, online: boolean, authorized: boolean, local: boolean) {
  const conflicts = sync.records.filter((row) => row.conflict).length + Number(courses.conflict)
  const pending = sync.records.filter((row) => row.dirty).length + courses.pending
  const error = sync.errors.length || courses.error
  if (conflicts) return { label: 'Обнаружен конфликт', Icon: CloudAlert }
  if (!online) return { label: 'Офлайн', Icon: CloudOff }
  if (local) return { label: 'На этом устройстве', Icon: CloudOff }
  if (!authorized) return { label: 'Требуется вход', Icon: CloudOff }
  if (sync.syncing || courses.syncing) return { label: 'Синхронизация…', Icon: RefreshCw }
  if (error) return { label: 'Ошибка синхронизации', Icon: CloudAlert }
  if (pending) return { label: 'Ожидают отправки', Icon: Cloud }
  return sync.checked && courses.checked
    ? { label: 'Синхронизировано', Icon: CloudCheck }
    : { label: 'Проверяем облако…', Icon: Cloud }
}

export function WorkingSyncPanel({
  owner, sync, courses, online, authorized, local, inEditor, retry, notice, view, openCourses, login,
}: {
  owner: string | null
  sync: Sync
  courses: CourseLibrary
  online: boolean
  authorized: boolean
  local: boolean
  inEditor: boolean
  retry: () => void
  notice: (message: string) => void
  view: (deck: Deck) => void
  openCourses: () => void
  login: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [detail, select] = useState<string>()
  const conflicts = sync.records.filter((row) => row.conflict)
  const trash = sync.records.filter((row) => row.meta?.restorable && row.deleted && !row.dirty)
  const pending = sync.records.filter((row) => row.dirty)
  const number = (rows: WorkingRecord[]) => rows.filter((row) => !row.conflict).length + ' ожид. · ' +
    rows.filter((row) => row.conflict).length + ' конфл.'
  async function run(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try { await fn() } catch (error) {
      notice(error instanceof Error ? error.message : 'Не удалось завершить действие.')
    } finally { setBusy(false) }
  }
  const categories = [
    ['Методички', number(pending.filter((row) => row.kind === 'lesson'))],
    ['Курсы', courses.conflict ? 'Конфликт' : courses.error ? courses.error : courses.pending + ' ожид.'],
    ['Шаблоны оформления', number(pending.filter((row) => row.kind === 'template' && (row.templateKind ?? row.meta?.templateKind) !== 'layout'))],
    ['Шаблоны разметки', number(pending.filter((row) => row.kind === 'template' && (row.templateKind ?? row.meta?.templateKind) === 'layout'))],
    ['Файлы и ресурсы', 'Передаются вместе с документами'],
  ]
  return (
    <div className="working-panel">
      <strong role="status">{syncSummary(sync, courses, online, authorized, local).label}</strong>
      <dl>{categories.map(([label, status]) => <div key={label}><dt>{label}</dt><dd>{status}</dd></div>)}</dl>
      <p>Ожидают отправки: {pending.length + courses.pending} · Конфликты: {conflicts.length + Number(courses.conflict)}</p>
      {sync.lastSuccess && <p>Последняя успешная синхронизация {new Date(sync.lastSuccess).toLocaleString('ru-RU')}</p>}
      {sync.errors.length > 0 && <ul role="alert">{sync.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
      {courses.conflict && <button className="secondary" onClick={openCourses} disabled={inEditor}>Разрешить конфликт курсов</button>}
      {!authorized && !local && online && <button className="secondary" onClick={login}>Войти</button>}
      <button className="primary" onClick={retry} disabled={!online || !authorized || sync.syncing}>Синхронизировать сейчас</button>
      {inEditor && conflicts.length > 0 && <p>Завершите редактирование, чтобы разрешить конфликт.</p>}
      {owner && conflicts.map((row) => {
        const key = row.kind + row.id
        return <div className="working-item" key={key}>
          <button className="secondary" aria-expanded={detail === key} onClick={() => select(detail === key ? undefined : key)}>
            {row.conflict!.title}
          </button>
          {detail === key && <>
            <h3>Конфликт версий</h3>
            <p>{row.kind === 'lesson' ? 'Методичка' : row.templateKind === 'layout' ? 'Шаблон разметки' : 'Шаблон оформления'}</p>
            <dl>
              <div><dt>На устройстве</dt><dd>{row.title ?? row.conflict!.title}
                {row.localSlides && ' · слайдов: ' + row.localSlides}
                {row.localUpdated && ' · ' + new Date(row.localUpdated).toLocaleString('ru-RU')}</dd></div>
              <div><dt>В облаке</dt><dd>{row.conflict!.title} · ревизия {row.conflict!.revision}
                {' · слайдов: ' + row.conflict!.slides} · {new Date(row.conflict!.updated).toLocaleString('ru-RU')}
                {row.conflict!.deleted && ' · удалён'}</dd></div>
            </dl>
            <div className="working-actions">
              <button disabled={busy || inEditor} onClick={() => void run(async () => {
                const payload = await localWorkingDocument(owner, row)
                if (!payload) throw Error('Локальная версия недоступна.')
                view(workingDeck(payload))
              })}>Просмотреть локальную</button>
              <button disabled={busy || !online || inEditor || !!row.conflict!.deleted} onClick={() => void run(async () => {
                const { document } = await fetchWorking(owner, row.kind, row.id)
                if (!document) throw Error('Облачная версия недоступна.')
                view(workingDeck(document))
              })}>Просмотреть облачную</button>
              {([
                ['local', 'Оставить локальную'],
                ['remote', 'Принять облачную'],
                ['both', 'Сохранить обе'],
              ] as const).map(([choice, label]) => <button key={choice}
                disabled={busy || !online || inEditor}
                onClick={() => void run(async () => {
                  await resolveWorking(owner, row, choice)
                  retry()
                })}>{label}</button>)}
            </div>
          </>}
        </div>
      })}
      {owner && trash.length > 0 && <div className="working-item">
        <h3>Недавно удалённые</h3>
        {trash.map((row) => <button className="secondary" key={row.kind + row.id}
          disabled={!online || busy || inEditor} onClick={() => void run(async () => {
            await resolveWorking(owner, row, 'restore')
            retry()
          })}>Восстановить «{row.meta!.title}»</button>)}
      </div>}
      {owner && <button className="secondary" disabled={busy} onClick={() => void run(async () => {
        const backups = await workingBackups(owner)
        if (!backups.length) return notice('Временных резервных копий на этом устройстве пока нет.')
        download('atlas-sync-backups.json', JSON.stringify(backups, null, 2))
      })}>Экспорт временных резервных копий</button>}
    </div>
  )
}
