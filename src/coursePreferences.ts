import { useStoredPreference } from './workspacePreferences'
import type { LibrarySettings, LibrarySort } from './Library'

interface LocationPreferences {
  active: Record<string, string | null>
  filters: Record<string, { query?: string; sort?: LibrarySort }>
}
const defaults: LocationPreferences = { active: {}, filters: {} }

export function useCoursePreferences(
  scope: string | null,
  root: LibrarySettings
) {
  const [prefs, save] = useStoredPreference(
    'atlas.library.v1.course-locations',
    defaults,
    (saved) => {
      if (!saved || typeof saved !== 'object') return
      const preferences = saved as LocationPreferences
      if (preferences.active && preferences.filters) return preferences
    }
  )
  const identity = scope ?? 'guest'
  const id =
    typeof prefs.active[identity] === 'string' ? prefs.active[identity] : null
  const key = identity + '/' + (id ?? 'root')
  const options: LibrarySort[] = id ? ['manual', ...root.sorts] : root.sorts
  const saved = prefs.filters[key]
  function setLocation(next: string | null) {
    save((previous) => ({
      ...previous,
      active: { ...previous.active, [identity]: next },
    }))
  }
  function filter(fields: { query?: string; sort?: LibrarySort }) {
    save((previous) => ({
      ...previous,
      filters: {
        ...previous.filters,
        [key]: { ...previous.filters[key], ...fields },
      },
    }))
  }
  const query = typeof saved?.query === 'string' ? saved.query : ''
  const sort =
    id && saved?.sort && options.includes(saved.sort)
      ? saved.sort
      : id
        ? 'manual'
        : root.sort
  const settings: LibrarySettings = {
    ...root,
    query,
    sort,
    sorts: options,
    setQuery: (value) =>
      filter({ query: typeof value === 'function' ? value(query) : value }),
    setSort: (value) => {
      if (id)
        filter({ sort: typeof value === 'function' ? value(sort) : value })
      else root.setSort(value)
    },
  }
  return { id, key, setLocation, settings }
}
