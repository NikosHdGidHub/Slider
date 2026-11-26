import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import {
  Fragment,
  Schema,
  Slice,
  type Node,
  type Mark,
} from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { baseKeymap } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import {
  paragraphs,
  richText,
  type Characters,
  type Item,
  type Paragraph,
} from './model'
import { fontCatalog } from './fontCatalog'
import './visualText.css'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      attrs: {
        list: { default: null },
        indent: { default: null },
        after: { default: null },
      },
      toDOM(node) {
        const { list, indent, after } = node.attrs
        return [
          'p',
          {
            'data-list': list,
            style:
              (indent === null
                ? ''
                : 'padding-inline-start:' + indent + 'px;') +
              (after === null ? '' : 'margin-block-end:' + after + 'px;'),
          },
          0,
        ]
      },
    },
    text: {},
  },
  marks: { appearance: { attrs: { values: {} }, toDOM: () => ['span', 0] } },
})

function documentFor(item: Item, flexible: boolean) {
  return schema.node(
    'doc',
    null,
    paragraphs(flexible ? item : { ...item, paragraphs: undefined }).map(
      ({ runs, ...attrs }) =>
        schema.node(
          'paragraph',
          attrs,
          runs.flatMap(({ text, ...values }) =>
            text
              ? [
                  schema.text(
                    text,
                    Object.keys(values).length
                      ? [schema.marks.appearance.create({ values })]
                      : []
                  ),
                ]
              : []
          )
        )
    )
  )
}

function fieldsFor(doc: Node, flexible: boolean): Partial<Item> {
  const parts: Paragraph[] = []
  let marked = false
  doc.forEach((paragraph) => {
    const attrs = Object.fromEntries(
      Object.entries(paragraph.attrs).filter(([, v]) => v !== null)
    )
    if (Object.keys(attrs).length) marked = true
    const runs: Paragraph['runs'] = []
    paragraph.forEach((node) => {
      const values = node.marks[0]?.attrs.values ?? {}
      if (Object.keys(values).length) marked = true
      runs.push({ ...values, text: node.text ?? '' })
    })
    parts.push({ ...attrs, runs: runs.length ? runs : [{ text: '' }] })
  })
  const fields = richText(parts)
  return {
    text: fields.text,
    paragraphs: flexible && marked ? fields.paragraphs : undefined,
  }
}

export interface TextSelectionControls {
  values?: Characters
  appearance: (fields: Characters | null) => void
  list: (kind: NonNullable<Paragraph['list']>) => void
  indent: (delta: number) => void
  spacing: (after: number) => void
  paragraphAfter?: number
}

