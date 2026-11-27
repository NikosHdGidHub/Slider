"""Playwright acceptance for the two libraries and their AI workflows."""

import argparse
import base64
import copy
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
MOBILE = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
SIZES = [(1024, 600), (1280, 720), (1366, 768), (1440, 900), (1920, 1080), (2560, 1440)]
OWNER = "00000000-0000-4000-8000-000000000001"


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def fixture(name):
    return json.loads((ROOT / 'tests' / 'fixtures' / (name + '.json')).read_text())


def templates():
    return json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e',
         "import {validatedFixtures} from './tests/instruction-fixtures.mjs';console.log(JSON.stringify(validatedFixtures()))"],
        cwd=ROOT, text=True,
    ))


def button(page, name):
    return page.get_by_role('button', name=name, exact=True)


def menu(page, name):
    return page.get_by_role('menuitem', name=name, exact=True)


def choose(page, title, label):
    button(page, 'Действия: ' + title).click()
    menu(page, label).click()


def viewport(page, w, h):
    page.set_viewport_size({'width': w, 'height': h})


def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), page.viewport_size


def capture(page, name):
    root = os.environ.get('ATLAS_LIBRARY_CAPTURES')
    if root:
        Path(root).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=Path(root) / (name + '.png'), animations='disabled')


def download(page, function):
    with page.expect_download() as result:
        function()
    file = result.value
    return file.suggested_filename, Path(file.path()).read_text()


def import_template(page, name):
    with page.expect_file_chooser() as result:
        button(page, 'Импортировать шаблон JSON').click()
    result.value.set_files(ROOT / 'tests' / 'fixtures' / (name + '.json'))
    expect(page.get_by_role('dialog').locator('.atlas-stage')).to_be_visible()


def import_lesson(page, name):
    button(page, 'Импортировать JSON методички').click()
    button(page, 'Импортировать').wait_for()
    page.get_by_label('Или вставьте JSON').fill(json.dumps(fixture(name), ensure_ascii=False))
    button(page, 'Импортировать').click()
    expect(page.get_by_role('dialog').locator('.atlas-stage')).to_be_visible()


def db_seed(page, decks, rows, extra=0):
    page.evaluate("""({decks, rows, extra}) => new Promise((resolve, reject) => {
      const db = indexedDB.open('atlas-lessons-v1');
      db.onerror = () => reject(db.error);
      db.onsuccess = () => {
        const conn = db.result, tx = conn.transaction(['lessons', 'templates'], 'readwrite');
        tx.oncomplete = () => { conn.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
        const lesson = tx.objectStore('lessons');
        const all = rows.concat(Array.from({length: extra}, (_,i) => {
          const template = structuredClone(rows[0].template);
          template.deck.id = crypto.randomUUID();
          template.deck.title = 'Шаблон для курса ' + (i+1);
          template.deck.master.name = template.deck.title;
          return {template, revision: 1, cloudRevision: 0, dirty: true};
        }));
        const tab = tx.objectStore('templates');
        all.forEach(row => tab.put(row));
        decks.forEach((deck,i) => lesson.put({deck, revision: 1, updated: 1764054400000 - i * 86400000}));
        for (let i=0;i<extra;i++) {
          const deck = structuredClone(decks[i % decks.length]);
          deck.id = crypto.randomUUID();
          deck.title = 'Тема курса ' + (i+1);
          const heading = deck.slides[0].items.filter(item => item.type === 'text' && !item.fixed)
            .sort((a,b) => b.size - a.size)[0];
          if (heading && !heading.paragraphs) heading.text = deck.title;
          lesson.put({deck, revision: 1, updated: 1740000000000 - i * 86400000});
        }
      };
    })""", {'decks': decks, 'rows': rows, 'extra': extra})


def row(template, cloud_revision=0, dirty=True):
    return {'template': template, 'revision': 1, 'cloudRevision': cloud_revision, 'dirty': dirty}


