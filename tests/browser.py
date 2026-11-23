"""Production acceptance smoke. Run after npm run build. Requires Python Playwright + Chromium."""
import json
import os
import shutil
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def run(page, ctx, browser, url, temp):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.set_default_timeout(6000)
    def click(name): page.get_by_role("button", name=name, exact=True).click()
    def action(name):
        click("Действия с методичкой")
        click(name)
    def create():
        click("Создать методичку")
        page.get_by_label("Название",exact=True).fill("Тестовый урок")
        click("Создать")
    page.goto(url)
    expect(page.get_by_role('heading', name='Мои методички')).to_be_visible()
    click("Открыть пример")
    with page.expect_popup() as popup: click("Открыть экран учеников")
    projector = popup.value
    click("Следующий слайд")
    expect(projector.get_by_text("Горизонтали",exact=True)).to_be_visible()
    expect(projector.get_by_text("Заметки преподавателя")).to_have_count(0)
    click("Только слайды")
    click("Заметки")
    click("Закрыть")
    create()
    click("Добавить текст")
    page.get_by_role("textbox",name="Текст",exact=True).fill("Высота")
    page.get_by_label("Размер шрифта").fill("64")
    page.get_by_label("Цвет текста").fill("#113311")
    item = page.locator(".canvas .atlas-item").first
    box = item.bounding_box()
    page.mouse.move(box['x']+10,box['y']+10)
    page.mouse.down();page.mouse.move(box['x']+45,box['y']+34);page.mouse.up()
    page.get_by_role("textbox",name="Заметки преподавателя").fill("Первая заметка")
    click("Свойства слайда")
    page.get_by_label("Цвет фона").fill("#efe8cf")
    # Insert a real image through the file picker.
    with page.expect_file_chooser() as chooser: click("Изображение")
    chooser.value.set_files(ROOT/"public/icons/atlas-192.png")
    expect(page.locator(".canvas img")).to_be_visible()
    handle=page.locator(".canvas .atlas-resize").bounding_box()
    page.mouse.move(handle['x']+2,handle['y']+2)
    page.mouse.down();page.mouse.move(handle['x']+30,handle['y']+30);page.mouse.up()
    click("Слайд")
    page.get_by_role("textbox",name="Заметки преподавателя").fill("Вторая заметка")
    click("Переместить выше")
    click("Слайд");click("Удалить слайд")
    expect(page.locator(".thumb")).to_have_count(2)
    action("Подготовить к офлайн-показу")
    expect(page.get_by_text("Готово к офлайн-показу.",exact=False)).to_be_visible()
    ctx.set_offline(True);page.reload()
    click_by_title=page.get_by_role("button",name="Тестовый урок",exact=False).first
    click_by_title.click()
    expect(page.get_by_role("textbox",name="Заметки преподавателя")).to_have_value("Вторая заметка")
    page.locator(".thumb").nth(1).click()
    expect(page.locator(".canvas img")).to_be_visible()
    page.get_by_role("textbox",name="Заметки преподавателя").fill("Офлайн-заметка")
    with page.expect_download() as download: action("Экспортировать JSON")
    output=Path(temp)/"lesson.json"
    download.value.save_as(output)
    doc=json.loads(output.read_text())
    slide=doc['slides'][1]
    assert slide['notes']=="Офлайн-заметка" and slide['color']=="#efe8cf"
    text,image=slide['items']
    assert text['text']=="Высота" and text['size']==64 and text['x']!=80 and text['color']=="#113311"
    assert image['src'].startswith('data:image/') and image['w']!=192 and image['w']==image['h']
    click("В библиотеку")
    click("Удалить локальную методичку")
    expect(page.get_by_text("Здесь появятся ваши методички")).to_be_visible()
    create()
    ctx.set_offline(False)
    fresh=browser.new_context()
    freshpage=fresh.new_page()
    freshpage.goto(url)
    freshpage.get_by_role("button",name="Импорт JSON").click()
    with freshpage.expect_file_chooser() as chooser:
        freshpage.get_by_role("button",name="Выбрать файл JSON").click()
    chooser.value.set_files(output)
    freshpage.locator(".thumb").nth(1).click()
    expect(freshpage.locator(".canvas img")).to_be_visible()
    expect(freshpage.get_by_role("textbox",name="Заметки преподавателя")).to_have_value("Офлайн-заметка")
    for _ in range(2):
        freshpage.locator(".canvas .atlas-item").last.click()
        freshpage.get_by_role("button",name="Удалить объект").click()
    expect(freshpage.locator(".canvas .atlas-item")).to_have_count(0)
    fresh.close()
    assert not errors, errors

if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as api:
        (Path(temp)/"lessons").symlink_to(ROOT/"dist",target_is_directory=True)
        server=ThreadingHTTPServer(("127.0.0.1",0),partial(QuietHandler,directory=temp))
        Thread(target=server.serve_forever,daemon=True).start()
        browser=api.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"),args=['--no-sandbox'])
        ctx=browser.new_context(viewport={"width":1440,"height":900})
        run(ctx.new_page(),ctx,browser,f"http://127.0.0.1:{server.server_port}/lessons/",temp)
        browser.close()
        server.shutdown()
        print("PASS: production editor, IndexedDB, clean-profile JSON, projector, offline PWA under /lessons/")