export function VisualText({
  item,
  flexible,
  onText,
  finish,
  register,
  runStyle,
  undo,
}: {
  item: Item
  flexible: boolean
  onText: (fields: Partial<Item>) => void
  finish: () => void
  register?: (controls: TextSelectionControls | null) => void
  runStyle: (values: Characters) => CSSProperties
  undo?: (redo: boolean) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const current = useRef({ item, onText, finish, register, runStyle, undo })
  current.current = { item, onText, finish, register, runStyle, undo }

  useLayoutEffect(() => {
    const element = host.current!
    const appearance = schema.marks.appearance
    const markViews = {
      appearance(mark: Mark) {
        const span = element.ownerDocument.createElement('span')
        Object.assign(span.style, current.current.runStyle(mark.attrs.values))
        return { dom: span, contentDOM: span }
      },
    }
    const editor = new EditorView(element, {
      state: EditorState.create({
        doc: documentFor(current.current.item, flexible),
        plugins: [keymap(baseKeymap)],
      }),
      attributes: {
        'aria-label': 'Текст на холсте',
        'aria-multiline': 'true',
        role: 'textbox',
        spellcheck: 'true',
      },
      markViews,
      handlePaste(view, event) {
        const plain = event.clipboardData?.getData('text/plain')
        if (plain === undefined) return false
        event.preventDefault()
        const lines = plain.replace(/\r\n?/g, '\n').split('\n')
        const content = Fragment.from(
          lines.map((line) =>
            schema.node('paragraph', null, line ? [schema.text(line)] : [])
          )
        )
        view.dispatch(
          view.state.tr
            .replaceSelection(new Slice(content, 1, 1))
            .scrollIntoView()
        )
        return true
      },
      handleKeyDown(_, event) {
        if (
          (event.ctrlKey || event.metaKey) &&
          ['KeyZ', 'KeyY'].includes(event.code) &&
          current.current.undo
        ) {
          event.preventDefault()
          event.stopPropagation()
          current.current.undo(event.shiftKey || event.code === 'KeyY')
          return true
        }
        if (
          event.key === 'Escape' ||
          (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
        ) {
          event.preventDefault()
          event.stopPropagation()
          current.current.finish()
          return true
        }
        return false
      },
      dispatchTransaction(transaction) {
        const next = editor.state.apply(transaction)
        editor.updateState(next)
        if (transaction.docChanged)
          current.current.onText(fieldsFor(next.doc, flexible))
        if (flexible) announce()
      },
    })
    view.current = editor

    function paragraphsInSelection(update: (node: Node) => object) {
      const { doc, selection, tr } = editor.state
      doc.forEach((node, position) => {
        if (
          position <= selection.to &&
          position + node.nodeSize > selection.from
        )
          tr.setNodeMarkup(position, undefined, update(node))
      })
      if (tr.docChanged) editor.dispatch(tr)
      editor.focus()
    }
    function extend(values: Characters | undefined, fields: Characters) {
      const next = { ...values, ...fields }
      if (next.font && Object.hasOwn(fontCatalog, next.font)) {
        const font = fontCatalog[next.font]
        if (next.weight && !font.weights.includes(Number(next.weight)))
          delete next.weight
        if (next.italic && !font.italic) delete next.italic
      }
      return next
    }
    const controls: TextSelectionControls = {
      appearance(fields) {
        const {
          doc,
          selection: { from, to, empty },
          tr,
        } = editor.state
        if (empty) {
          const old = editor.state.storedMarks ?? doc.resolve(from).marks()
          const values = old.find((mark) => mark.type === appearance)?.attrs
            .values
          editor.dispatch(
            tr.setStoredMarks(
              fields
                ? [appearance.create({ values: extend(values, fields) })]
                : []
            )
          )
        } else {
          doc.nodesBetween(from, to, (node, position) => {
            if (!node.isText) return
            const start = Math.max(position, from),
              end = Math.min(position + node.nodeSize, to)
            const old = node.marks.find((mark) => mark.type === appearance)
              ?.attrs.values
            tr.removeMark(start, end, appearance)
            if (fields)
              tr.addMark(
                start,
                end,
                appearance.create({ values: extend(old, fields) })
              )
          })
          if (tr.docChanged) editor.dispatch(tr)
        }
        editor.focus()
      },
      list(kind) {
        const old = editor.state.selection.$from.parent.attrs.list
        paragraphsInSelection((node) => ({
          ...node.attrs,
          list: old === kind ? null : kind,
        }))
      },
      indent(delta) {
        paragraphsInSelection((node) => ({
          ...node.attrs,
          indent: Math.max(0, Math.min(512, (node.attrs.indent ?? 0) + delta)),
        }))
      },
      spacing(after) {
        paragraphsInSelection((node) => ({ ...node.attrs, after }))
      },
    }
    function announce() {
      const { doc, selection, storedMarks } = editor.state
      let marks = storedMarks ?? selection.$from.marks()
      if (!selection.empty) {
        let found = false
        doc.nodesBetween(selection.from, selection.to, (node) => {
          if (!found && node.isText) {
            marks = node.marks
            found = true
          }
        })
      }
      current.current.register?.({
        ...controls,
        paragraphAfter: selection.$from.parent.attrs.after ?? undefined,
        values: marks.find((mark) => mark.type === appearance)?.attrs.values,
      })
    }
    if (flexible) announce()

    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (
        !target ||
        element.contains(target) ||
        target.closest('[data-text-controls]')
      )
        return
      current.current.finish()
    }
    element.ownerDocument.addEventListener('pointerdown', outside, true)
    editor.focus()
    return () => {
      element.ownerDocument.removeEventListener('pointerdown', outside, true)
      view.current = null
      editor.destroy()
      if (flexible) current.current.register?.(null)
    }
  }, [flexible])

  useLayoutEffect(() => {
    const editor = view.current
    if (!editor) return
    const next = documentFor(item, flexible)
    if (next.eq(editor.state.doc)) return
    const { from, to } = editor.state.selection
    const state = editor.state
    const tr = state.tr.replaceWith(0, state.doc.content.size, next.content)
    tr.setSelection(
      TextSelection.between(
        tr.doc.resolve(Math.min(from, tr.doc.content.size)),
        tr.doc.resolve(Math.min(to, tr.doc.content.size))
      )
    )
    editor.updateState(state.apply(tr))
  }, [item.text, item.paragraphs, flexible])
  return (
    <div
      ref={host}
      className="atlas-visual-text"
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}