def scroll_reopens(page, title, template=False):
    trigger = button(page, 'Действия: ' + title)
    trigger.scroll_into_view_if_needed()
    page.wait_for_function('scrollY > 350')
    before = page.evaluate('scrollY')
    choose(page, title, 'Редактировать')
    expect(page.locator('.workspace')).to_be_visible()
    button(page, 'В библиотеку').click()
    page.wait_for_function('expected => Math.abs(scrollY - expected) < 3', arg=before)
    if template:
        expect(page.get_by_role('navigation', name='Тип шаблона').get_by_role('button', name='Презентации')).to_have_attribute('aria-current', 'page')


def desktop(page, url, catalog, decks):
    page.set_default_timeout(7000)
    errors = []
    responses = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    page.on('dialog', lambda dialog: dialog.accept('Переименованная копия') if dialog.type == 'prompt' else dialog.accept())
    page.goto(url)
    expect(page.get_by_text('Здесь будут ваши методички')).to_be_visible()
    expect(page.get_by_text('Скачать инструкцию для генерации презентации')).to_have_count(0)
    expect(page.get_by_role('heading', name='Пример методички')).to_have_count(0)
    capture(page, '05-empty')
    button(page, 'Создать').click()
    menu(page, 'Новая методичка').click()
    page.get_by_label('Название', exact=True).fill('Проверка автора')
    button(page.get_by_role('dialog'), 'Создать').click()
    button(page, 'Добавить текст').click()
    new_text = page.get_by_role('textbox', name='Текст на холсте', exact=True)
    toolbar = page.get_by_role('group', name='Форматирование текста', exact=True)
    expect(new_text).to_be_focused()
    new_text.press_sequentially('Текст проверки')
    new_text.press('Escape')
    expect(toolbar).to_have_count(0)
    paragraph = page.locator('.canvas .atlas-item .atlas-slide-text span').filter(has_text='Текст проверки')
    point = paragraph.evaluate('element => { const range = document.createRange(); range.setStart(element.firstChild, 5); range.setEnd(element.firstChild, 5); const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 }; }')
    page.mouse.click(point['x'], point['y'])
    expect(new_text).to_be_focused()
    assert new_text.evaluate('element => element.ownerDocument.getSelection().anchorOffset') == 5
    expect(toolbar).to_be_visible()
    button(page, 'Фигура').focus()
    expect(toolbar).to_have_count(0)
    page.mouse.click(point['x'], point['y'])
    expect(new_text).to_be_focused()
    new_text.blur()
    expect(toolbar).to_have_count(0)
    before = paragraph.bounding_box()
    page.mouse.move(before['x'] + 10, before['y'] + 8)
    page.mouse.down()
    page.mouse.move(before['x'] + 55, before['y'] + 40, steps=7)
    page.mouse.up()
    expect(toolbar).to_have_count(0)
    assert paragraph.bounding_box()['x'] > before['x'] + 30
    button(page, 'Фигура').click()
    expect(page.locator('.canvas .atlas-item')).to_have_count(2)
    button(page, 'Отменить').click()
    expect(page.locator('.canvas .atlas-item')).to_have_count(1)
    button(page, 'Повторить').click()
    expect(page.locator('.canvas .atlas-item')).to_have_count(2)
    button(page, 'Свернуть свойства').click()
    button(page, 'Показать свойства').click()
    button(page, '100%').click()
    expect(page.get_by_label('Текущий масштаб')).to_have_text('100%')
    board = page.locator('.canvas-viewport')
    box = board.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down(button='middle')
    page.mouse.move(x + 36, y + 28, steps=6)
    page.mouse.up(button='middle')
    button(page, 'Вписать').click()
    button(page, 'В библиотеку').click()
    expect(page.locator('.lib-card')).to_have_count(1)
    viewport(page,1920,1080)
    assert page.locator('.lib-card').first.bounding_box()['width'] <= 306
    choose(page, 'Проверка автора', 'Удалить с устройства')
    expect(page.get_by_text('Здесь будут ваши методички')).to_be_visible()
    button(page, 'Руководство').click()
    expect(page.get_by_role('heading', name='Пример методички')).to_be_visible()
    capture(page, '14-guide')
    button(page, 'Открыть пример').click()
    with page.expect_popup() as popup:
        button(page, 'Открыть экран учеников').click()
    projector = popup.value
    button(page, 'Следующий слайд').click()
    expect(projector.get_by_text('Горизонтали', exact=True)).to_be_visible()
    button(page, 'Только слайды').click()
    expect(page.locator('.atlas-viewer-slides')).to_be_visible()
    button(page, 'Заметки').click()
    button(page, 'Закрыть').click()
    button(page, 'Мои методички').click()

    first_layout = fixture('ai-layout-template')
    first_layout['deck']['id'] = str(uuid.uuid4())
    first_layout['deck']['title'] = 'Учебные наблюдения'
    first_layout['deck']['master']['name'] = first_layout['deck']['title']
    db_seed(page, decks, [row(catalog[k]) for k in ['frame', 'roles', 'grid', 'fonts', 'artwork', 'local']] + [row(first_layout)], extra=36)
    page.reload()
    expect(page.locator('.lib-card')).to_have_count(len(decks) + 36)
    search = page.get_by_role('searchbox', name='Поиск методичек')
    for w, h in SIZES:
        viewport(page,w,h)
        no_overflow(page)
        assert page.locator('.lib-card').first.bounding_box()['width'] <= 306
        thumb = page.locator('.lib-thumbnail').first.bounding_box()
        assert abs(thumb['width']/thumb['height'] - 16/9) < .03
    viewport(page,1920,1080)
    capture(page, '01-lessons-gallery')
    viewport(page,1024,600)
    capture(page, '02-lessons-laptop')
    search.fill('АЛГОРИТМИЗАЦИИ')
    expect(page.locator('.lib-card')).to_have_count(1)
    search.fill('english LAB')
    expect(page.locator('.lib-card')).to_have_count(1)
    search.fill('несуществующий материал')
    expect(page.get_by_text('Методички не найдены')).to_be_visible()
    capture(page, '06-no-results')
    button(page, 'Очистить поиск').first.click()
    expect(search).to_have_value('')
    button(page,'Сортировка').click()
    page.get_by_role('menuitemradio',name='Название от Я до А').click()
    expect(page.locator('.lib-card-title').first).to_have_text('English Lab')
    button(page,'Сортировка').click()
    page.get_by_role('menuitemradio',name='Сначала больше слайдов').click()
    expect(page.locator('.lib-card-meta').first).to_contain_text('5 слайдов')
    button(page,'Сортировка').click()
    page.get_by_role('menuitemradio',name='Сначала старые').click()
    expect(page.locator('.lib-card-title').first).to_have_text('Тема курса 36')
    button(page,'Сортировка').click()
    page.get_by_role('menuitemradio',name='Название от Я до А').click()
    button(page, 'Компактный каталог').click()
    expect(page.locator('.lib-items')).to_have_attribute('data-view', 'list')
    capture(page, '03-lessons-list')
    trigger = button(page, 'Действия: Круговорот воды')
    trigger.focus()
    page.keyboard.press('ArrowDown')
    expect(menu(page, 'Просмотр')).to_be_focused()
    page.keyboard.press('End')
    expect(menu(page, 'Удалить с устройства')).to_be_focused()
    capture(page, '04-lesson-menu')
    page.keyboard.press('Escape')
    expect(trigger).to_be_focused()
    trigger.click()
    page.get_by_role('heading', name='Мои методички').click()
    expect(page.get_by_role('menu')).to_have_count(0)
    name, exported = download(page, lambda: choose(page, 'Круговорот воды', 'Экспортировать JSON'))
    assert name.endswith('.json') and json.loads(exported)['title'] == 'Круговорот воды'
    search.fill('тема курса')
    expect(page.locator('.lib-card')).to_have_count(36)
    scroll_reopens(page, 'Тема курса 8')
    expect(search).to_have_value('тема курса')
    expect(button(page, 'Компактный каталог')).to_have_attribute('aria-pressed', 'true')
    button(page, 'Очистить поиск').first.click()
    edge = page.locator('.lib-card-menu button').last
    edge.scroll_into_view_if_needed()
    edge.click()
    panel = page.get_by_role('menu').bounding_box()
    anchor = edge.bounding_box()
    assert panel['x'] >= 0 and panel['y'] >= 0
    assert panel['width'] <= 273
    assert panel['x'] + panel['width'] <= 1024 and panel['y'] + panel['height'] <= 600
    assert panel['y'] < anchor['y']
    page.keyboard.press('Escape')
    page.reload()
    expect(button(page, 'Компактный каталог')).to_have_attribute('aria-pressed', 'true')

    button(page, 'Шаблоны').click()
    expect(button(page, 'Предпросмотр По умолчанию')).to_be_visible()
    viewport(page,1440,900)
    capture(page, '07-template-gallery')
    button(page, 'Создать').click()
    capture(page, '11-create-menu')
    name, text = download(page, lambda: menu(page, 'Инструкция ИИ для создания шаблона').click())
    assert name == 'atlas-presentation-template-instructions.txt' and 'kind=presentation' in text
    trigger = button(page, 'Действия: По умолчанию')
    trigger.click()
    expect(menu(page, 'Удалить шаблон')).to_have_count(0)
    expect(menu(page, 'Редактировать')).to_have_count(0)
    name, text = download(page, lambda: menu(page, 'Инструкция ИИ для презентации').click())
    assert 'по-умолчанию' in name and 'LOCAL_ONLY_CANARY' not in text
    assert ('"master":' in text) and ('"$ref":"#/$defs/Presentation"' in text)
    trigger.click()
    menu(page, 'Предпросмотр').click()
    expect(page.get_by_role('dialog',name='По умолчанию')).to_be_visible()
    button(page, 'Следующий слайд').click()
    expect(page.get_by_role('dialog',name='По умолчанию').get_by_text('2 / 3')).to_be_visible()
    page.keyboard.press('Escape')
    expect(trigger).to_be_focused()

    button(page, 'Компактный каталог').click()
    capture(page, '08-template-list')
    button(page, 'Действия: Меловая рамка').click()
    capture(page, '12-template-menu')
    page.keyboard.press('Escape')
    page.get_by_role('searchbox',name='Поиск шаблонов').fill('шаблон для курса')
    scroll_reopens(page, 'Шаблон для курса 28', template=True)
    expect(page.get_by_role('searchbox',name='Поиск шаблонов')).to_have_value('шаблон для курса')
    button(page, 'Очистить поиск').first.click()
    button(page, 'Компоновки').click()
    expect(button(page, 'Галерея')).to_have_attribute('aria-pressed','true')
    capture(page, '09-layout-gallery')
    button(page, 'Компактный каталог').click()
    capture(page, '10-layout-list')
    button(page, 'Действия: Описание, изображение и вывод').click()
    expect(menu(page, 'Инструкция ИИ для презентации')).to_have_count(0)
    page.keyboard.press('Escape')
    button(page, 'Создать').click()
    name, text = download(page, lambda: menu(page, 'Инструкция ИИ для создания шаблона').click())
    assert name == 'atlas-layout-template-instructions.txt' and 'kind=layout' in text
    button(page, 'Создать').click()
    menu(page,'Создать вручную').click()
    expect(page.locator('.grid-designer')).to_be_visible()
    page.get_by_label('Название шаблона').fill('Новая проверочная сетка')
    button(page, 'Добавить столбец').click()
    button(page, 'Сохранить шаблон').click()
    expect(button(page, 'Предпросмотр Новая проверочная сетка')).to_be_visible()

    button(page, 'Презентации').click()
    expect(button(page,'Компактный каталог')).to_have_attribute('aria-pressed','true')
    import_template(page,'ai-main-template')
    capture(page,'22-import-ai-template')
    button(page,'Импортировать шаблон').click()
    title = 'Урок в зелёной рамке'
    expect(button(page,'Предпросмотр '+title)).to_be_visible()
    name, text = download(page, lambda: choose(page,title,'Инструкция ИИ для презентации'))
    assert 'урок-в-зелёной-рамке' in name and title in text
    choose(page,title,'Редактировать')
    expect(page.locator('.grid-designer')).to_be_visible()
    page.get_by_label('Название шаблона').fill('Рамка для урока')
    button(page,'Сохранить шаблон').click()
    expect(button(page,'Предпросмотр Рамка для урока')).to_be_visible()
    choose(page,'Рамка для урока','Создать копию')
    expect(button(page,'Предпросмотр Рамка для урока — копия')).to_be_visible()
    choose(page,'Рамка для урока — копия','Переименовать')
    expect(button(page,'Предпросмотр Переименованная копия')).to_be_visible()
    name, text = download(page, lambda: choose(page,'Переименованная копия','Экспортировать JSON'))
    assert name.endswith('.atlas.json') and json.loads(text)['kind']=='presentation'
    choose(page,'Переименованная копия','Создать методичку')
    expect(page.get_by_label('Название методички')).to_have_value('Переименованная копия')
    button(page,'В библиотеку').click()
    choose(page,'Переименованная копия','Удалить шаблон')
    expect(button(page,'Предпросмотр Переименованная копия')).to_have_count(0)
    button(page,'Мои методички').click()
    expect(button(page,'Открыть Переименованная копия')).to_be_visible()

    button(page,'Шаблоны').click()
    import_template(page,'ai-layout-template')
    button(page,'Импортировать шаблон').click()
    expect(page.get_by_role('navigation',name='Тип шаблона').get_by_role('button',name='Компоновки')).to_have_attribute('aria-current','page')
    choose(page,'Наблюдение и вывод','Редактировать')
    expect(page.locator('.grid-designer')).to_be_visible()
    page.get_by_label('Название шаблона').fill('Наблюдение и вывод — проверено')
    button(page,'Сохранить шаблон').click()
    _, text = download(page, lambda: choose(page,'Наблюдение и вывод — проверено','Экспортировать JSON'))
    assert json.loads(text)['kind']=='layout'

    button(page,'Мои методички').click()
    for name in ['water-frame','solar-grid','algorithm-font','map-standard','artwork-lesson']:
        import_lesson(page,name)
        if name=='water-frame':
            capture(page,'18-import-ai-lesson')
        button(page,'Открыть в редакторе').click()
        expect(page.get_by_role('textbox',name='Заметки преподавателя')).not_to_have_value('')
        if name=='map-standard':
            page.locator('.thumb').nth(1).click()
            page.get_by_label('Режим области слайда').select_option(label='Наблюдение и вывод — проверено')
        button(page,'Показать').click()
        if name=='water-frame':
            capture(page,'19-frame-header')
        if name=='solar-grid':
            button(page,'Следующий слайд').click()
            expect(page.locator('.atlas-preview-panel img')).to_be_visible()
            capture(page,'20-complex-grid')
        if name=='algorithm-font':
            page.wait_for_function("Array.from(document.fonts).some(font => font.family.startsWith('AtlasUser') && font.status === 'loaded')")
            styled = page.locator('.atlas-preview-panel .atlas-slide-text').filter(has_text='Основы алгоритмизации')
            assert styled.evaluate("el => getComputedStyle(el.querySelector('span')).fontFamily.includes('AtlasUser')")
            capture(page,'21-custom-font')
        if name=='artwork-lesson':
            expect(page.locator('.atlas-preview-panel .atlas-background-image')).to_be_visible()
            expect(page.locator('.atlas-preview-panel .atlas-object-image')).to_be_visible()
            expect(page.locator('.atlas-preview-panel .atlas-shape path').first).to_be_visible()

        button(page,'Закрыть').click()
        _, regenerated = download(page, lambda: button(page,'Экспортировать JSON').click())
        actual = json.loads(regenerated)
        assert actual['id'] != fixture(name)['id'] and len(actual['slides']) == len(fixture(name)['slides'])
        button(page,'В библиотеку').click()
    page.evaluate('navigator.serviceWorker.ready')
    page.context.set_offline(True)
    page.reload()
    expect(button(page,'Открыть Основы алгоритмизации').first).to_be_visible()
    no_overflow(page)
    page.context.set_offline(False)
    assert not errors, errors


