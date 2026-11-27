"""Cloud Sync, owner-only metadata, two Chromium profiles and mobile transfer."""
import argparse
import base64
import copy
import json
import os
import re
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
from library_browser import MOBILE, OWNER, ROOT, Quiet, button, capture, choose, db_seed, fixture, no_overflow, token
from working_api import WorkingAPI

API = 'https://atlas-test.supabase.co/**'
SIZES = [(360, 640), (390, 844), (768, 1024), (1024, 600), (1366, 768), (1920, 1080), (2560, 1440)]
COURSE = '92c351a8-0000-4000-8000-000000000001'


def json_bytes(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())


def sync_panel(page):
    page.get_by_role('button', name=re.compile('^Синхронизация:')).click()
    return page.get_by_role('dialog', name='Синхронизация')


def refresh(page):
    panel = sync_panel(page)
    sync = button(panel, 'Синхронизировать сейчас')
    expect(sync).to_be_enabled()
    sync.click()
    button(panel, 'Закрыть').click()


def wait_revision(page, api, key, revision):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if api.documents.get(key, {}).get('meta', {}).get('revision', 0) >= revision:
            return
        page.wait_for_timeout(50)
    raise AssertionError(('revision not reached', key, revision, api.writes[-8:],
                          page.get_by_role('alert').all_text_contents(),
                          page.get_by_role('button', name=re.compile('^Синхронизация:')).all_text_contents()))


