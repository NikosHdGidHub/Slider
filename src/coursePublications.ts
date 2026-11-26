import { useEffect, useMemo, useState } from 'react'
import { listPublishedFiles, readPublic } from './cloud'
import { validateDeck } from './model'
import type { Entry } from './storage'

export function useCoursePublications(
  active: boolean,
  online: boolean,
  owner: boolean,
  stamp: number,
  local: Entry[]
) {
  const [files, setFiles] = useState<
    Awaited<ReturnType<typeof listPublishedFiles>>
  >([])
  const [cached, setCached] = useState(new Map<string, Entry>())
  const [failure, setFailure] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!owner) {
      setFiles([])
      setCached(new Map())
      setFailure(false)
      setLoading(false)
      return
    }
    if (!active || !online) return
    const signal = new AbortController()
    setLoading(true)
    setFailure(false)
    void listPublishedFiles(signal.signal)
      .then((files) => {
        if (!signal.signal.aborted) setFiles(files)
      })
      .catch(() => {
        if (!signal.signal.aborted) setFailure(true)
      })
      .finally(() => {
        if (!signal.signal.aborted) setLoading(false)
      })
    return () => signal.abort()
  }, [active, online, owner, stamp])

  const ids = useMemo(
    () => new Set(local.map(({ deck }) => deck.id.toLowerCase())),
    [local]
  )
  useEffect(() => {
    if (!active || !online || !owner) return
    const pending = files.filter(
      (file) =>
        !ids.has(file.id.toLowerCase()) &&
        cached.get(file.id)?.updated !== file.updated
    )
    if (!pending.length) return
    const signal = new AbortController()
    setLoading(true)
    void (async () => {
      let failed = false
      let index = 0
      const found = new Map<string, Entry>()
      async function worker() {
        for (
          let file = pending[index++];
          file && !signal.signal.aborted;
          file = pending[index++]
        ) {
          try {
            const deck = validateDeck(await readPublic(file.id, signal.signal))
            if (deck.id !== file.id) throw Error('Неверный UUID публикации.')
            found.set(file.id, { deck, updated: file.updated, revision: 0 })
          } catch {
            failed = true
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(4, pending.length) }, worker)
      )
      if (!signal.signal.aborted) {
        setCached((last) => new Map([...last, ...found]))
        if (failed) setFailure(true)
        setLoading(false)
      }
    })()
    return () => signal.abort()
    // Cached entries are a snapshot for this fetch; changing the course structure never reloads documents.
  }, [active, online, owner, files, ids, stamp])

  const published = useMemo(
    () => new Set(owner ? files.map(({ id }) => id.toLowerCase()) : []),
    [files, owner]
  )
  const remote = useMemo(
    () =>
      owner && online
        ? files.flatMap(({ id }) => {
            const row = !ids.has(id.toLowerCase()) && cached.get(id)
            return row ? [row] : []
          })
        : [],
    [owner, online, files, ids, cached]
  )
  return { published, remote, failure, loading: owner && online && loading }
}
