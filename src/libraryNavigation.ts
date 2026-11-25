import { useLayoutEffect, useRef, type RefObject } from 'react'

export const desktopEditingMessage =
  'Редактирование доступно на компьютере. На мобильном устройстве вы можете просматривать методички.'

export function isPhone(device: Navigator = navigator) {
  const ua = device.userAgent
  if (
    /iPad|Tablet/i.test(ua) ||
    (/Macintosh/i.test(ua) && device.maxTouchPoints > 1)
  )
    return false
  if (/iPhone|iPod|Windows Phone|Opera Mini|BlackBerry|\bMobi/i.test(ua))
    return true
  const hints = (device as Navigator & { userAgentData?: { mobile: boolean } })
    .userAgentData
  return hints?.mobile === true
}

export function useLibraryScroll(
  content: RefObject<HTMLElement | null>,
  visible: boolean,
  key: string
) {
  const positions = useRef<Record<string, number>>({})
  useLayoutEffect(() => {
    if (!visible || !content.current) return
    const element = content.current
    const root = document.scrollingElement!
    const desired = positions.current[key] ?? 0
    let restoring = true
    const observer = new ResizeObserver(restore)
    function restore() {
      if (!restoring) return
      const max = Math.max(0, root.scrollHeight - root.clientHeight)
      window.scrollTo({ top: Math.min(max, desired), behavior: 'instant' })
      if (max + 1 >= desired) {
        restoring = false
        observer.disconnect()
      }
    }
    function remember() {
      if (!restoring) positions.current[key] = window.scrollY
    }
    function userScroll() {
      if (!restoring) return
      restoring = false
      observer.disconnect()
      remember()
    }
    function scrollKey(e: KeyboardEvent) {
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'PageDown',
          'PageUp',
          'Home',
          'End',
          'Space',
        ].includes(e.code)
      )
        userScroll()
    }
    restore()
    if (restoring) {
      observer.observe(element)
      observer.observe(document.documentElement)
    }
    window.addEventListener('scroll', remember, { passive: true })
    window.addEventListener('wheel', userScroll, { passive: true })
    window.addEventListener('touchmove', userScroll, { passive: true })
    window.addEventListener('pointerdown', userScroll, { passive: true })
    window.addEventListener('keydown', scrollKey)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', remember)
      window.removeEventListener('wheel', userScroll)
      window.removeEventListener('touchmove', userScroll)
      window.removeEventListener('pointerdown', userScroll)
      window.removeEventListener('keydown', scrollKey)
    }
  }, [content, visible, key])
}