def run(browser, base, persistent=None, zoom=None):
    original = fixture('algorithm-font')
    original['title'] = 'Рабочая методичка'
    png = base64.b64encode((ROOT / 'public/icons/atlas-192.png').read_bytes()).decode()
    original['slides'][0]['background'] = 'data:image/png;base64,' + png
    # The fixture's font and the repeated background must travel once per hash.
    if len(original['slides']) > 1:
        original['slides'][1]['background'] = original['slides'][0]['background']
    deck_id = original['id']
    public = fixture('water-frame')
    public['id'] = deck_id
    public['title'] = 'Опубликованная версия'
    stand_alone = fixture('map-standard')
    stand_alone['title'] = 'Отдельная методичка с очень длинным названием для проверки мобильного каталога'
    api = WorkingAPI({deck_id: public, stand_alone['id']: stand_alone})
    user = {'id': OWNER, 'aud': 'authenticated', 'role': 'authenticated',
            'email': 'teacher@example.org', 'app_metadata': {}, 'user_metadata': {}, 'created_at': '2025-11-20T00:00:00Z'}
    access = token({'sub': OWNER, 'role': 'authenticated', 'exp': int(time.time()) + 3600})
    courses = {'revision': 1, 'courses': [{'id': COURSE, 'title': 'Математика', 'color': '#795da5'}],
               'lessons': {COURSE: [deck_id]}}
    transfer = {'expired': False, 'sent': [], 'picked': None}
    traffic = []
    slow = {'milliseconds': 0}
    context_errors = []

    def service(route):
        req = route.request
        path = urlparse(req.url).path
        headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
                   'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'}
        def emit(data, status=200):
            route.fulfill(json=data, status=status, headers=headers)
        if req.method == 'OPTIONS':
            return emit({})
        traffic.append(path)
        if path == '/auth/v1/token':
            return emit({'access_token': access, 'refresh_token': 'fixture-refresh',
                         'token_type': 'bearer', 'expires_in': 3600, 'user': user})
        if path == '/auth/v1/user':
            return emit(user)
        if path == '/rest/v1/rpc/atlas_get_courses':
            assert req.headers.get('authorization') == 'Bearer ' + access
            return emit(courses)
        if path == '/rest/v1/rpc/atlas_transfer_inspect':
            assert req.headers.get('authorization') == 'Bearer ' + access
            return emit({'status': 'expired'} if transfer['expired'] else {
                'status': 'waiting', 'code': 'AF921C', 'remaining_ms': 75000,
            })
        if path == '/rest/v1/rpc/atlas_transfer_send':
            selected = req.post_data_json['publication_id']
            transfer['sent'].append(selected)
            if selected not in api.publications:
                return emit({'status': 'missing_publication'})
            transfer['picked'] = selected
            return emit({'status': 'sent'})
        if path == '/storage/v1/object/list/presentations':
            return emit([{'name': key + '.json', 'updated_at': '2026-11-27T01:00:00Z'} for key in api.publications])
        if '/presentations/' in path:
            key = path.rsplit('/', 1)[-1][:-5]
            api.public_reads.append(key)
            return emit(api.publications[key]) if key in api.publications else emit({}, 404)
        if path.endswith('/atlas_publication_catalog') and slow['milliseconds']:
            time.sleep(slow['milliseconds'] / 1000)
        if api.route(route, emit):
            return
        return emit({}, 404)

    def login(context, seed=None, suffix=''):
        context.route(API, service)
        page = context.new_page()
        page.set_default_timeout(12000)
        page.on('dialog', lambda dlg: dlg.accept())
        page.on('pageerror', lambda error: context_errors.append(str(error)))
        page.goto(base + suffix)
        if seed:
            db_seed(page, seed, [])
        page.get_by_role('button', name=re.compile('^Войти( в аккаунт преподавателя)?$')).first.click()
        panel = page.get_by_role('dialog', name='Вход преподавателя')
        page.get_by_label('Электронная почта').fill(user['email'])
        page.get_by_label('Пароль').fill('fixture-password')
        button(panel, 'Войти').click()
        expect(panel).to_have_count(0)
        return page

    a_context = persistent or browser.new_context(viewport={'width': 1366, 'height': 768})
    b_context = browser.new_context(viewport={'width': 1366, 'height': 768})
    api.lose_response = True
    a = login(a_context, [original])
    key = ('lesson', deck_id)
    wait_revision(a, api, key, 1)
    expect(a.get_by_role('button', name='Синхронизация: Синхронизировано')).to_be_visible(timeout=20000)
    calls = [attempt for target, attempt in api.writes if target == key]
    assert len(calls) >= 2 and len(set(calls)) == 1, calls
    assert len(api.uploads) == len(set(api.uploads)) >= 2
    first_uploads = list(api.uploads)
    packed = api.documents[key]['document']
    print('RESOURCE_BYTES', json_bytes(original), json_bytes(packed), sum(map(len, api.assets.values())), len(api.assets), flush=True)

    b = login(b_context)
    expect(button(b, 'Открыть Математика')).to_be_visible()
    button(b, 'Открыть Математика').click()
    expect(button(b, 'Открыть Рабочая методичка')).to_be_visible()
    assert api.document_reads.count(key) == 0
    button(b, 'Открыть Рабочая методичка').click()
    expect(b.get_by_label('Название методички')).to_have_value('Рабочая методичка')
    assert api.document_reads.count(key) == 1
    b.wait_for_function('navigator.serviceWorker.controller !== null')
    button(a, 'Открыть Математика').click()
    button(a, 'Открыть Рабочая методичка').click()
    expect(a.get_by_role('button', name='Синхронизация: Редактируется на другом устройстве')).to_be_visible()
    a.get_by_label('Название методички').fill('Облачное изменение')
    wait_revision(a, api, key, 2)
    assert api.uploads == first_uploads
    assert api.publications[deck_id]['title'] == 'Опубликованная версия'

    b_context.set_offline(True)
    expect(b.get_by_role('button', name='Синхронизация: Офлайн')).to_be_visible()
    b.get_by_label('Название методички').fill('Локальное изменение')
    expect(b.get_by_text('Сохранено', exact=True)).to_be_visible()
    button(b, 'В библиотеку').click()
    if button(b, 'Сохранить черновик и выйти').is_visible():
        button(b, 'Сохранить черновик и выйти').click()
    b.reload()
    expect(button(b, 'Открыть Локальное изменение')).to_be_visible()
    panel = sync_panel(b)
    expect(panel.get_by_text('Офлайн', exact=True)).to_be_visible()
    capture(b, '02-sync-offline')
    button(panel, 'Закрыть').click()

    b_context.set_offline(False)
    expect(b.get_by_role('button', name='Синхронизация: Обнаружен конфликт')).to_be_visible()
    panel = sync_panel(b)
    button(panel, 'Облачное изменение').click()
    expect(panel.get_by_role('heading', name='Конфликт версий')).to_be_visible()
    capture(b, '03-sync-conflict')
    button(panel, 'Сохранить обе').click()
    expect(panel.get_by_role('heading', name='Конфликт версий')).to_have_count(0)
    button(panel, 'Закрыть').click()
    expect(button(b, 'Открыть Облачное изменение')).to_be_visible()
    button(b.get_by_role('navigation', name='Путь к курсу'), 'Мои методички').click()
    copy_title = 'Локальное изменение — локальная копия'
    expect(button(b, 'Открыть ' + copy_title)).to_be_visible()
    assert api.uploads == first_uploads
    choose(b, copy_title, 'Удалить рабочий черновик')
    expect(button(b, 'Открыть ' + copy_title)).to_have_count(0)
    panel = sync_panel(b)
    restore = button(panel, 'Восстановить «' + copy_title + '»')
    expect(restore).to_be_enabled()
    restore.click()
    expect(restore).to_have_count(0)
    expect(panel.get_by_text('Синхронизировано', exact=True)).to_be_visible()
    capture(b, '01-sync-complete')
    button(panel, 'Закрыть').click()
    expect(button(b, 'Открыть ' + copy_title)).to_be_visible()

    panel = sync_panel(b)
    button(panel, 'Временные резервные копии').click()
    button(panel, 'Восстановить копию «Локальное изменение»').click()
    expect(b.get_by_text('Резервная копия восстановлена как отдельный документ.', exact=True)).to_be_visible()
    button(panel, 'Закрыть').click()
    expect(button(b, 'Открыть Локальное изменение — из резервной копии')).to_be_visible()

    api.missing = True
    refresh(b)
    expect(b.get_by_role('button', name='Синхронизация: Ошибка синхронизации')).to_be_visible()
    panel = sync_panel(b)
    expect(panel.get_by_role('alert')).to_contain_text('cloud-sync.sql')
    capture(b, '12-sync-error')
    button(panel, 'Закрыть').click()
    api.missing = False
    refresh(b)
    expect(b.get_by_role('button', name='Синхронизация: Синхронизировано')).to_be_visible()

    before = len(api.public_reads)
    button(b, 'Опубликованные').click()
    expect(button(b, 'Открыть Математика')).to_be_visible()
    expect(button(b, 'Открыть ' + stand_alone['title'])).to_be_visible()
    no_overflow(b)
    capture(b, '04-published-gallery')
    expect(button(b, 'Открыть Опубликованная версия')).to_have_count(0)
    button(b, 'Компактный каталог').click()
    b.get_by_role('searchbox').fill('  ОПУБЛИКОВАННАЯ    версия  ')
    expect(button(b, 'Открыть Опубликованная версия')).to_be_visible()
    capture(b, '05-published-search')
    if zoom:
        zoom(a, 1.25)
        sync_panel(a)
        no_overflow(a)
        capture(a, '10-sync-125')
        button(a.get_by_role('dialog', name='Синхронизация'), 'Закрыть').click()
        zoom(a, 1.5)
        sync_panel(a)
        no_overflow(a)
        capture(a, '11-sync-150')
        button(a.get_by_role('dialog', name='Синхронизация'), 'Закрыть').click()
        zoom(a, 1)
    assert len(api.public_reads) == before
    button(b, 'Открыть Опубликованная версия').click()
    expect(b.locator('.atlas-viewer')).to_be_visible()
    assert api.public_reads[before:] == [deck_id]
    b.reload()
    button(b, 'Опубликованные').click()
    expect(button(b, 'Открыть Опубликованная версия')).to_be_visible()

    # Capture responsive states and benchmark exactly the same generated publication set.
    pair = '#transfer/' + str(uuid.uuid4()) + '/' + 'a' * 64
    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, user_agent=MOBILE)
    phone = login(mobile, suffix=pair)
    expect(phone.get_by_text('Компьютер подключён и ожидает методичку')).to_be_visible()
    mobile.set_offline(True)
    expect(phone.get_by_role('alert')).to_be_visible()
    assert button(phone, 'Передать на компьютер').count() == 0
    mobile.set_offline(False)
    expect(phone.get_by_text('Компьютер подключён и ожидает методичку')).to_be_visible()
    phone.get_by_label('Фильтр по курсам').select_option(label='Математика')
    expect(phone.get_by_role('radio', name=re.compile('Опубликованная версия'))).to_be_visible()
    phone.get_by_role('radio', name=re.compile('Опубликованная версия')).check()
    phone.get_by_label('Код совпадает с кодом на компьютере').check()
    capture(phone, '06-mobile-qr')
    phone.get_by_role('searchbox').fill('не существует')
    expect(button(phone, 'Передать на компьютер')).to_be_disabled()
    phone.get_by_role('searchbox').fill('')
    phone.get_by_role('radio', name=re.compile('Опубликованная версия')).check()
    phone.get_by_label('Код совпадает с кодом на компьютере').check()
    del api.publications[deck_id]
    button(phone, 'Передать на компьютер').click()
    expect(phone.get_by_role('alert')).to_have_text('Методичка больше не опубликована.')
    phone.get_by_label('Фильтр по курсам').select_option(label='Без курса')
    phone.get_by_role('radio', name=re.compile('Отдельная методичка')).check()
    phone.get_by_label('Код совпадает с кодом на компьютере').check()
    button(phone, 'Передать на компьютер').click()
    expect(phone.get_by_role('heading', name='Ссылка передана на компьютер')).to_be_visible()
    assert transfer['picked'] == stand_alone['id']
    assert len(api.public_reads) == before + 1
    transfer['expired'] = True
    phone.reload()
    expect(phone.get_by_role('alert')).to_have_text(re.compile('QR-код устарел'))
    transfer['expired'] = False
    api.publications[deck_id] = public
    for w, h in SIZES:
        b.set_viewport_size({'width': w, 'height': h})
        no_overflow(b)
        capture(b, f'07-published-{w}')
    for w, h in SIZES[:2]:
        phone.set_viewport_size({'width': w, 'height': h})
        phone.reload()
        expect(phone.get_by_text('Компьютер подключён и ожидает методичку')).to_be_visible()
        no_overflow(phone)
        capture(phone, f'08-qr-{w}')

    b.set_viewport_size({'width': 1366, 'height': 768})
    b.get_by_role('searchbox').fill('')
    for n in [10, 100, 500, 1000]:
        api.publications.clear()
        previous_work = {key: row for key, row in api.documents.items() if not row['meta']['title'].startswith('Рабочий тест')}
        api.documents = previous_work
        for i in range(n):
            item = {**stand_alone, 'id': str(uuid.UUID(int=(4 << 76) + (2 << 62) + i + 1)), 'title': f'Тестовый материал {i + 1}'}
            api.publications[item['id']] = item
            draft_id = str(uuid.UUID(int=(4 << 76) + (2 << 62) + 10000 + i))
            api.seed({**item, 'id': draft_id, 'title': f'Рабочий тест {i + 1}'})
        total = sum(map(json_bytes, api.publications.values()))
        start_catalog = len(api.catalog_requests)
        start_reads = len(api.public_reads)
        started = time.perf_counter()
        button(b, 'Мои методички').click()
        location = b.get_by_role('navigation', name='Путь к курсу')
        if location.is_visible():
            button(location, 'Мои методички').click()
        read_count = len(api.document_reads)
        b.get_by_role('searchbox').fill(f'Рабочий тест {n}')
        work_start = time.perf_counter()
        refresh(b)
        expect(button(b, f'Открыть Рабочий тест {n}')).to_be_visible(timeout=15000)
        work_elapsed = round((time.perf_counter() - work_start) * 1000)
        assert len(api.document_reads) == read_count
        b.get_by_role('searchbox').fill('')
        started = time.perf_counter()
        button(b, 'Опубликованные').click()
        expect(button(b, 'Открыть Тестовый материал 1')).to_be_visible()
        elapsed = round((time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        b.get_by_role('searchbox').fill(f'материал {n}')
        expect(button(b, f'Открыть Тестовый материал {n}')).to_be_visible()
        search = round((time.perf_counter() - started) * 1000)
        b.get_by_role('searchbox').fill('')
        qr_calls = len(api.catalog_requests)
        started = time.perf_counter()
        phone.reload()
        expect(phone.get_by_text(f'Доступно: {n} из {n}', exact=True)).to_be_visible()
        qr_elapsed = round((time.perf_counter() - started) * 1000)
        assert len(api.public_reads) == start_reads
        assert len(api.catalog_requests) - qr_calls == 1
        print('CATALOG', n, total, api.catalog_requests[-1],
              len(api.catalog_requests[start_catalog:qr_calls]), elapsed, search,
              len(api.catalog_requests) - qr_calls, qr_elapsed, work_elapsed, flush=True)
        if n == 1000:
            capture(b, '09-catalog-1000')
    slow['milliseconds'] = 150
    started = time.perf_counter()
    phone.reload()
    expect(phone.get_by_text('Доступно: 1000 из 1000', exact=True)).to_be_visible()
    print('QR_SLOW_150MS', round((time.perf_counter() - started) * 1000), flush=True)
    slow['milliseconds'] = 0
    no_overflow(phone)
    print('STORAGE_ESTIMATE', b.evaluate('navigator.storage.estimate()'), flush=True)
    assert not context_errors, context_errors
    mobile.close()
    b_context.close()
    if not persistent:
        a_context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('cloud_dist', type=Path)
    parser.add_argument('--zoom', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as folder, sync_playwright() as playwright:
        root = Path(folder)
        (root / 'atlas').symlink_to(args.cloud_dist.resolve(), target_is_directory=True)
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=folder))
        Thread(target=server.serve_forever, daemon=True).start()
        chromium = os.getenv('CHROMIUM_PATH') or shutil.which('chromium')
        browser = playwright.chromium.launch(executable_path=chromium, args=['--no-sandbox'])
        try:
            persistent = None
            zoom = None
            if args.zoom:
                persistent = playwright.chromium.launch_persistent_context(
                    str(root / 'profile'), executable_path=chromium,
                    viewport={'width': 1366, 'height': 768}, args=['--no-sandbox'])
                settings = persistent.new_page()
                settings.goto('chrome://settings/appearance')
                native_zoom = settings.locator('settings-appearance-page select').filter(
                    has=settings.locator('option', has_text='125%'))
                native_zoom.wait_for(timeout=10000)
                def zoom(page, factor):
                    native_zoom.select_option(label=f'{factor:.0%}')
                    page.wait_for_function('w => Math.abs(innerWidth - w) <= 2',
                                           arg=page.viewport_size['width'] / factor)
            run(browser, f'http://127.0.0.1:{server.server_port}/atlas/', persistent, zoom)
            if persistent:
                persistent.close()
        finally:
            browser.close()
            server.shutdown()
    print('PASS: durable queue, idempotent writes, private assets, independent profiles, deletion and restore, publications and QR')


if __name__ == '__main__':
    main()
