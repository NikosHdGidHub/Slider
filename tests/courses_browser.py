"""Exercise real Chromium UI, plus independent profiles against a controlled Supabase API."""
import argparse
import copy
import json
import os
import shutil
import tempfile
import time
import uuid
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright
from library_browser import (
    MOBILE, OWNER, ROOT, Quiet, button, capture, choose, db_seed, fixture, import_lesson,
    menu, no_overflow, token, viewport,
)

SIZES = [(360, 640), (390, 844), (768, 1024), (1024, 600), (1280, 720),
         (1366, 768), (1920, 1080), (2560, 1440)]
LONG = 'Пространственные композиции и практические занятия по компьютерной графике'


def create_folder(page, title, color='Зелёный', shot=None):
    button(page, 'Создать').click()
    menu(page, 'Новый курс').click()
    dialog = page.get_by_role('dialog', name='Новый курс')
    dialog.get_by_label('Название курса').fill(title)
    dialog.get_by_role('radio', name=color).check()
    if shot:
        capture(page, shot)
    button(dialog, 'Создать курс').click()
    expect(dialog).to_have_count(0)
    expect(button(page, 'Открыть ' + title)).to_be_visible()


def open_folder(page, title):
    button(page, 'Открыть ' + title).click()
    expect(page.get_by_role('heading', name=title)).to_be_visible()


def root(page):
    button(page.get_by_role('navigation', name='Путь к курсу'), 'Мои методички').click()
    expect(page.get_by_role('heading', name='Мои методички')).to_be_visible()


def destination(page, title, shot=None):
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Курс назначения').select_option(label=title)
    if shot:
        capture(page, shot)
    button(dialog, 'Переместить').click()
    expect(dialog).to_have_count(0)


def move_lesson(page, lesson, title, shot=None):
    choose(page, lesson, 'Переместить в курс')
    destination(page, title, shot)


def displayed(page, folder=False):
    selector = '.lib-card.course-folder' if folder else '.lib-card:not(.course-folder)'
    return [row.removeprefix('Открыть ') for row in page.locator(selector + ' .lib-card-open').evaluate_all(
        '(elements) => elements.map(element => element.getAttribute("aria-label"))'
    )]


def wait_order(page, titles, folder=False):
    selector = '.lib-card.course-folder' if folder else '.lib-card:not(.course-folder)'
    page.wait_for_function(
        """({selector,titles}) => JSON.stringify([...document.querySelectorAll(selector+' .lib-card-open')]
        .map(node => node.getAttribute('aria-label').replace(/^Открыть /,''))) === JSON.stringify(titles)""",
        arg={'selector': selector, 'titles': titles},
    )


def seed_lessons(count):
    base = fixture('map-standard')
    result = []
    for i in range(1, count + 1):
        lesson = copy.deepcopy(base)
        lesson['title'] = f'Занятие {i:02d}'
        lesson['id'] = str(uuid.uuid4())
        result.append(lesson)
    return result


