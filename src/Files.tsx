import { useEffect, useState } from 'react'
import {
  resources,
  createFolder,
  listFolders,
  storeFile,
  imageUrl,
  updateFile,
  downloadFile,
  type Resource,
} from './resources'

export function Files({
  pick,
  openJSON,
}: {
  pick?: (url: string) => void
  openJSON?: (text: string) => Promise<void>
}) {
  const [rows, setRows] = useState<Resource[]>([]),
    [query, search] = useState(''),
    [kind, filter] = useState(''),
    [folder, setFolder] = useState(''),
    [message, status] = useState(''),
    [busy, working] = useState(false)
  const [folders, setFolders] = useState<string[]>([])
  async function run(fn: () => Promise<void>) {
    working(true)
    status('')
    try {
      await fn()
      const [files, dirs] = await Promise.all([resources(), listFolders()])
      setRows(files)
      setFolders(dirs)
    } catch (e) {
      status((e as Error).message)
    } finally {
      working(false)
    }
  }
  useEffect(() => {
    void run(async () => {})
  }, [])
  const visible = rows.filter(
    (r) =>
      (!pick || r.bucket === 'images') &&
      r.name.toLowerCase().includes(query.toLowerCase()) &&
      r.mime.startsWith(kind) &&
      (!folder || r.folder === folder)
  )
  return (
    <section aria-label="Мои файлы">
      <fieldset disabled={busy}>
        {!pick && (
          <label>
            Загрузить файлы{' '}
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.svg,.pdf,.pptx,.json"
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                e.target.value = ''
                void run(async () => {
                  const errors: string[] = []
                  for (const f of files) {
                    try {
                      await storeFile(f, f.name, folder)
                    } catch (e) {
                      errors.push(f.name + ' — ' + (e as Error).message)
                    }
                  }
                  if (errors.length) status(errors.join(' · '))
                })
              }}
            />
          </label>
        )}
        <input
          aria-label="Поиск по названию"
          placeholder="Поиск по названию"
          value={query}
          onChange={(e) => search(e.target.value)}
        />
        {!pick && (
          <select
            aria-label="Тип файла"
            value={kind}
            onChange={(e) => filter(e.target.value)}
          >
            <option value="">Все типы</option>
            <option value="image/">Изображения</option>
            <option value="application/pdf">PDF</option>
            <option value="application/vnd">PPTX</option>
            <option value="application/json">JSON</option>
          </select>
        )}
        {!pick && (
          <button
            onClick={() => {
              const name = prompt('Название новой папки')?.trim()
              if (name)
                void run(async () => {
                  await createFolder(name)
                  setFolder(name)
                })
            }}
          >
            Создать папку
          </button>
        )}
        <select
          aria-label="Папка"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        >
          <option value="">Все папки</option>
          {Array.from(
            new Set([...folders, ...rows.map((r) => r.folder).filter(Boolean)])
          ).map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <p role="status">
          {busy
            ? 'Загрузка…'
            : message || (!visible.length ? 'Файлы не найдены' : '')}
        </p>
        <div className="file-grid">
          {visible.map((r) => (
            <article key={r.sha}>
              {r.bucket === 'images' && (
                <img src={imageUrl(r)} alt="" loading="lazy" />
              )}
              <strong>{r.name}</strong>
              <small>
                {r.mime} · {Math.ceil(r.size / 1024)} КиБ ·{' '}
                {new Date(r.created_at).toLocaleDateString()} {r.folder}
              </small>
              {pick ? (
                <button onClick={() => pick(imageUrl(r))}>Выбрать</button>
              ) : (
                <>
                  <button
                    onClick={() =>
                      void run(async () => {
                        const url = URL.createObjectURL(await downloadFile(r))
                        const a = document.createElement('a')
                        a.href = url
                        a.download = r.name
                        a.click()
                        setTimeout(() => URL.revokeObjectURL(url), 5000)
                      })
                    }
                  >
                    Скачать
                  </button>
                  {r.mime === 'application/json' && openJSON && (
                    <button
                      onClick={() =>
                        void run(async () =>
                          openJSON(await (await downloadFile(r)).text())
                        )
                      }
                    >
                      Импортировать
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const name = prompt('Название файла', r.name)?.trim()
                      if (name) void run(() => updateFile(r.sha, { name }))
                    }}
                  >
                    Переименовать
                  </button>
                  <button
                    onClick={() => {
                      const folder = prompt(
                        'Название папки (пустое — корневая папка)',
                        r.folder
                      )
                      if (folder !== null)
                        void run(() =>
                          updateFile(r.sha, { folder: folder.trim() })
                        )
                    }}
                  >
                    Переместить
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          'Убрать файл из каталога? В методичках он останется доступен.'
                        )
                      )
                        void run(() => updateFile(r.sha, { hidden: true }))
                    }}
                  >
                    Убрать из каталога
                  </button>
                </>
              )}
            </article>
          ))}
        </div>
      </fieldset>
    </section>
  )
}
