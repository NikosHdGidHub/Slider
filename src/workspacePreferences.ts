import { useEffect, useState } from 'react'

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type Value<T> = T extends number ? number : boolean

export function usePreference<T extends boolean | number>(
  name: string,
  fallback: T,
  limits?: readonly [number, number]
) {
  const key = 'atlas.workspace.v1.' + name
  const [value, setValue] = useState<Value<T>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (typeof saved === 'boolean' && typeof fallback === 'boolean')
        return saved as Value<T>
      if (typeof saved === 'number' && Number.isFinite(saved) && limits)
        return clamp(saved, ...limits) as Value<T>
    } catch {
      // The workspace also works when browser storage is unavailable.
    }
    return fallback as Value<T>
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Preferences are optional.
    }
  }, [key, value])
  return [value, setValue] as const
}
