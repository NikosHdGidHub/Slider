import { useEffect, useMemo, useState } from 'react'
import { publicationCatalog, type PublishedRow } from './publicationCatalog'

export function useCoursePublications(active: boolean, online: boolean, owner: string | null, stamp: number) {
  const [state, setState] = useState<{ owner: string | null; rows: PublishedRow[] }>({ owner: null, rows: [] })
  const [failure, setFailure] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!owner) {
      setState({ owner: null, rows: [] })
      setFailure(false)
      setLoading(false)
      return
    }
    if (!active || !online) return
    const controller = new AbortController()
    const signal = controller.signal
    setLoading(true)
    setFailure(false)
    void publicationCatalog(owner, signal)
      .then((rows) => { if (!signal.aborted) setState({ owner, rows }) })
      .catch(() => { if (!signal.aborted) setFailure(true) })
      .finally(() => { if (!signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, online, owner, stamp])
  const published = useMemo(
    () => new Set(state.owner === owner ? state.rows.map(({ id }) => id) : []),
    [state, owner]
  )
  return {
    published, rows: state.owner === owner ? state.rows : [],
    failure: !!owner && online && failure, loading: !!owner && online && loading,
  }
}
