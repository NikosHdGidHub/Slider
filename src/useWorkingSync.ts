import { useEffect, useRef, useState } from 'react'
import { listenWorkingChanges, workingRecords } from './storage'
import { syncWorking, workingKey, workingPresence } from './workingSync'
import type { WorkingKind, WorkingRecord } from './workingDocument'

type State = {
  owner: string | null
  records: WorkingRecord[]
  syncing: boolean
  checked: boolean
  errors: string[]
  lastSuccess?: number
}
const initial = (owner: string | null): State => ({
  owner,
  records: [],
  syncing: false,
  checked: false,
  errors: [],
})

export function useWorkingSync(
  owner: string | null,
  online: boolean,
  authenticated: boolean,
  kind?: WorkingKind,
  docId?: string
) {
  const [state, setState] = useState<State>(() => initial(owner))
  const retry = useRef<() => void>(() => {})
  const active = useRef<string | undefined>(undefined)
  const [presence, setPresence] = useState<string>()
  const key = kind && docId ? workingKey(kind, docId) : undefined
  active.current = key
  useEffect(() => {
    if (!owner) {
      setState(initial(owner))
      return
    }
    let live = true,
      running = false,
      requested = false,
      failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    setState((prior) =>
      prior.owner === owner ? { ...prior, syncing: false } : initial(owner)
    )
    async function inspect() {
      const records = await workingRecords(owner!)
      if (live) setState((prior) => ({ ...prior, records }))
      return records
    }
    function schedule(delay = 400) {
      clearTimeout(timer)
      if (running) {
        requested = true
        return
      }
      if (online && authenticated) timer = setTimeout(run, delay)
    }
    function localChange() {
      void inspect().catch((error) => {
        if (live) setState((prior) => ({ ...prior, errors: [String(error)] }))
      })
      schedule()
    }
    async function run() {
      if (!live || running) return
      running = true
      requested = false
      setState((prior) => ({ ...prior, syncing: true }))
      let errors: string[] = []
      try {
        errors = await syncWorking(
          owner!,
          () => active.current,
          () => live
        )
      } catch (error) {
        errors = [error instanceof Error ? error.message : String(error)]
      }
      if (live) {
        try {
          const records = await inspect()
          if (live)
            setState((prior) => ({
              ...prior,
              syncing: false,
              checked: true,
              errors,
              lastSuccess:
                !errors.length && !records.some((r) => r.dirty)
                  ? Date.now()
                  : prior.lastSuccess,
            }))
        } catch (error) {
          if (live)
            setState((prior) => ({
              ...prior,
              syncing: false,
              checked: true,
              errors: [String(error)],
            }))
        }
      }
      running = false
      if (!live) return
      failures = errors.length ? failures + 1 : 0
      schedule(
        requested && !failures
          ? 400
          : failures
            ? Math.min(120000, 5000 * 2 ** Math.min(failures - 1, 5))
            : 30000
      )
    }
    const focus = () => {
      if (document.visibilityState === 'visible') schedule(0)
    }
    const unlisten = listenWorkingChanges(owner, localChange)
    document.addEventListener('visibilitychange', focus)
    window.addEventListener('focus', focus)
    localChange()
    retry.current = () => {
      void inspect().catch(() => {})
      schedule(0)
    }
    return () => {
      live = false
      clearTimeout(timer)
      unlisten()
      retry.current = () => {}
      document.removeEventListener('visibilitychange', focus)
      window.removeEventListener('focus', focus)
    }
  }, [owner, online, authenticated])

  useEffect(() => {
    if (!owner || !authenticated || !online || !docId || !kind || !key) return
    let live = true
    const session = crypto.randomUUID()
    const tick = () => {
      void workingPresence(owner, kind, docId, session, false)
        .then((editing) => {
          if (live) setPresence(editing ? key : undefined)
        })
        .catch(() => {
          if (live) setPresence(undefined)
        })
    }
    tick()
    const timer = setInterval(tick, 30000)
    return () => {
      live = false
      clearInterval(timer)
      setPresence(undefined)
      if (navigator.onLine)
        void workingPresence(owner, kind, docId, session, true).catch(() => {})
    }
  }, [owner, authenticated, online, key, kind, docId])
  useEffect(() => {
    if (!key) retry.current()
  }, [key])
  return {
    ...(state.owner === owner ? state : initial(owner)),
    retry: () => retry.current(),
    presence: !!key && presence === key,
  }
}
