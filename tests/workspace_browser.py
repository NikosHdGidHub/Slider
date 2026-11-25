"""Production workspace acceptance. ATLAS_WORKSPACE_CAPTURES saves the reviewed views."""

import json
import math
import os
import shutil
import tempfile
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from browser import ROOT, QuietHandler
from playwright.sync_api import expect, sync_playwright


SIZES = [(1024, 600), (1024, 768), (1280, 720), (1280, 800), (1366, 768),
         (1440, 900), (1536, 864), (1920, 1080), (2560, 1440), (2560, 1080),
         (1800, 1125), (1152, 720), (960, 600), (854, 480), (520, 630)]


def button(page, label):
    return page.get_by_role("button", name=label, exact=True)


def viewport(page, width, height):
    page.set_viewport_size({"width": width, "height": height})


def capture(page, name):
    output = os.getenv("ATLAS_WORKSPACE_CAPTURES")
    if output:
        Path(output).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=Path(output) / f"{name}.png", animations="disabled")


def no_page_scroll(page):
    box = page.evaluate("""() => {
      const {scrollWidth, scrollHeight, clientWidth, clientHeight} = document.scrollingElement
      return {scrollWidth, scrollHeight, clientWidth, clientHeight}
    }""")
    assert box["scrollWidth"] <= box["clientWidth"] + 1, box
    assert box["scrollHeight"] <= box["clientHeight"] + 1, box


def control_fits(page, locator):
    box = locator.bounding_box()
    assert box, locator
    width, height = page.evaluate("() => [innerWidth, innerHeight]")
    assert box["width"] > 0 and box["height"] > 0, (locator, box)
    assert box["x"] >= -1 and box["y"] >= -1, (locator, box)
    assert box["x"] + box["width"] <= width + 1, (locator, box)
    assert box["y"] + box["height"] <= height + 1, (locator, box)


def within_canvas(page):
    expect(page.locator(".canvas-viewport .atlas-stage")).to_be_visible()
    page.wait_for_function("""() => {
      const viewport = document.querySelector('.canvas-viewport').getBoundingClientRect()
      const slide = document.querySelector('.canvas-viewport .atlas-stage').getBoundingClientRect()
      return Math.abs(slide.width / slide.height - 16 / 9) < .01 &&
        slide.top >= viewport.top - 1 && slide.bottom <= viewport.bottom + 1 &&
        slide.left >= viewport.left - 1 && slide.right <= viewport.right + 1 &&
        (Math.abs(viewport.width - slide.width - 32) < 3 ||
         Math.abs(viewport.height - slide.height - 32) < 3)
    }""")


def download(page):
    with page.expect_download() as file:
        button(page, "Экспортировать JSON").click()
    return json.loads(Path(file.value.path()).read_text())


def set_zoom(page, percent):
    slider = page.get_by_role("slider", name="Масштаб, проценты")
    slider.evaluate("""(el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', {bubbles: true}))
    }""", str(percent))
    expect(page.get_by_label("Текущий масштаб")).to_have_text(f"{percent}%")
    page.wait_for_function("""scale => {
        const stage = document.querySelector('.canvas-viewport .atlas-stage');
        const space = stage.querySelector('.atlas-stage-space');
        return Math.abs(stage.getBoundingClientRect().width - 1280 * scale / 100) < 1 &&
          Math.abs(new DOMMatrix(getComputedStyle(space).transform).a - scale / 100) < .002;
    }""", arg=percent)


def drag(page, start, end, mouse="left"):
    page.mouse.move(*start)
    page.mouse.down(button=mouse)
    page.mouse.move(*end, steps=6)
    page.mouse.up(button=mouse)