def mobile(browser, url, catalog, decks):
    for w,h in [(360,640),(390,844),(430,932),(844,390)]:
        context = browser.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=2,user_agent=MOBILE)
        page=context.new_page()
        page.set_default_timeout(7000)
        page.goto(url)
        db_seed(page,decks,[row(catalog['frame']), row(fixture('ai-layout-template'))])
        page.reload()
        expect(button(page,'Открыть Круговорот воды')).to_be_visible()
        expect(button(page,'Создать')).to_have_count(0)
        expect(button(page,'Импортировать JSON методички')).to_have_count(0)
        no_overflow(page)
        if w==390:
            capture(page,'15-mobile-gallery')
        button(page,'Компактный каталог').tap()
        no_overflow(page)
        if w==390:
            capture(page,'16-mobile-list')
        button(page,'Действия: Круговорот воды').tap()
        expect(menu(page,'Редактировать')).to_have_count(0)
        menu(page,'Просмотр').tap()
        expect(page.locator('.atlas-viewer')).to_be_visible()
        no_overflow(page)
        if w==390:
            capture(page,'17-mobile-viewer')
        button(page,'Закрыть').tap()
        if button(page,'Навигация').is_visible():
            button(page,'Навигация').tap()
        button(page,'Шаблоны').tap()
        expect(button(page,'Создать')).to_have_count(0)
        expect(button(page,'Импортировать шаблон JSON')).to_have_count(0)
        button(page,'Действия: Меловая рамка').tap()
        expect(menu(page,'Редактировать')).to_have_count(0)
        name, text=download(page,lambda: menu(page,'Инструкция ИИ для презентации').tap())
        assert name.endswith('.txt') and 'Меловая рамка' in text
        no_overflow(page)
        context.close()