def local(page, url, zoom=None):
    page.goto(url)
    page.set_default_timeout(9000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dlg: dlg.accept())
    expect(page.get_by_text('Здесь будут ваши методички')).to_be_visible()
    db_seed(page, seed_lessons(38), [])
    page.reload()
    expect(button(page, 'Открыть Занятие 01')).to_be_visible()
    capture(page, '01-library-before')
    create_folder(page, '3D-моделирование', shot='02-create-course')
    create_folder(page, 'Программирование', 'Синий')
    create_folder(page, LONG, 'Сиреневый')
    capture(page, '03-root-gallery')
    button(page, 'Действия: ' + LONG).click()
    capture(page, '17-course-menu')
    page.keyboard.press('Escape')
    open_folder(page, LONG)
    expect(page.get_by_text('В курсе пока нет доступных методичек')).to_be_visible()
    capture(page, '04-empty-course')
    root(page)

    button(page, 'Выбрать методички').click()
    for i in range(1, 4):
        page.get_by_role('checkbox', name=f'Выбрать: Занятие {i:02d}').check()
    capture(page, '05-bulk-selection')
    button(page, 'Переместить выбранные').click()
    destination(page, '3D-моделирование', '06-move-lessons')
    expect(button(page, 'Открыть Занятие 01')).to_have_count(0)
    move_lesson(page, 'Занятие 04', 'Программирование')

    search = page.get_by_role('searchbox', name='Поиск методичек')
    search.fill('ЗАНЯТИЕ 01')
    expect(button(page, 'Открыть Занятие 01')).to_be_visible()
    expect(page.locator('.lib-card').get_by_text('3D-моделирование', exact=True)).to_be_visible()
    capture(page, '07-global-search')
    button(page, 'Очистить поиск').click()
    search.fill('3d-моделирование')
    expect(button(page, 'Открыть 3D-моделирование')).to_be_visible()
    button(page, 'Очистить поиск').click()
    open_folder(page, '3D-моделирование')

    wait_order(page, ['Занятие 01', 'Занятие 02', 'Занятие 03'])
    button(page, 'Изменить порядок').click()
    expect(button(page, 'Открыть Занятие 01')).to_be_disabled()
    grip = page.locator('.lib-card').filter(has=button(page, 'Открыть Занятие 03')).locator('.course-grip')
    first = page.locator('.lib-card').filter(has=button(page, 'Открыть Занятие 01'))
    start = grip.bounding_box()
    target = first.bounding_box()
    page.mouse.move(start['x'] + start['width'] / 2, start['y'] + start['height'] / 2)
    page.mouse.down()
    page.mouse.move(target['x'] + 12, target['y'] + 23, steps=12)
    page.mouse.move(target['x'] + 13, target['y'] + 24)
    expect(first).to_have_attribute('data-drop', 'before')
    capture(page, '08-drag-gallery')
    page.mouse.up()
    wait_order(page, ['Занятие 03', 'Занятие 01', 'Занятие 02'])
    button(page, 'Компактный каталог').click()
    button(page, 'Ниже: Занятие 03').click()
    wait_order(page, ['Занятие 01', 'Занятие 03', 'Занятие 02'])
    list_grip = page.locator('.lib-card').filter(has=button(page, 'Открыть Занятие 01')).locator('.course-grip')
    list_target = page.locator('.lib-card').filter(has=button(page, 'Открыть Занятие 03'))
    list_grip.drag_to(list_target, target_position={'x': 36, 'y': 45})
    wait_order(page, ['Занятие 03', 'Занятие 01', 'Занятие 02'])
    button(page, 'Ниже: Занятие 03').press('Enter')
    wait_order(page, ['Занятие 01', 'Занятие 03', 'Занятие 02'])
    capture(page, '09-manual-list')
    button(page, 'Готово').click()
    button(page, 'Сортировка').click()
    page.get_by_role('menuitemradio', name='Название от А до Я').click()
    wait_order(page, ['Занятие 01', 'Занятие 02', 'Занятие 03'])
    button(page, 'Сортировка').click()
    page.get_by_role('menuitemradio', name='Вручную').click()
    wait_order(page, ['Занятие 01', 'Занятие 03', 'Занятие 02'])
    page.reload()
    expect(page.get_by_role('heading', name='3D-моделирование')).to_be_visible()
    wait_order(page, ['Занятие 01', 'Занятие 03', 'Занятие 02'])
    search.fill('02')
    expect(button(page, 'Изменить порядок')).to_be_disabled()
    choose(page, 'Занятие 02', 'Редактировать')
    expect(page.get_by_label('Название методички')).to_be_visible()
    button(page, 'В библиотеку').click()
    expect(search).to_have_value('02')
    button(page, 'Очистить поиск').click()

    button(page, 'Создать').click()
    menu(page, 'Новая методичка').click()
    page.get_by_label('Название', exact=True).fill('Вводное занятие')
    button(page.get_by_role('dialog'), 'Создать').click()
    expect(page.get_by_label('Название методички')).to_have_value('Вводное занятие')
    button(page, 'В библиотеку').click()
    assert displayed(page)[-1] == 'Вводное занятие'
    import_lesson(page, 'map-standard')
    button(page, 'Открыть в редакторе').click()
    imported = page.get_by_label('Название методички').input_value()
    button(page, 'В библиотеку').click()
    assert displayed(page)[-1] == imported
    choose(page, imported, 'Дублировать')
    expect(page.get_by_label('Название методички')).to_have_value(imported + ' — копия')
    button(page, 'В библиотеку').click()
    assert displayed(page)[-1] == imported + ' — копия'
    button(page, 'Создать').click()
    menu(page, 'Из шаблона').click()
    choose(page, 'По умолчанию', 'Создать методичку')
    expect(page.get_by_label('Название методички')).to_be_visible()
    button(page, 'В библиотеку').click()
    expect(page.get_by_role('heading', name='3D-моделирование')).to_be_visible()
    assert displayed(page)[-1] == 'По умолчанию'

    move_lesson(page, 'Занятие 02', 'Программирование')
    move_lesson(page, 'Занятие 03', 'Без курса')
    root(page)
    choose(page, 'Программирование', 'Переименовать')
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Название курса').fill('Алгоритмы')
    capture(page, '10-rename-course')
    button(dialog, 'Сохранить').click()
    choose(page, 'Алгоритмы', 'Изменить цвет')
    page.get_by_role('dialog').get_by_role('radio', name='Охра').check()
    capture(page, '11-course-colors')
    button(page.get_by_role('dialog'), 'Сохранить').click()
    choose(page, 'Алгоритмы', 'Изменить положение среди курсов')
    button(page, 'Выше: Алгоритмы').click()
    wait_order(page, ['Алгоритмы', '3D-моделирование', LONG], folder=True)
    button(page, 'Готово').click()
    choose(page, 'Алгоритмы', 'Удалить курс')
    expect(page.get_by_role('dialog').get_by_text('сохранятся.', exact=False)).to_be_visible()
    capture(page, '12-delete-course')
    button(page.get_by_role('dialog'), 'Удалить курс').click()
    expect(button(page, 'Открыть Алгоритмы')).to_have_count(0)
    expect(button(page, 'Открыть Занятие 02')).to_be_visible()
    expect(button(page, 'Открыть Занятие 04')).to_be_visible()

    choose(page, 'Занятие 04', 'Переместить в курс')
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Курс назначения').select_option(label='Создать новый курс…')
    dialog.get_by_label('Название курса').fill('Новый курс из перемещения')
    button(dialog, 'Переместить').click()
    expect(button(page, 'Открыть Новый курс из перемещения')).to_be_visible()

    button(page, 'Выбрать методички').click()
    button(page, 'Выбрать все').click()
    button(page, 'Переместить выбранные').click()
    destination(page, LONG)
    open_folder(page, LONG)
    assert len(displayed(page)) >= 32
    button(page, 'Открыть Занятие 35').scroll_into_view_if_needed()
    before = page.evaluate('scrollY')
    assert before > 350
    choose(page, 'Занятие 35', 'Редактировать')
    button(page, 'В библиотеку').click()
    page.wait_for_function('expected => Math.abs(scrollY - expected) < 3', arg=before)
    capture(page, '13-many-lessons')

    page.evaluate('window.scrollTo(0, 0)')
    for width, height in SIZES:
        viewport(page, width, height)
        no_overflow(page)
        if width in (360, 768, 1366, 1920):
            capture(page, 'viewport-' + str(width))
    if zoom:
        viewport(page, 1280, 720)
        for value in (1.25, 1.5):
            zoom(page, value)
            no_overflow(page)
            capture(page, 'zoom-' + str(round(value * 100)))
        zoom(page, 1)
    viewport(page, 1440, 900)
    page.goto(url)
    expect(page.get_by_role('heading', name=LONG)).to_be_visible()
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    page.context.set_offline(True)
    page.reload()
    expect(page.get_by_role('heading', name=LONG)).to_be_visible()
    capture(page, '14-offline-course')
    root(page)
    create_folder(page, 'Курс без интернета')
    assert not errors, errors
    page.context.set_offline(False)
    print('PASS: Chromium local courses, ownership, sorting, drag, import, templates, duplicate, scroll, offline and viewports')