def seed(page, deck, template):
    page.evaluate(r"""({deck, template}) => new Promise((resolve, reject) => {
      const req = indexedDB.open('atlas-lessons-v1', 2)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['lessons', 'templates'], 'readwrite')
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
        for (let i = 0; i < 32; i++) {
          const copy = { ...deck, id: crypto.randomUUID(), title: 'Методичка ' + (i + 1) }
          if (i === 9) {
            const full = { ...deck.slides[0], items: Array.from({length: 70}, (_, index) => ({
              ...deck.slides[0].items[0], id: crypto.randomUUID(),
              layerName: 'Длинное название слоя методического пособия ' + (index + 1),
            })) }
            copy.slides = [full, ...Array.from({length: 40}, () => ({
              ...deck.slides[0], id: crypto.randomUUID(), items: [],
            }))]
          }
          tx.objectStore('lessons').put({deck: copy, revision: 1, updated: i + 1})
          const t = { ...template, deck: { ...template.deck, id: crypto.randomUUID(),
            title: 'Шаблон ' + (i + 1) }}
          tx.objectStore('templates').put({template: t, revision: 1, cloudRevision: 0, dirty: true})
        }
        const longSlide = { ...deck.slides[0], notes: ('Вопросы и наблюдения для обсуждения.\n').repeat(180) }
        const longDeck = { ...deck, id: crypto.randomUUID(), title: 'Полевой практикум',
          slides: [longSlide, ...Array.from({length: 34}, (_, i) => ({
            ...deck.slides[0], id: crypto.randomUUID(), notes: 'Заметки слайда ' + (i + 2),
            items: deck.slides[0].items.map(item => ({...item, id: crypto.randomUUID()}))
          }))] }
        tx.objectStore('lessons').put({deck: longDeck, revision: 1, updated: Date.now() + 50_000})
      }
    })""", {"deck": deck, "template": template})


def check_library_position(page, card, open_card, exit_name, inspect=None):
    card.scroll_into_view_if_needed()
    page.wait_for_function("scrollY > 300")
    previous = page.evaluate("scrollY")
    open_card.click()
    expect(page.locator(".workspace")).to_be_visible()
    if inspect:
        inspect(page)
    button(page, exit_name).click()
    page.wait_for_function("previous => Math.abs(scrollY - previous) <= 2", arg=previous)


def crowded_workspace(page):
    strip = page.locator(".strip.workspace-scroll")
    layers = page.locator(".layer-list").first
    for region in [strip, layers]:
        assert region.evaluate("(el) => el.scrollHeight > el.clientHeight")
        assert region.evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")
        region.evaluate("(el) => el.scrollTop = el.scrollHeight")
        assert region.evaluate("(el) => el.scrollTop") > 0
    control_fits(page, button(page, "Слайд"))
    no_page_scroll(page)


