import { useEffect, useState } from 'react'

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function useStoredPreference<T>(
  key: string,
  fallback: T,
  decode: (saved: unknown) => T | undefined
) {
  const [value, setValue] = useState<T>(() => {
    try {
      return decode(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? fallback
    } catch {
      return fallback
    }
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

type Value<T> = T extends number ? number : boolean

export function usePreference<T extends boolean | number>(
  name: string,
  fallback: T,
  limits?: readonly [number, number]
) {
  return useStoredPreference(
    'atlas.workspace.v1.' + name,
    fallback as Value<T>,
    (saved) => {
      if (typeof saved === 'boolean' && typeof fallback === 'boolean')
        return saved as Value<T>
      if (typeof saved === 'number' && Number.isFinite(saved) && limits)
        return clamp(saved, ...limits) as Value<T>
    }
  )
}
