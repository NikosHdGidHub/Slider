import { mediaSlides } from './grid.ts'
import type { Deck } from './model.ts'
import { fontCatalog, fontPath } from './fontCatalog.ts'

export function referencedFonts(deck: Deck) {
  const names = new Set<string>()
  const add = (font?: string) => {
    if (font) names.add(font)
  }
  for (const style of Object.values(deck.theme.systemStyles)) add(style.font)
  for (const style of deck.theme.styles) add(style.values.font)
  for (const slide of mediaSlides(deck))
    for (const item of slide.items) {
      add(item.overrides?.font)
      for (const paragraph of item.paragraphs ?? [])
        for (const run of paragraph.runs) add(run.font)
    }
  return names
}

export function offlineFontPaths(deck: Deck) {
  // DejaVu Sans remains the fallback for user fonts and missing glyphs.
  return [...new Set(['sans', ...referencedFonts(deck)])].flatMap((id) =>
    (fontCatalog[id]?.faces ?? []).map(([file]) => fontPath(id, file))
  )
}