def exercise(page, url):
    page.set_default_timeout(7000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto(url)
    button(page, "Создать методичку").click()
    page.get_by_label("Название", exact=True).fill("Как читать карту")
    button(page, "Создать").click()
    expect(button(page, "Отменить")).to_be_disabled()
    expect(button(page, "Повторить")).to_be_disabled()

    button(page, "Добавить текст").click()
    text = page.get_by_role("textbox", name="Текст", exact=True)
    text.fill("Читаем карту\nВысота, контуры и направление")
    page.get_by_label("Размер шрифта", exact=True).filter(visible=True).fill("52")
    note = page.get_by_role("textbox", name="Заметки преподавателя")
    note.fill("Начните с вопроса о том, как карта показывает высоту.")
    button(page, "Свойства слайда").click()
    page.get_by_label("Цвет фона").fill("#eef7f2")
    viewport(page, 1920, 1080)
    within_canvas(page)
    capture(page, "01-editor-1920x1080")
    viewport(page, 1024, 600)
    within_canvas(page)
    capture(page, "02-editor-1024x600")
    viewport(page, 1440, 900)
    page.locator(".layer-row").first.click()
    capture(page, "03-text-properties")

    button(page, "Фигура").click()
    shape = page.get_by_label("Форма", exact=True)
    shape.select_option("path")
    expect(page.locator(".path-handles")).to_be_visible()
    button(page, "Отменить").click()
    expect(shape).not_to_have_value("path")
    button(page, "Повторить").click()
    expect(shape).to_have_value("path")
    page.evaluate("""() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown',
      {code: 'KeyZ', key: 'я', ctrlKey: true, bubbles: true, cancelable: true}))""")
    expect(shape).not_to_have_value("path")
    page.evaluate("""() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown',
      {code: 'KeyZ', key: 'Я', shiftKey: true, metaKey: true, bubbles: true, cancelable: true}))""")
    expect(shape).to_have_value("path")

    geometry = page.locator("summary", has_text="Геометрия и слой")
    geometry.click()
    page.get_by_label("X", exact=True).fill("560")
    page.get_by_label("Y", exact=True).fill("160")
    page.get_by_label("Ширина", exact=True).fill("470")
    page.get_by_label("Высота", exact=True).fill("310")
    page.get_by_label("Замкнуть контур").check()
    capture(page, "04-shape-properties")
    title = page.get_by_label("Название методички")
    title.fill("Практикум по чтению топографических карт и полевым наблюдениям. " * 3)
    for width, height in SIZES:
        viewport(page, width, height)
        no_page_scroll(page)
        within_canvas(page)
        for label in ["В библиотеку", "Показать", "Экспортировать JSON", "Вписать"]:
            control_fits(page, button(page, label))
    title.fill("Как читать карту")
    button(page, "Показать свойства").click()
    expect(page.get_by_role("complementary", name="Свойства")).to_be_visible()
    button(page, "Свернуть свойства").click()
    viewport(page, 1440, 900)
    side = page.get_by_role("separator", name="Ширина панели свойств")
    side_box = side.bounding_box()
    start = (side_box["x"] + 4, side_box["y"] + 200)
    drag(page, start, (start[0] - 52, start[1]))
    expect(side).to_have_attribute("aria-valuenow", "346")
    within_canvas(page)
    height = page.get_by_role("separator", name="Высота заметок")
    height.focus()
    page.keyboard.press("ArrowUp")
    expect(height).to_have_attribute("aria-valuenow", "108")
    within_canvas(page)

    before = download(page)
    button(page, "Свернуть левую панель").click()
    button(page, "Свернуть свойства").click()
    button(page, "Заметки преподавателя").click()
    within_canvas(page)
    capture(page, "05-collapsed-panels")
    for scale in [25, 50, 75, 100, 150, 200, 300]:
        set_zoom(page, scale)
    viewport(page, 1280, 720)
    expect(page.get_by_label("Текущий масштаб")).to_have_text("300%")
    canvas = page.locator(".canvas-viewport")
    stage = canvas.locator(".atlas-stage")
    box = canvas.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    original = stage.bounding_box()
    drag(page, (x, y), (x + 90, y + 45), "middle")
    assert stage.bounding_box()["x"] > original["x"] + 70
    page.mouse.move(x, y)
    page.keyboard.down("Space")
    drag(page, (x, y), (x - 110, y - 45))
    page.keyboard.up("Space")
    assert stage.bounding_box()["x"] < original["x"]
    zoom_origin = stage.bounding_box()
    fixed_point = (x - zoom_origin["x"]) / zoom_origin["width"]
    page.mouse.move(x, y)
    page.keyboard.down("Control")
    page.mouse.wheel(0, 230)
    page.keyboard.up("Control")
    expect(page.get_by_label("Текущий масштаб")).not_to_have_text("300%")
    zoomed = stage.bounding_box()
    assert math.isclose((x - zoomed["x"]) / zoomed["width"], fixed_point, abs_tol=.002)
    capture(page, "06-zoomed-canvas")
    assert download(page) == before

    set_zoom(page, 75)
    stage_box = stage.bounding_box()
    obj = stage.locator("[data-item] .atlas-item").first
    old = obj.bounding_box()
    dx = 30
    # Use an interior point, away from the resize handle.
    start = (old["x"] + 12, old["y"] + 12)
    assert start[0] >= box["x"] and start[1] >= box["y"], (stage_box, old, box)
    drag(page, start, (start[0] + dx, start[1] + 15))
    new = obj.bounding_box()
    assert math.isclose(new["x"] - old["x"], dx, abs_tol=2), (stage_box, old, new)

    button(page, "Вписать").click()
    within_canvas(page)
    button(page, "Показать свойства").click()
    page.locator(".layer-row").filter(has_text="Фигура").click()
    page.get_by_label("X", exact=True).fill("565")
    page.get_by_label("Y", exact=True).fill("295")
    page.get_by_label("Ширина", exact=True).fill("180")
    page.get_by_label("Высота", exact=True).fill("130")
    button(page, "Свернуть свойства").click()
    selected = stage.locator(".atlas-selected")
    for scale in [25, 50, 75, 100, 150, 200, 300]:
        set_zoom(page, scale)
        bounds = selected.bounding_box()
        start = (bounds["x"] + bounds["width"] * .45, bounds["y"] + bounds["height"] * .45)
        drag(page, start, (start[0] + 10, start[1] + 7))
        moved = selected.bounding_box()
        assert math.isclose(moved["x"] - bounds["x"], 10, abs_tol=2), scale
        button(page, "Отменить").click()
        handle = stage.locator(".atlas-resize").bounding_box()
        start = (handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2)
        drag(page, start, (start[0] + 7, start[1] + 6))
        resized = selected.bounding_box()
        assert math.isclose(resized["width"] - bounds["width"], 7, abs_tol=2), scale
        button(page, "Отменить").click()
    set_zoom(page, 150)
    contour = selected.locator(".path-handles circle").first
    node = contour.bounding_box()
    start = (node["x"] + node["width"] / 2, node["y"] + node["height"] / 2)
    target = page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 280)", start)
    before_node = contour.get_attribute("cx")
    drag(page, start, (start[0] + 13, start[1] - 6))
    actual = contour.bounding_box()["x"] - node["x"]
    assert math.isclose(actual, 13, abs_tol=2), (actual, target, before_node, contour.get_attribute("cx"))
    button(page, "Отменить").click()
    button(page, "Вписать").click()
    button(page, "100%").click()
    expect(page.get_by_label("Текущий масштаб")).to_have_text("100%")
    button(page, "Вписать").click()
    button(page, "В библиотеку").click()
    page.reload()
    button(page, "Редактировать Как читать карту").click()
    expect(button(page, "Показать левую панель")).to_be_visible()
    expect(button(page, "Показать свойства")).to_be_visible()
    expect(note).not_to_be_visible()
    button(page, "Показать левую панель").click()
    button(page, "Показать свойства").click()
    button(page, "Заметки преподавателя").click()
    expect(note).to_have_value("Начните с вопроса о том, как карта показывает высоту.")
    expect(side).to_have_attribute("aria-valuenow", "346")
    button(page, "В библиотеку").click()

    button(page, "Шаблоны").click()
    button(page, "Создать шаблон").click()
    page.get_by_label("Название шаблона").fill("Чтение топографической карты")
    button(page, "Обычный").click()
    button(page, "Добавить строку").click()
    button(page, "Добавить столбец").click()
    expect(page.locator(".grid-cell")).to_have_count(4)
    button(page, "Объединить ячейки").click()
    button(page, "Ячейка 2, 2").click()
    expect(page.locator(".grid-cell")).to_have_count(1)
    button(page, "Разделить ячейку").click()
    expect(page.locator(".grid-cell")).to_have_count(4)
    button(page, "Отменить").click()
    expect(page.locator(".grid-cell")).to_have_count(1)
    button(page, "Повторить").click()
    expect(page.locator(".grid-cell")).to_have_count(4)
    viewport(page, 1024, 600)
    within_canvas(page)
    no_page_scroll(page)
    set_zoom(page, 100)
    divider = page.get_by_role("separator", name="Строка 1").first.bounding_box()
    center = (divider["x"] + divider["width"] - 75, divider["y"] + 3)
    drag(page, center, (center[0], center[1] + 20))
    assert float(page.get_by_label("Вес строки").input_value()) > 1
    button(page, "Вписать").click()
    viewport(page, 1440, 900)
    within_canvas(page)
    capture(page, "07-master-template")
    button(page, "Оформление и объекты").click()
    button(page, "Фигура").click()
    expect(page.get_by_label("Форма", exact=True)).to_be_visible()
    button(page, "К сетке шаблона").click()
    template = download(page)
    assert template["format"] == 3
    button(page, "Сохранить шаблон").click()
    card = page.locator(".template-card").filter(has_text="Чтение топографической карты")
    card.get_by_role("button", name="Создать презентацию").click()
    expect(page.locator(".workspace.editor")).to_be_visible()
    button(page, "В библиотеку").click()
    expect(card).to_be_visible()

    button(page, "Компоновки").click()
    button(page, "Создать шаблон").click()
    page.get_by_label("Название шаблона").fill("Практическая работа")
    button(page, "Добавить столбец").click()
    button(page, "Добавить строку").click()
    button(page, "Ячейка 2, 2").click()
    page.get_by_label("Тип ячейки").select_option("image")
    within_canvas(page)
    no_page_scroll(page)
    notice = button(page, "Закрыть уведомление")
    if notice.is_visible():
        notice.click()
    capture(page, "08-layout-template")
    button(page, "Сохранить шаблон").click()
    expect(page.locator(".template-card").filter(has_text="Практическая работа")).to_be_visible()

    seed(page, before, template)
    page.reload()
    expect(button(page, "Редактировать Методичка 10")).to_be_visible()
    card = page.locator(".card").filter(has=button(page, "Редактировать Методичка 10"))
    check_library_position(page, card, button(page, "Редактировать Методичка 10"),
                           "В библиотеку", crowded_workspace)
    button(page, "Шаблоны").click()
    card = page.locator(".template-cover").nth(26)
    check_library_position(page, card, card, "В библиотеку")
    button(page, "Мои методички").click()
    card = page.locator(".card-open").filter(has_text="Полевой практикум")
    card.click()
    for width, height in SIZES:
        viewport(page, width, height)
        within_canvas(page)
        no_page_scroll(page)
        for label in ["Открыть экран учеников", "Закрыть", "Следующий слайд", "Свернуть заметки"]:
            control_fits(page, button(page, label))
    viewport(page, 1440, 900)
    button(page, "Следующий слайд").click()
    capture(page, "09-teacher")
    button(page, "Предыдущий слайд").click()
    notes = page.locator(".atlas-note-scroll")
    assert notes.evaluate("(el) => el.scrollHeight > el.clientHeight")
    notes.evaluate("(el) => el.scrollTop = 200")
    button(page, "Увеличить текст заметок").click()
    expect(page.get_by_role("group", name="Размер текста заметок")).to_contain_text("110%")
    capture(page, "10-teacher-long-notes")
    button(page, "Следующий слайд").click()
    assert notes.evaluate("(el) => el.scrollTop") == 0
    button(page, "Свернуть заметки").click()
    within_canvas(page)
    button(page, "Показать заметки").click()
    expect(page.get_by_role("group", name="Размер текста заметок")).to_contain_text("110%")
    page.keyboard.press("End")
    strip = page.locator(".atlas-slide-strip")
    assert strip.evaluate("(el) => el.scrollLeft") > 0
    with page.expect_popup() as popup:
        button(page, "Открыть экран учеников").click()
    project = popup.value
    project.on("pageerror", lambda error: errors.append(str(error)))
    expect(project.locator(".atlas-stage")).to_be_visible()
    assert project.locator(".atlas-note, .zoom-bar, .atlas-slide-tools").count() == 0
    no_page_scroll(project)
    project.keyboard.press("ArrowLeft")
    expect(page.locator(".atlas-switch")).to_contain_text("34 / 35")
    capture(project, "12-projector")
    button(page, "Только слайды").click()
    expect(page.locator(".atlas-viewer-slides")).to_be_visible()
    no_page_scroll(page)
    capture(page, "11-slides-only")
    button(page, "Закрыть").click()
    assert not errors, errors
    return before, template


