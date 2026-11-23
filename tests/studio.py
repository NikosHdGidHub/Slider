"""Production UI acceptance. ATLAS_CAPTURES optionally retains screenshots of the imported deck."""
import json
import os
import shutil
import tempfile
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect
from browser import ROOT, QuietHandler

def exercise(page, tmp):
    page.set_default_timeout(7000)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept("Переименованный шаблон") if d.type=="prompt" else d.accept())
    button = lambda name: page.get_by_role("button", name=name, exact=True)
    def click(name): button(name).click()
    def notice(text): expect(page.locator(".toast")).to_contain_text(text)
    def guide():
        with page.expect_download() as event: click("Скачать инструкцию для ИИ")
        assert event.value.suggested_filename=="atlas-instructions.txt"
        return Path(event.value.path()).read_text(encoding="utf-8")
    def upload(name, file):
        with page.expect_file_chooser() as event: click(name)
        event.value.set_files(file)
    def action(name):
        click("Действия с методичкой")
        click(name)
    def export():
        with page.expect_download() as event: action("Экспортировать JSON")
        return json.loads(Path(event.value.path()).read_text())
    def import_doc(d):
        click("Импорт JSON")
        page.get_by_label("Или вставьте JSON").fill(json.dumps(d,ensure_ascii=False))
        click("Импортировать");click("Открыть в редакторе")
    click("Шаблоны")
    assert "Живая природа" in guide()
    click("Создать шаблон")
    page.get_by_label("Название методички").fill("Мой тестовый шаблон")
    page.get_by_label("Описание шаблона").fill("Для совместного чтения")
    click("Слайд");click("Сохранить шаблон");notice("ровно три")
    expect(page.locator(".thumb")).to_have_count(4)
    click("Удалить слайд");click("Сохранить шаблон")
    expect(page.locator(".template-card").filter(has_text="Мой тестовый шаблон")).to_have_count(1)
    assert "Для совместного чтения" in guide()
    card=page.locator(".template-card").filter(has_text="Мой тестовый шаблон")
    card.locator("summary").click()
    card.get_by_role("button",name="Переименовать").click()
    card=page.locator(".template-card").filter(has_text="Переименованный шаблон")
    expect(card).to_be_visible()
    assert "Переименованный шаблон" in guide()
    with page.expect_download() as f: card.get_by_role("button",name="Экспорт шаблона").click()
    tfile=tmp/"template.json";f.value.save_as(tfile)
    card.get_by_role("button",name="Создать презентацию").click()
    expect(page.locator(".thumb")).to_have_count(3)
    page.locator(".thumb").nth(1).click()
    page.get_by_label("Заметки преподавателя",exact=True).fill("Проверка заметок")
    page.get_by_label("Применить компоновку").select_option(label="Три карточки")
    edited=export()
    assert edited["slides"][1]["notes"]=="Проверка заметок"
    assert len([o for o in edited["slides"][1]["items"] if o.get("role")=="decoration"])==2
    click("В библиотеку")
    card=page.locator(".template-card").filter(has_text="Переименованный шаблон")
    card.locator("summary").click();card.get_by_role("button",name="Удалить шаблон").click()
    expect(card).to_have_count(0);assert "Переименованный шаблон" not in guide()
    upload("Импорт шаблона",tfile);expect(card).to_have_count(1)
    click("Компоновки"); click("Создать шаблон")
    page.get_by_label("Название методички").fill("Одна карточка")
    click("Фигура");click("Сохранить шаблон")
    expect(page.locator(".template-card").filter(has_text="Одна карточка")).to_have_count(1)
    click("Мои методички")
    click("Импорт JSON");upload("Выбрать файл JSON",ROOT/"docs/examples/water-cycle.json")
    click("Открыть в редакторе")
    expected=json.loads((ROOT/"docs/examples/water-cycle.json").read_text())
    captures=os.getenv("ATLAS_CAPTURES")
    if captures:Path(captures).mkdir(parents=True,exist_ok=True)
    canvas=page.locator(".canvas")
    for i,s in enumerate(expected["slides"]):
        page.locator(".thumb").nth(i).click()
        expect(canvas.locator(".atlas-item")).to_have_count(len(s["items"]))
        page.evaluate("document.fonts.ready")
        expect(canvas.locator("[data-overflow]")).to_have_count(0)
        if captures:canvas.locator(".atlas-stage").screenshot(path=Path(captures)/f"slide-{i+1}.png")
    page.locator(".thumb").first.click()
    canvas.get_by_text("Путешествие",exact=True).dblclick()
    inline=canvas.locator('[contenteditable="plaintext-only"]')
    expect(inline).to_be_focused()
    inline.fill("Маршрут");inline.press("Control+Enter")
    expect(canvas.get_by_text("Маршрут",exact=True)).to_be_visible()
    click("Фигура")
    for kind,tag in {"rect":"rect","circle":"circle","ellipse":"ellipse","triangle":"polygon","polygon":"polygon","star":"polygon","arrow":"polygon","line":"line","polyline":"polyline","curve":"path","path":"path","rounded":"rect"}.items():
        page.get_by_label("Форма",exact=True).select_option(kind)
        expect(canvas.locator(".atlas-selected .atlas-shape > g > "+tag)).to_have_count(1)
    page.get_by_label("Текст",exact=True).fill("Капля воды")
    panel=page.locator(".inspector")
    panel.locator("summary",has_text="Абзацы и фрагменты").click()
    page.locator("#atlas-edit-text").evaluate("(el)=>el.setSelectionRange(0,5)")
    click("Выделить фрагмент")
    rich=panel.locator("details").filter(has=page.locator("summary",has_text="Абзацы и фрагменты")).first
    rich.get_by_label("Полужирный",exact=True).check()
    rich.get_by_label("Гарнитура",exact=True).select_option("serif")
    rich.get_by_label("Размер шрифта",exact=True).fill("63")
    click("Добавить абзац");page.get_by_label("Текст фрагмента").fill("Вода")
    rich.get_by_label("Список",exact=True).select_option("number")
    panel.locator("summary",has_text="Абзацы и фрагменты").click()
    page.get_by_label("Заливка",exact=True).select_option("linear")
    click("Добавить цвет")
    page.get_by_label("Тень",exact=True).check()
    page.get_by_label("Форма",exact=True).select_option("path")
    click("Добавить узел")
    page.get_by_role("button",name="Безье",exact=True).first.click()
    circle=canvas.locator(".path-handles circle").first
    b=circle.bounding_box()
    page.mouse.move(b["x"]+b["width"]/2,b["y"]+b["height"]/2)
    page.mouse.down();page.mouse.move(b["x"]+25,b["y"]+12);page.mouse.up()
    page.get_by_label("Замкнуть контур").check()
    click("Свойства слайда")
    upload("Изображение",{"name":"triangle.svg","mimeType":"image/svg+xml","buffer":b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90"><path d="M0 80 Q45 0 90 80 Z" fill="#1a7"/></svg>'})
    notice("векторные")
    upload("Изображение",{"name":"unsupported.svg","mimeType":"image/svg+xml","buffer":b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>'})
    notice("не поддерживается")
    doc=export()
    shape=doc["slides"][0]["items"][-2]
    assert shape["text"]=="Капля воды\nВода" and shape["paragraphs"][0]["runs"][0]["bold"]
    assert shape["paragraphs"][1]["list"]=="number" and shape["paragraphs"][0]["runs"][0]["font"]=="serif"
    assert len(shape["fill"]["stops"])==3 and shape["closed"] and len(shape["nodes"])==4
    assert doc["slides"][0]["items"][-1]["nodes"][0]["out"]
    click("В библиотеку");import_doc(doc);again=export()
    assert again["slides"]==doc["slides"] and again["theme"]==doc["theme"]
    assert not errors,errors

if __name__=="__main__":
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        root=Path(tmp);(root/"lessons").symlink_to(ROOT/"dist",target_is_directory=True)
        http=ThreadingHTTPServer(("127.0.0.1",0),partial(QuietHandler,directory=tmp))
        Thread(target=http.serve_forever,daemon=True).start()
        browser=p.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"),args=["--no-sandbox"])
        page=browser.new_page(viewport={"width":1536,"height":960})
        page.goto(f"http://127.0.0.1:{http.server_port}/lessons/")
        exercise(page,root)
        browser.close();http.shutdown()
        print("PASS: templates, live catalog downloads, layout, five imported slides, rich text, editable vectors, SVG and JSON round trip")

