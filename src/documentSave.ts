import { useRef, useState } from 'react'

// Compare actual persisted content, not the number of edit events. Shared subtrees
// are skipped, and undo to the saved snapshot makes the document clean again.
export function sameDocument(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameDocument(v, b[i]))
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>
  const ka = Object.keys(aa).filter((k) => aa[k] !== undefined)
  const kb = Object.keys(bb).filter((k) => bb[k] !== undefined)
  return (
    ka.length === kb.length &&
    ka.every((k) => Object.hasOwn(bb, k) && sameDocument(aa[k], bb[k]))
  )
}
export function useSaveOperation() {
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (lock.current) throw Error('Сохранение уже выполняется.')
    lock.current = true
    setSaving(true)
    setError('')
    try {
      return await operation()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
      throw err
    } finally {
      lock.current = false
      setSaving(false)
    }
  }
  return { saving, error, lock, run, clearError: () => setError('') }
}
