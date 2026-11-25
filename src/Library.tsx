import { useState, type ReactNode } from 'react'
import { ArrowDownUp, LayoutGrid, List, Search, X } from 'lucide-react'
import { ActionMenu, type MenuItem } from './ActionMenu'
import { IconButton } from './IconButton'
import type { Deck } from './model'
import { Stage } from './Stage'
import { useStoredPreference } from './workspacePreferences'
import './library.css'

const titles = new Intl.Collator('ru', { sensitivity: 'base', numeric: true })
const sortOptions = {
  recent: 'Сначала новые',
  old: 'Сначала старые',
  name: 'Название от А до Я',
  reverse: 'Название от Я до А',
  slides: 'Сначала больше слайдов',
} as const
type Sort = keyof typeof sortOptions
const lessonSorts: Sort[] = ['recent', 'old', 'name', 'reverse', 'slides']
const templateSorts: Sort[] = ['name', 'reverse']

export function useLibrarySettings(
  scope: 'lessons' | 'presentation' | 'layout'
) {
  const key = 'atlas.library.v1.' + scope
  const sorts = scope === 'lessons' ? lessonSorts : templateSorts
  const [query, setQuery] = useState('')
  const [view, setView] = useStoredPreference<'gallery' | 'list'>(
    key + '.view',
    'gallery',
    (saved) => (saved === 'gallery' || saved === 'list' ? saved : undefined)
  )
  const [sort, setSort] = useStoredPreference<Sort>(
    key + '.sort',
    sorts[0],
    (saved) => sorts.find((option) => option === saved)
  )
  return { query, setQuery, view, setView, sort, setSort, sorts }
}

export type LibrarySettings = ReturnType<typeof useLibrarySettings>

export function selectLibraryRows<T extends { deck: Deck; updated?: number }>(
  rows: T[],
  { query, sort }: LibrarySettings
) {
  const normalize = (text: string) =>
    text.normalize('NFC').toLocaleLowerCase('ru')
  const search = normalize(query.trim())
  return rows
    .filter(({ deck }) => normalize(deck.title).includes(search))
    .sort((a, b) => {
      const name = titles.compare(a.deck.title, b.deck.title)
      if (sort === 'name') return name
      if (sort === 'reverse') return -name
      if (sort === 'slides')
        return b.deck.slides.length - a.deck.slides.length || name
      const date = (b.updated ?? 0) - (a.updated ?? 0)
      return (sort === 'recent' ? date : -date) || name
    })
}

export function LibraryHeader({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <header className="lib-heading">
      <h1>{title}</h1>
      {action}
    </header>
  )
}

export function LibraryToolbar({
  settings,
  label,
  actions,
}: {
  settings: LibrarySettings
  label: string
  actions?: ReactNode
}) {
  return (
    <div className="lib-toolbar">
      <div className="lib-search" role="search" aria-label={label}>
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          aria-label={label}
          placeholder={label}
          value={settings.query}
          onChange={(e) => settings.setQuery(e.target.value)}
        />
        {settings.query && (
          <IconButton
            className="lib-button lib-icon"
            label="Очистить поиск"
            onClick={(e) => {
              e.currentTarget.parentElement?.querySelector('input')?.focus()
              settings.setQuery('')
            }}
          >
            <X />
          </IconButton>
        )}
      </div>
      <div className="lib-toolbar-actions">
        {actions}
        <ActionMenu
          label="Сортировка"
          icon={ArrowDownUp}
          items={settings.sorts.map((option) => ({
            label: sortOptions[option],
            checked: settings.sort === option,
            run: () => settings.setSort(option),
          }))}
        />
        <div className="lib-view" role="group" aria-label="Вид библиотеки">
          <IconButton
            className="lib-button lib-icon"
            label="Галерея"
            aria-pressed={settings.view === 'gallery'}
            onClick={() => settings.setView('gallery')}
          >
            <LayoutGrid />
          </IconButton>
          <IconButton
            className="lib-button lib-icon"
            label="Компактный каталог"
            aria-pressed={settings.view === 'list'}
            onClick={() => settings.setView('list')}
          >
            <List />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export function LibraryState({
  title,
  children,
  error,
  action,
}: {
  title: string
  children?: ReactNode
  error?: boolean
  action?: ReactNode
}) {
  return (
    <div className="lib-state" role={error ? 'alert' : 'status'}>
      <div>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  )
}

export function LibraryItems({
  settings,
  columns,
  children,
  templates = false,
}: {
  settings: LibrarySettings
  columns: readonly [string, string]
  children: ReactNode
  templates?: boolean
}) {
  return (
    <div
      className="lib-items"
      data-view={settings.view}
      data-templates={templates || undefined}
    >
      {settings.view === 'list' && (
        <div className="lib-column-head" aria-hidden="true">
          <span>Название</span>
          <span>{columns[0]}</span>
          <span>{columns[1]}</span>
          <span />
        </div>
      )}
      {children}
    </div>
  )
}

export function LibraryCard({
  deck,
  first,
  second,
  description,
  open,
  actions,
  disabled,
  notice,
  preflight,
}: {
  deck: Deck
  first: ReactNode
  second?: ReactNode
  description?: string
  open: () => void
  actions: MenuItem[]
  disabled?: boolean
  notice: (message: string) => void
  preflight?: boolean
}) {
  return (
    <article className="lib-card">
      <button
        className="lib-card-open"
        type="button"
        onClick={open}
        aria-label={(preflight ? 'Предпросмотр ' : 'Открыть ') + deck.title}
      >
        <span className="lib-thumbnail" aria-hidden="true">
          <Stage deck={deck} slide={deck.slides[0]} />
        </span>
        <span className="lib-card-title" title={deck.title}>
          {deck.title}
        </span>
      </button>
      <div className="lib-card-meta">
        <span>{first}</span>
        {second && (
          <>
            <span className="lib-meta-dot" aria-hidden="true">
              ·
            </span>
            <span>{second}</span>
          </>
        )}
      </div>
      <div className="lib-card-menu">
        <ActionMenu
          label={'Действия: ' + deck.title}
          items={actions}
          disabled={disabled}
          onError={notice}
        />
      </div>
      {description && <p className="lib-card-description">{description}</p>}
    </article>
  )
}