def touch_library(browser, url):
    context = browser.new_context(
        viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
        device_scale_factor=2, user_agent=MOBILE,
    )
    try:
        page = context.new_page()
        page.goto(url)
        lessons = seed_lessons(2)
        db_seed(page, lessons, [])
        course_id = str(uuid.uuid4())
        page.evaluate("""({course, lessons}) => new Promise((resolve, reject) => {
          const db = indexedDB.open('atlas-lessons-v1')
          db.onsuccess = () => {
            const conn = db.result, tx = conn.transaction('libraryCourses', 'readwrite')
            tx.objectStore('libraryCourses').put({
              base: {revision: 0, courses: [course], lessons: {[course.id]: lessons}}, pending: []
            }, 'local')
            tx.oncomplete = () => { conn.close(); resolve() }
            tx.onerror = reject
          }
          db.onerror = reject
        })""", {
            'course': {'id': course_id, 'title': 'Занятия на телефоне', 'color': '#407f69'},
            'lessons': [l['id'] for l in lessons],
        })
        page.reload()
        button(page, 'Открыть Занятия на телефоне').tap()
        wait_order(page, ['Занятие 01', 'Занятие 02'])
        button(page, 'Компактный каталог').tap()
        button(page, 'Изменить порядок').tap()
        button(page, 'Выше: Занятие 02').tap()
        wait_order(page, ['Занятие 02', 'Занятие 01'])
        expect(page.locator('.course-grip').first).to_be_hidden()
        no_overflow(page)
        capture(page, '18-touch-order')
        button(page, 'Готово').tap()
        button(page, 'Открыть Занятие 02').tap()
        expect(page.locator('.atlas-viewer')).to_be_visible()
    finally:
        context.close()


