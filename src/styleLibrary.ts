import { type Deck, type FontAsset, type NamedStyle } from './model.ts'

export interface StyleLibrary {
  styles: NamedStyle[]
  fonts: FontAsset[]
}
export function collectStyles(decks: Deck[]): StyleLibrary {
  const fonts = new Map<string, FontAsset>(),
    styles = new Map<string, NamedStyle>()
  for (const d of decks) {
    const remap = new Map<string, string>()
    for (const f of d.resources.fonts) {
      let id = f.id
      let suffix = 1
      while (fonts.has(id) && fonts.get(id)!.data !== f.data)
        id = f.id.slice(0, 65) + '-v' + ++suffix
      fonts.set(id, { ...f, id })
      remap.set(f.id, id)
    }
    for (const style of d.theme.styles) {
      const values = { ...style.values }
      if (values.font && remap.has(values.font))
        values.font = remap.get(values.font)
      let id = style.id,
        suffix = 1
      while (
        styles.has(id) &&
        JSON.stringify(styles.get(id)!.values) !== JSON.stringify(values)
      )
        id = style.id.slice(0, 65) + '-v' + ++suffix
      styles.set(id, { ...style, id, values })
    }
  }
  return { styles: [...styles.values()], fonts: [...fonts.values()] }
}
export function installStyle(
  deck: Deck,
  library: StyleLibrary,
  selection: { font: string } | { style: string }
): Deck {
  const s =
    'style' in selection
      ? library.styles.find((v) => v.id === selection.style)
      : undefined
  const f = library.fonts.find(
    (v) => v.id === ('font' in selection ? selection.font : s?.values.font)
  )
  const fonts = [...deck.resources.fonts],
    styles = [...deck.theme.styles]
  let fontID = f?.id
  if (f) {
    const equivalent = fonts.find((v) => v.data === f.data)
    if (equivalent) fontID = equivalent.id
    else {
      if (fonts.length >= 32) throw new Error('Лимит документа — 32 шрифта.')
      if (fonts.some((v) => v.id === fontID)) fontID = 'f' + crypto.randomUUID()
      fonts.push({ ...f, id: fontID! })
    }
  }
  if (s) {
    const values = { ...s.values, ...(fontID ? { font: fontID } : {}) }
    if (
      !styles.some(
        (v) =>
          v.id === s.id && JSON.stringify(v.values) === JSON.stringify(values)
      )
    ) {
      if (styles.length >= 128) throw new Error('Лимит документа — 128 стилей.')
      const id = styles.some((v) => v.id === s.id)
        ? 's' + crypto.randomUUID()
        : s.id
      styles.push({ ...s, id, values })
    }
  }
  return { ...deck, resources: { fonts }, theme: { ...deck.theme, styles } }
}