def token(claims):
    return 'eyJhbGciOiJIUzI1NiJ9.' + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=') + '.Zml4dHVyZQ'


def cloud(context, url, catalog, decks):
    page = context.new_page()
    page.set_default_timeout(7000)
    page.on('dialog',lambda dialog: dialog.accept())
    api='https://atlas-test.supabase.co/**'
    user={'id':OWNER,'aud':'authenticated','role':'authenticated','email':'teacher@example.org',
          'app_metadata':{},'user_metadata':{},'created_at':'2025-11-20T00:00:00Z'}
    access=token({'sub':OWNER,'role':'authenticated','exp':int(time.time())+3600})
    dirty=copy.deepcopy(catalog['local'])
    old=copy.deepcopy(dirty)
    old['deck']['title']='CLOUD_VERSION_CANARY'
    old['deck']['master']['name']=old['deck']['title']
    old['description']='Облачный оригинал'
    from working_api import WorkingAPI
    publications={}
    working=WorkingAPI(publications)
    working.seed(old,'template',2)
    working.seed(catalog['roles'],'template')

    def endpoint(route):
        request=route.request
        path=urlparse(request.url).path
        headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'}
        def emit(data,status=200):
            route.fulfill(json=data,status=status,headers=headers)
        if request.method=='OPTIONS':
            return emit({})
        if path=='/auth/v1/token':
            return emit({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_in':3600,'user':user})
        if path=='/auth/v1/user':
            return emit(user)
        if working.route(route, emit):
            return
        if path=='/rest/v1/rpc/atlas_get_courses':
            return emit({'revision':0,'courses':[],'lessons':{}})
        if path=='/storage/v1/object/list/presentations':
            return emit([{'name':k+'.json'} for k in publications])
        if path.startswith('/storage/v1/object/public/presentations/'):
            identifier=path.rsplit('/',1)[1][:-5]
            return emit(publications[identifier]) if identifier in publications else emit({},404)
        return emit({},404)

    context.route(api, endpoint)
    page.goto(url)
    expect(page.get_by_text('Библиотека преподавателя')).to_be_visible()
    page.locator('.account').get_by_role('button',name='Войти').click()
    page.get_by_label('Электронная почта').fill(user['email'])
    page.get_by_label('Пароль').fill('fixture-password')
    page.get_by_role('dialog').get_by_role('button',name='Войти').click()
    expect(button(page,'Шаблоны')).to_be_visible()
    visible=catalog['frame']
    external=copy.deepcopy(catalog['artwork'])
    external_url='https://assets.example.org/illustration.png'
    external['deck']['slides'][0]['background']=external_url
    context.route(external_url, lambda route: route.fulfill(
        path=ROOT/'public'/'icons'/'atlas-192.png',
        content_type='image/png',headers={'Access-Control-Allow-Origin':'*'},
    ))
    db_seed(page,[decks[0]],[row(dirty,1),row(visible),row(external)])
    publications[decks[0]['id']]=decks[0]
    page.reload()
    button(page,'Шаблоны').click()
    expect(page.get_by_text('Есть локальные изменения')).to_be_visible()
    expect(page.locator('.lib-card').filter(has_text=visible['deck']['title']).get_by_text('На устройстве и в облаке')).to_be_visible()
    expect(page.get_by_role('button',name='Синхронизация: Обнаружен конфликт')).to_be_visible()
    capture(page,'13-template-statuses')
    count=len(working.document_reads)
    _, text=download(page,lambda: choose(page,dirty['deck']['title'],'Инструкция ИИ для презентации'))
    assert 'LOCAL_ONLY_CANARY' in text and 'CLOUD_VERSION_CANARY' not in text and len(working.document_reads)==count
    _, text=download(page,lambda: choose(page,external['deck']['title'],'Инструкция ИИ для презентации'))
    assert external_url not in text and 'data:image/png;base64,' in text and len(working.document_reads)==count
    button(page,'Действия: '+visible['deck']['title']).click()
    expect(menu(page,'Сохранить в облаке')).to_have_count(0)
    page.keyboard.press('Escape')
    expect(page.locator('.lib-card').filter(has_text=visible['deck']['title']).get_by_text('На устройстве и в облаке')).to_be_visible()
    assert ('template',visible['deck']['id']) in working.documents
    button(page,'Мои методички').click()
    choose(page,decks[0]['title'],'Удалить с устройства')
    expect(button(page,'Открыть '+decks[0]['title'])).to_have_count(1)
    button(page,'Действия: '+decks[0]['title']).click()
    expect(menu(page,'Сохранить на устройство')).to_be_visible()
    expect(menu(page,'Удалить с устройства')).to_have_count(0)
    page.keyboard.press('Escape')
    button(page,'Опубликованные').click()
    expect(button(page,'Открыть '+decks[0]['title'])).to_be_visible()
    assert decks[0]['id'] in publications


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--cloud-dist',type=Path)
    parser.add_argument('--cloud-only',action='store_true')
    args=parser.parse_args()
    data=templates()
    decks=[fixture(name) for name in ['water-frame','solar-grid','algorithm-font','map-standard']]
    extra=copy.deepcopy(decks[-1])
    extra['id']=str(uuid.uuid4())
    extra['title']='English Lab'
    extra['slides'][0]['items'][0]['text']='English Lab'
    extra['slides'][0]['items'][1]['text']='A city walk'
    decks.append(extra)
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as playwright:
        root=Path(temp)
        (root/'lessons').symlink_to(ROOT/'dist',target_is_directory=True)
        if args.cloud_dist:
            (root/'cloud').symlink_to(args.cloud_dist.resolve(),target_is_directory=True)
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=temp))
        Thread(target=server.serve_forever,daemon=True).start()
        browser=playwright.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox'])
        try:
            base=f'http://127.0.0.1:{server.server_port}'
            if not args.cloud_only:
                context=browser.new_context(viewport={'width':1440,'height':900})
                desktop(context.new_page(),base+'/lessons/',data,decks)
                context.close()
                mobile(browser,base+'/lessons/',data,decks)
                print('PASS: desktop and handset libraries, menus, editor, projector, offline use and generated JSON imports',flush=True)
            if args.cloud_dist:
                cloud(browser.new_context(viewport={'width':1440,'height':900}),base+'/cloud/',data,decks)
                print('PASS: cloud statuses, automatic template upload, instruction from local revision, publication after local deletion',flush=True)
        finally:
            browser.close()
            server.shutdown()

if __name__=='__main__':
    main()
