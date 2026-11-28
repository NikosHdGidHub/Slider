#!/usr/bin/env python3
"""Local-only manual saving regression test for Slider, using a fresh browser context.
Install playwright and chromium first; run against an already running local dev server.
Never use a production/Supabase-connected build. Does not use the normal browser profile.
"""
import argparse, json, os, shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect


def button(page, name):
    return page.get_by_role('button', name=name, exact=True)


def menu(page, name):
    return page.get_by_role('menuitem', name=name, exact=True)


def rows(page, store):
    return page.evaluate('''store => new Promise((resolve, reject) => {
      const q = indexedDB.open('atlas-lessons-v1');
      q.onerror = () => reject(q.error);
      q.onsuccess = () => {
        const db = q.result;
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result.map(r => ({revision: r.revision, title: r.deck?.title ?? r.template?.deck?.title})));
        tx.oncomplete = () => db.close();
      };
    })''', store)


def rev(page, store):
    result = rows(page, store)
    assert len(result) == 1, result
    return result[0]['revision']


def capture(page, folder, name):
    if folder:
        folder.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=folder / (name + '.png'), animations='disabled')


def run(page, url, screenshots):
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    expect(page.get_by_text('Здесь будут ваши методички')).to_be_visible()
    assert rows(page, 'lessons') == [], 'Test must use fresh local storage'
    button(page, 'Создать').click()
    menu(page, 'Новая методичка').click()
    page.get_by_label('Название', exact=True).fill('Проверка сохранения')
    button(page.get_by_role('dialog'), 'Создать').click()
    title = page.get_by_label('Название методички')
    save = button(page, 'Сохранить')
    expect(title).to_have_value('Проверка сохранения')
    expect(save).to_be_disabled()
    revision = rev(page, 'lessons')
    title.fill('Несохранённое название')
    expect(save).to_be_enabled()
    page.wait_for_timeout(850)
    assert rev(page, 'lessons') == revision, 'Typing wrote to IndexedDB'
    capture(page, screenshots, 'lesson-dirty')
    button(page, 'В библиотеку').click()
    dialog = page.get_by_role('dialog', name='Несохранённые изменения')
    expect(dialog).to_be_visible()
    capture(page, screenshots, 'exit-confirm')
    button(dialog, 'Продолжить редактирование').click()
    expect(dialog).to_have_count(0)
    expect(title).to_have_value('Несохранённое название')
    title.press('Control+s')
    expect(save).not_to_have_attribute('data-saving', 'true')
    expect(save).not_to_have_attribute('data-dirty', 'true')
    expect(save).to_be_disabled()
    assert rev(page, 'lessons') == revision + 1
    expect(title).to_have_value('Несохранённое название')
    capture(page, screenshots, 'lesson-saved')
    button(page, 'Отменить').click()
    expect(save).to_be_enabled()
    button(page, 'Повторить').click()
    expect(save).not_to_have_attribute('data-saving', 'true')
    expect(save).not_to_have_attribute('data-dirty', 'true')
    expect(save).to_be_disabled()
    assert rev(page, 'lessons') == revision + 1
    title.fill('Отброшенная правка')
    button(page, 'В библиотеку').click()
    button(dialog, 'Выйти без сохранения').click()
    expect(button(page, 'Открыть Несохранённое название')).to_be_visible()
    assert rev(page, 'lessons') == revision + 1
    button(page, 'Открыть Несохранённое название').click()
    expect(title).to_have_value('Несохранённое название')
    title.fill('Сохранение с выходом')
    button(page, 'В библиотеку').click()
    button(dialog, 'Сохранить и выйти').click()
    expect(button(page, 'Открыть Сохранение с выходом')).to_be_visible()
    assert rev(page, 'lessons') == revision + 2
    button(page, 'Открыть Сохранение с выходом').click()
    expect(save).to_be_disabled()
    # Simulate another tab advancing the local revision: save must fail without
    # discarding the draft or quietly overwriting the newer database version.
    page.evaluate('''() => new Promise((resolve,reject) => {
      const q=indexedDB.open('atlas-lessons-v1'); q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{const db=q.result, tx=db.transaction('lessons','readwrite');
        const cursor=tx.objectStore('lessons').openCursor();
        cursor.onsuccess=()=>{const c=cursor.result;if(c)c.update({...c.value,revision:c.value.revision+1})};
        tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)
      }
    })''')
    title.fill('Рабочая копия после ошибки')
    button(page, 'В библиотеку').click()
    button(dialog, 'Сохранить и выйти').click()
    expect(dialog.get_by_role('alert')).to_be_visible()
    expect(dialog).to_be_visible()
    capture(page, screenshots, 'save-conflict')
    button(dialog, 'Продолжить редактирование').click()
    expect(title).to_have_value('Рабочая копия после ошибки')
    expect(save).to_be_enabled()
    with page.expect_download() as result:
        button(page, 'Экспортировать JSON').click()
    exported = json.loads(Path(result.value.path()).read_text(encoding='utf-8'))
    assert exported['title'] == 'Рабочая копия после ошибки'
    button(page, 'В библиотеку').click()
    button(dialog, 'Выйти без сохранения').click()
    expect(button(page, 'Открыть Сохранение с выходом')).to_be_visible()
    # New, not-yet-stored template is dirty even without edits.
    button(page, 'Шаблоны').click()
    button(page, 'Создать').click()
    menu(page, 'Создать вручную').click()
    template_title = page.get_by_label('Название шаблона')
    expect(template_title).to_be_visible()
    expect(save).to_be_enabled()
    template_title.fill('Проверка шаблона')
    page.wait_for_timeout(700)
    assert rows(page, 'templates') == []
    save.click()
    expect(save).not_to_have_attribute('data-saving', 'true')
    expect(save).not_to_have_attribute('data-dirty', 'true')
    expect(save).to_be_disabled()
    expect(template_title).to_have_value('Проверка шаблона')
    assert rev(page, 'templates') == 1
    capture(page, screenshots, 'template-saved')
    button(page, 'Оформление и объекты').click()
    expect(save).to_be_disabled()
    template_title.fill('Новый вид шаблона')
    expect(save).to_be_enabled()
    capture(page, screenshots, 'template-objects-dirty')
    button(page, 'В библиотеку').click()
    button(dialog, 'Сохранить и выйти').click()
    expect(button(page, 'Предпросмотр Новый вид шаблона')).to_be_visible()
    assert rev(page, 'templates') == 2
    assert not errors, errors
    print('PASS: manual saving, undo/redo, exit choices, revision conflict, JSON recovery, grid and object editors')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:5173/lessons/')
    parser.add_argument('--screenshots', type=Path)
    args = parser.parse_args()
    if urlparse(args.url).hostname not in ('127.0.0.1', 'localhost', '::1'):
        parser.error('Use only a localhost test instance')
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or shutil.which('chromium'), args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        try:
            run(context.new_page(), args.url, args.screenshots)
        finally:
            context.close()
            browser.close()

if __name__ == '__main__':
    main()
