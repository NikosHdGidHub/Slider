import { useEffect, type ReactNode } from 'react'
import { ArrowLeft, Save, LoaderCircle } from 'lucide-react'
import { IconButton } from './Workspace'
import { AvailabilityControl, type AvailabilityProps } from './AvailabilityControl'
import './editorHeader.css'

export type SaveControl = { dirty: boolean; saving: boolean; error?: string; disabled?: boolean; onSave: () => void }
export function SaveButton({ dirty, saving, error, disabled, onSave }: SaveControl) {
  const enabled = dirty && !saving && !disabled
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.code !== 'KeyS' || event.altKey) return
      event.preventDefault()
      if (enabled && !document.querySelector('dialog[open], .overlay')) onSave()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [enabled, onSave])
  return <button type="button" className="editor-save-button" data-dirty={dirty || undefined}
    data-saving={saving || undefined} data-error={!!error || undefined}
    disabled={!enabled} aria-label="Сохранить" title={error || (dirty ? 'Сохранить (Ctrl/⌘+S)' : 'Все изменения сохранены')}
    onClick={onSave}>
    {saving ? <LoaderCircle size={16} className="editor-save-spin" /> : <Save size={16} />}
    <span>{saving ? 'Сохраняем…' : 'Сохранить'}</span>
  </button>
}
export function EditorHeader({ back, exitLabel, nameLabel, title, rename, availability, status, save, children }: {
  back: () => void; exitLabel: string; nameLabel: string; title: string; rename: (title: string) => void;
  availability?: AvailabilityProps; status: string; save: SaveControl; children?: ReactNode
}) {
  return <>
    <IconButton label={exitLabel} onClick={back}><ArrowLeft /></IconButton>
    <input aria-label={nameLabel} maxLength={200} value={title} onChange={e => rename(e.target.value)}
      onBlur={e => { if (!e.currentTarget.value.trim()) rename('Без названия') }} />
    {availability ? <AvailabilityControl {...availability} /> : <small className="edit-status" role="status" title={status}>{status}</small>}
    <SaveButton {...save} />
    {children}
  </>
}