def cloud(browser, url):
    public = fixture('water-frame')
    hidden = fixture('map-standard')
    published = {public['id']: public}
    revision = {'revision': 0, 'courses': [], 'lessons': {}}
    receipts = set()
    reads = []
    puts = []
    gap = {'missing': True, 'lost': True}
    user = {'id': OWNER, 'aud': 'authenticated', 'role': 'authenticated',
            'email': 'teacher@example.org', 'app_metadata': {}, 'user_metadata': {}, 'created_at': '2025-11-20T00:00:00Z'}
    access = token({'sub': OWNER, 'role': 'authenticated', 'exp': int(time.time()) + 3600})

    def service(route):
        req = route.request
        path = urlparse(req.url).path
        headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
                   'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'}
        def send(data, status=200):
            route.fulfill(json=data, status=status, headers=headers)
        if req.method == 'OPTIONS':
            return send({})
        if path == '/auth/v1/token':
            return send({'access_token': access, 'refresh_token': 'fixture-refresh', 'token_type': 'bearer', 'expires_in': 3600, 'user': user})
        if path == '/auth/v1/user':
            return send(user)
        if path in ('/rest/v1/atlas_templates', '/rest/v1/atlas_file_inventory', '/rest/v1/atlas_folders'):
            return send([])
        if path == '/rest/v1/rpc/atlas_get_courses':
            if gap['missing']:
                return send({'code': 'PGRST202', 'message': 'missing RPC'}, 404)
            return send(revision)
        if path == '/rest/v1/rpc/atlas_save_courses':
            request = req.post_data_json
            assert request['expected_owner'] == OWNER
            key = request['request_id']
            puts.append(key)
            if key in receipts:
                if gap['lost']:
                    return route.abort()
                return send({'accepted': True, 'snapshot': revision})
            if request['expected_revision'] != revision['revision']:
                return send({'accepted': False, 'snapshot': revision})
            revision.update(revision=revision['revision'] + 1, courses=request['courses'], lessons=request['lessons'])
            receipts.add(key)
            if gap['lost']:
                return route.abort()
            return send({'accepted': True, 'snapshot': revision})
        if path == '/rest/v1/rpc/atlas_lock_publication':
            return send(True)
        if path == '/rest/v1/atlas_publication_locks':
            return send([])
        if path == '/storage/v1/object/list/presentations':
            return send([{'name': key + '.json', 'updated_at': '2026-11-26T20:00:00Z'} for key in published])
        if req.method == 'GET' and path.startswith((
            '/storage/v1/object/public/presentations/',
            '/storage/v1/object/authenticated/presentations/',
            '/storage/v1/object/presentations/',
        )):
            identifier = path.rsplit('/', 1)[-1][:-5]
            reads.append(identifier)
            return send(published[identifier]) if identifier in published else send({}, 404)
        if path.startswith('/storage/v1/object/presentations/') and req.method in ('POST', 'PUT'):
            docs = req.post_data_buffer
            start, end = docs.find(b'{"version":'), docs.rfind(b'}') + 1
            if 0 <= start < end:
                identifier = path.rsplit('/', 1)[-1][:-5]
                published[identifier] = json.loads(docs[start:end])
                return send({'Key': 'presentations/' + identifier + '.json'})
        if path == '/storage/v1/object/presentations' and req.method == 'DELETE':
            for filename in req.post_data_json['prefixes']:
                published.pop(filename[:-5], None)
            return send([])
        return send({}, 404)

    def login(context, lessons):
        context.route('https://atlas-test.supabase.co/**', service)
        page = context.new_page()
        page.set_default_timeout(12000)
        page.on('dialog', lambda dlg: dlg.accept())
        page.goto(url)
        expect(page.get_by_text('Библиотека преподавателя')).to_be_visible()
        db_seed(page, lessons, [])
        page.locator('.account').get_by_role('button', name='Войти').click()
        page.get_by_label('Электронная почта').fill(user['email'])
        page.get_by_label('Пароль').fill('fixture-password')
        button(page.get_by_role('dialog'), 'Войти').click()
        expect(button(page, 'Создать')).to_be_visible()
        return page

    first = browser.new_context(viewport={'width': 1440, 'height': 900})
    second = browser.new_context(viewport={'width': 1440, 'height': 900})
    a = login(first, [public, hidden])
    expect(a.get_by_role('alert').filter(has_text='миграция courses.sql')).to_be_visible()
    assert displayed(a).count(public['title']) == 1
    create_folder(a, 'Курс в облаке')
    expect(a.get_by_role('alert').filter(has_text='миграция courses.sql')).to_be_visible()
    gap['missing'] = False
    button(a, 'Повторить синхронизацию').click()
    expect(a.get_by_role('alert').filter(has_text='Не удалось синхронизировать')).to_be_visible()
    capture(a, '15-sync-error')
    gap['lost'] = False
    a.evaluate('window.dispatchEvent(new Event("focus"))')
    a.wait_for_function("!document.querySelector('.course-sync')")
    assert len(puts) >= 2 and puts[-1] == puts[-2] and revision['revision'] == 1
    move_lesson(a, public['title'], 'Курс в облаке')
    move_lesson(a, hidden['title'], 'Курс в облаке')
    course_id = revision['courses'][0]['id']
    a.wait_for_function("""({course,id}) => new Promise(resolve => {
      const db=indexedDB.open('atlas-lessons-v1'); db.onsuccess=()=> {
        const conn=db.result; const tx=conn.transaction('libraryCourses');
        const q=tx.objectStore('libraryCourses').get('00000000-0000-4000-8000-000000000001');
        q.onsuccess=()=>resolve(q.result?.pending.length===0 && q.result?.base.lessons[course]?.includes(id));
        tx.oncomplete=()=>conn.close();
      };
    })""", arg={'course': course_id, 'id': hidden['id']})

    b = login(second, [])
    open_folder(b, 'Курс в облаке')
    expect(button(b, 'Открыть ' + public['title'])).to_be_visible()
    expect(button(b, 'Открыть ' + hidden['title'])).to_have_count(0)
    assert revision['lessons'][course_id] == [public['id'], hidden['id']]

    open_folder(a, 'Курс в облаке')
    count = reads.count(public['id'])
    button(a, 'Изменить порядок').click()
    button(a, 'Выше: ' + hidden['title']).click()
    button(a, 'Готово').click()
    expect(a.get_by_text('Изменения курсов ожидают синхронизации.')).to_have_count(0)
    assert reads.count(public['id']) == count

    b.wait_for_function('navigator.serviceWorker.controller !== null')
    second.set_offline(True)
    expect(b.get_by_text('Курсы доступны офлайн.', exact=False)).to_be_visible()
    button(b, 'Управление курсом').click()
    menu(b, 'Переименовать').click()
    b.get_by_role('dialog').get_by_label('Название курса').fill('Локальное название')
    button(b.get_by_role('dialog'), 'Сохранить').click()
    expect(b.get_by_role('heading', name='Локальное название')).to_be_visible()
    button(a, 'Управление курсом').click()
    menu(a, 'Переименовать').click()
    a.get_by_role('dialog').get_by_label('Название курса').fill('Облачное название')
    button(a.get_by_role('dialog'), 'Сохранить').click()
    expect(a.get_by_role('heading', name='Облачное название')).to_be_visible()
    a.wait_for_function("!document.querySelector('.course-sync')")
    second.set_offline(False)
    expect(b.get_by_role('alert').filter(has_text='другом устройстве')).to_be_visible()
    capture(b, '16-sync-conflict')
    button(b, 'Применить мои изменения').click()
    expect(b.get_by_role('alert').filter(has_text='другом устройстве')).to_have_count(0)
    b.wait_for_function("!document.querySelector('.course-sync')")
    assert revision['courses'][0]['title'] == 'Локальное название'
    assert set(revision['lessons'][course_id]) == {public['id'], hidden['id']}
    b.reload()
    expect(b.get_by_role('heading', name='Локальное название')).to_be_visible()

    # Saving a cloud-only document to this device keeps the UUID and the course.
    choose(b, public['title'], 'Сохранить на устройство')
    expect(b.get_by_text('Методичка сохранена на устройстве.', exact=True)).to_be_visible()
    assert displayed(b).count(public['title']) == 1
    expect(b.get_by_role('heading', name='Локальное название')).to_be_visible()

    # The publication URL works in a fresh, anonymous context.
    anon = browser.new_context()
    anon.route('https://atlas-test.supabase.co/**', service)
    reader = anon.new_page()
    reader.goto(url + '#p/' + public['id'])
    expect(reader.locator('.atlas-viewer')).to_be_visible()
    anon.close()

    structure = copy.deepcopy(revision)
    choose(a, hidden['title'], 'Редактировать')
    button(a, 'Опубликовать').click()
    published_dialog = a.get_by_role('dialog', name='Методичка опубликована')
    expect(published_dialog).to_be_visible()
    assert published_dialog.locator('input').input_value().endswith('#p/' + hidden['id'])
    button(published_dialog, 'Закрыть').click()
    updated = 'Методичка с обновлённой публикацией'
    a.get_by_label('Название методички').fill(updated)
    button(a, 'Обновить публикацию').click()
    expect(published_dialog).to_be_visible()
    assert published[hidden['id']]['title'] == updated
    button(published_dialog, 'Закрыть').click()

    a.get_by_label('Название методички').fill('Версия только на устройстве')
    button(a, 'В библиотеку').click()
    expect(a.get_by_role('dialog', name='Выход из редактора')).to_be_visible()
    button(a, 'Оставить локально и выйти').click()
    expect(button(a, 'Открыть Версия только на устройстве')).to_be_visible()
    published[hidden['id']]['title'] = 'Версия с другого устройства'
    choose(a, 'Версия только на устройстве', 'Редактировать')
    button(a, 'Синхронизовать').click()
    button(a, 'Загрузить опубликованную версию').click()
    expect(a.get_by_label('Название методички')).to_have_value('Версия с другого устройства')
    expect(button(a, 'Опубликовано')).to_be_visible()
    button(a, 'В библиотеку').click()
    expect(button(a, 'Открыть Версия с другого устройства')).to_be_visible()
    button(a, 'Опубликованные').click()
    publication = a.locator('.pub').filter(has_text='Версия с другого устройства')
    expect(publication).to_be_visible()
    button(publication, 'Снять с публикации').click()
    expect(publication).to_have_count(0)
    assert hidden['id'] not in published
    assert revision == structure
    button(a, 'Мои методички').click()
    expect(button(a, 'Открыть Версия с другого устройства')).to_be_visible()
    button(a, 'Мои файлы').click()
    expect(a.get_by_role('region', name='Библиотека файлов')).to_be_visible()
    button(a, 'В облаке').click()
    expect(button(a, 'В облаке')).to_have_attribute('aria-pressed', 'true')
    first.close()
    second.close()
    print('PASS: mock Supabase missing migration, response loss, offline conflict, independent profiles, publish/update/sync/unpublish and public UUID')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cloud-dist', type=Path)
    parser.add_argument('--cloud-only', action='store_true')
    parser.add_argument('--zoom', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as playwright:
        folder = Path(temp)
        (folder / 'atlas').symlink_to(ROOT / 'dist', target_is_directory=True)
        if args.cloud_dist:
            (folder / 'cloud').symlink_to(args.cloud_dist.resolve(), target_is_directory=True)
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=temp))
        Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
        chromium = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        browser = playwright.chromium.launch(executable_path=chromium, args=['--no-sandbox'])
        try:
            if not args.cloud_only:
                dimensions = {'width': 1440, 'height': 900}
                zoom = None
                if args.zoom:
                    context = playwright.chromium.launch_persistent_context(
                        str(folder / 'profile'), executable_path=chromium, viewport=dimensions,
                        accept_downloads=True, args=['--no-sandbox'])
                    settings = context.new_page()
                    settings.goto('chrome://settings/appearance')
                    native_zoom = settings.locator('settings-appearance-page select').filter(
                        has=settings.locator('option', has_text='125%'))
                    native_zoom.wait_for(timeout=10000)

                    def zoom(page, value):
                        native_zoom.select_option(label=f'{value:.0%}')
                        page.wait_for_function('expected => Math.abs(innerWidth - expected) <= 2', arg=page.viewport_size['width'] / value)
                else:
                    context = browser.new_context(viewport=dimensions, accept_downloads=True)
                local(context.new_page(), base + '/atlas/', zoom)
                context.close()
                touch_library(browser, base + '/atlas/')
            if args.cloud_dist:
                cloud(browser, base + '/cloud/')
        finally:
            browser.close()
            server.shutdown()


if __name__ == '__main__':
    main()