def mobile(browser, url, deck, template):
    sizes = [(360, 640), (390, 844), (430, 932), (844, 390)]
    for width, height in sizes:
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=True,
            has_touch=True, device_scale_factor=2,
            user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36")
        page = context.new_page()
        page.set_default_timeout(7000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.get_by_text("Редактирование доступно на компьютере.", exact=False)).to_be_visible()
        for label in ["Создать методичку", "Импорт JSON"]:
            expect(button(page, label)).to_have_count(0)
        page.evaluate("window.location.hash = '#edit/00000000-0000-4000-8000-000000000001'")
        expect(page.locator(".workspace")).to_have_count(0)
        if width == 390:
            capture(page, "14-mobile-editing-unavailable")
        button(page, "Открыть пример").click()
        within_canvas(page)
        no_page_scroll(page)
        button(page, "Следующий слайд").click()
        if width == 390:
            capture(page, "13-mobile-viewer")
        button(page, "Закрыть").click()
        if width == 390:
            seed(page, deck, template)
            page.reload()
            page.locator(".card-open").filter(has_text="Полевой практикум").click()
            expect(page.locator(".atlas-viewer")).to_be_visible()
            expect(page.locator(".workspace")).to_have_count(0)
            button(page, "Закрыть").click()
        if button(page, "Навигация").is_visible():
            button(page, "Навигация").click()
        button(page, "Шаблоны").click()
        expect(button(page, "Создать шаблон")).to_have_count(0)
        expect(button(page, "Импорт шаблона")).to_have_count(0)
        if width == 390:
            button(page, "Смотреть Шаблон 10").click()
            expect(page.locator(".atlas-viewer")).to_be_visible()
            button(page, "Закрыть").click()
        button(page, "Компоновки").click()
        expect(page.locator(".workspace")).to_have_count(0)
        assert not errors, errors
        context.close()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as play:
        (Path(temp) / "lessons").symlink_to(ROOT / "dist", target_is_directory=True)
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=temp))
        Thread(target=server.serve_forever, daemon=True).start()
        chromium = play.chromium.launch(
            executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"),
            args=["--no-sandbox"],
        )
        try:
            desktop = chromium.new_context(viewport={"width": 1440, "height": 900})
            url = f"http://127.0.0.1:{server.server_port}/lessons/"
            deck, template = exercise(desktop.new_page(), url)
            desktop.close()
            mobile(chromium, url, deck, template)
        finally:
            chromium.close()
            server.shutdown()
    print("PASS: shared editor, canvas, inspector, grid, libraries, teacher, projector and mobile gate")
