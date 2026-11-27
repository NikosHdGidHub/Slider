import { useEffect, useMemo, useState } from 'react'
import { savedPublicCatalog } from './storage'
import { publicationCatalog, type PublishedRow } from './publicationCatalog'

export function useCoursePublications(
  pane: 'library' | 'published' | null,
  online: boolean,
  owner: string | null,
  authorized: boolean,
  stamp: number
) {
  const [state, setState] = useState<{
    owner: string | null
    rows: PublishedRow[]
  }>({ owner: null, rows: [] })
  const [failure, setFailure] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!owner) {
      setState({ owner: null, rows: [] })
      setFailure(false)
      setLoading(false)
      return
    }
    if (!pane) return
    const controller = new AbortController()
    const signal = controller.signal
    setLoading(online && authorized)
    setFailure(false)
    void (async () => {
      if (!online || !authorized) {
        const rows = await savedPublicCatalog(owner)
        if (!signal.aborted) setState({ owner, rows })
        return
      }
      const rows = await publicationCatalog(owner, signal)
      if (signal.aborted) return
      setState({ owner, rows })
      await savedPublicCatalog(owner, rows)
    })()
      .catch(() => {
        if (!signal.aborted) setFailure(true)
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [pane, online, owner, authorized, stamp])
  const published = useMemo(
    () => new Set(state.owner === owner ? state.rows.map(({ id }) => id) : []),
    [state, owner]
  )
  return {
    published,
    rows: state.owner === owner ? state.rows : [],
    failure: !!owner && online && failure,
    loading: !!owner && online && loading,
    checked:
      state.owner === owner &&
      !!owner &&
      online &&
      authorized &&
      !loading &&
      !failure,
  }
}
