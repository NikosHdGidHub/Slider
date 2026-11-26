import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { client } from './cloud'
import {
  acknowledgeCourseSync,
  appendCourseCommands,
  emptyCourseRecord,
  readCourseSnapshot,
  resolveCourseConflict,
  stageCourseSync,
  visibleCourses,
  type CourseAttempt,
  type CourseCommand,
  type CourseRecord,
  type CourseSnapshot,
} from './courseModel'
import {
  listenCourseChanges,
  readCourseRecord,
  updateCourseRecord,
} from './storage'

async function cloudRead(owner: string) {
  const { data, error } = await client!
    .rpc('atlas_get_courses', {
      expected_owner: owner,
    })
    .retry(false)
  if (error) throw error
  return readCourseSnapshot(data)
}

async function cloudWrite(owner: string, attempt: CourseAttempt) {
  const { snapshot } = attempt
  const { data, error } = await client!
    .rpc('atlas_save_courses', {
      expected_owner: owner,
      expected_revision: snapshot.revision,
      request_id: attempt.id,
      courses: snapshot.courses,
      lessons: snapshot.lessons,
    })
    .retry(false)
  if (error) throw error
  if (typeof data?.accepted !== 'boolean')
    throw Error('Некорректный ответ синхронизации курсов.')
  return {
    accepted: data.accepted as boolean,
    snapshot: readCourseSnapshot(data.snapshot),
  }
}

async function syncCourses(owner: string, active: () => boolean) {
  for (let step = 0; step < 4 && active(); step++) {
    const record = await readCourseRecord(owner)
    if (!active()) return
    const { attempt } = record
    if (!attempt) {
      const remote = await cloudRead(owner)
      if (!active()) return
      const id = crypto.randomUUID()
      await updateCourseRecord(owner, (current) => {
        if (
          current.attempt ||
          (!current.pending.length &&
            remote.revision === current.base.revision) ||
          (current.conflict && current.conflict.revision === remote.revision) ||
          remote.revision < current.base.revision
        )
          return current
        return stageCourseSync(current, remote, id)
      })
      if (!(await readCourseRecord(owner)).attempt) return
      continue
    }

    const response = await cloudWrite(owner, attempt)
    if (!active()) return
    await updateCourseRecord(owner, (current) => {
      if (current.attempt?.id !== attempt.id) return current
      return response.accepted
        ? acknowledgeCourseSync(current, attempt, response.snapshot)
        : stageCourseSync(
            { base: current.base, pending: current.pending },
            response.snapshot,
            crypto.randomUUID()
          )
    })
    const next = await readCourseRecord(owner)
    if (next.conflict || !next.pending.length) return
  }
}

function syncMessage(error: unknown) {
  const code = (error as { code?: string } | null)?.code
  if (code === 'PGRST202' || code === '42883')
    return 'Облако курсов недоступно. В Supabase требуется миграция courses.sql.'
  if (code === '42501' || code === 'PGRST301')
    return 'Синхронизация курсов ожидает входа преподавателя.'
  return 'Не удалось синхронизировать курсы. Изменения сохранены на устройстве.'
}

const initial = emptyCourseRecord()
export function useCourses(scope: string | null, online: boolean) {
  const [loaded, setLoaded] = useState<{
    scope: string
    record: CourseRecord
  }>()
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const retry = useRef<() => void>(() => {})
  const cloud = !!scope && scope !== 'local' && !!client
  const record = loaded?.scope === scope ? loaded.record : initial
  const snapshot = useMemo(() => visibleCourses(record), [record])

  useEffect(() => {
    setError('')
    setSyncing(false)
    if (!scope) return
    const owner = scope
    let live = true
    let running = false
    let reread = 0
    let timer: number | undefined
    function refresh() {
      const request = ++reread
      void readCourseRecord(owner)
        .then((record) => {
          if (live && request === reread) setLoaded({ scope: owner, record })
        })
        .catch(() => {
          if (live) setError('Хранилище курсов на устройстве недоступно.')
        })
    }
    function run() {
      if (!live || running || !cloud || !online) return
      running = true
      setSyncing(true)
      void syncCourses(owner, () => live && navigator.onLine)
        .then(() => {
          if (live) setError('')
        })
        .catch((err) => {
          if (live) setError(syncMessage(err))
        })
        .finally(() => {
          running = false
          if (!live) return
          setSyncing(false)
          refresh()
        })
    }
    function schedule() {
      refresh()
      if (!cloud || !online || running) return
      window.clearTimeout(timer)
      timer = window.setTimeout(run, 180)
    }
    const stop = listenCourseChanges(owner, schedule)
    retry.current = run
    refresh()
    run()
    const interval =
      cloud && online ? window.setInterval(run, 30_000) : undefined
    window.addEventListener('focus', run)
    return () => {
      live = false
      retry.current = () => {}
      stop()
      window.removeEventListener('focus', run)
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [scope, online, cloud])

  const change = useCallback(
    async (build: (snapshot: CourseSnapshot) => CourseCommand[]) => {
      if (!scope) throw Error('Войдите как преподаватель.')
      await updateCourseRecord(scope, (record) => {
        const commands = build(visibleCourses(record))
        return commands.length
          ? appendCourseCommands(record, commands, cloud)
          : record
      })
    },
    [scope, cloud]
  )
  const resolve = useCallback(
    async (choice: 'local' | 'remote') => {
      if (scope)
        await updateCourseRecord(scope, (record) =>
          resolveCourseConflict(record, choice)
        )
    },
    [scope]
  )

  return {
    snapshot,
    ready: loaded?.scope === scope,
    syncing,
    error,
    dirty: record.pending.length > 0,
    conflict: !!record.conflict,
    cloud,
    online,
    change,
    resolve,
    retry: () => retry.current(),
  }
}
export type CourseLibrary = ReturnType<typeof useCourses>
