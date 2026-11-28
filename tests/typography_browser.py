"""Browser checks for the v4 template and text editing workflows."""

import json
import os
import shutil
import tempfile
from functools import partial
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer

from playwright.sync_api import expect, sync_playwright
from library_browser import (
    ROOT,
    Quiet,
    SIZES,
    button,
    capture,
    choose,
    db_seed,
    download,
    fixture,
    no_overflow,
    row,
    viewport,
)


def stage(page):
    return page.locator(".canvas-viewport .atlas-stage").last


def edit_canvas(page, target):
    target.click()
    field = page.locator(".canvas .ProseMirror")
    expect(field).to_be_focused()
    return field


def select_prefix(field, length):
    field.press("Control+Home")
    for _ in range(length):
        field.press("Shift+ArrowRight")


def verify_template(page, title):
    choose(page, title, "Редактировать")
    expect(
        stage(page).get_by_text("VERTEX / 3D-МОДЕЛИРОВАНИЕ", exact=True)
    ).to_be_visible()
    expect(
        stage(page).get_by_text("3D STUDIO / УЧЕБНЫЙ ПРАКТИКУМ", exact=True)
    ).to_be_visible()
    for width, height in SIZES:
        viewport(page, width, height)
        no_overflow(page)
        assert page.evaluate("document.documentElement.scrollHeight <= innerHeight")
        if (width, height) in [(1024, 600), (1440, 900)]:
            capture(page, "typography-structure-" + str(width))
    viewport(page, 1440, 900)
    button(page, "Ячейка 5, 1").click()
    source = page.get_by_role("textbox", name="Исходный текст")
    source.fill("ЁЖ / ДЕТАЛИ")
    expect(stage(page).get_by_text("ЁЖ / ДЕТАЛИ")).to_be_visible()
    button(page, "Применить ко всем ячейкам этого типа").click()
    button(page, "Обычный").click()
    expect(stage(page).get_by_text("ЁЖ / ДЕТАЛИ")).to_be_visible()
    button(page, "Завершающий").click()
    expect(stage(page).get_by_text("ЁЖ / ДЕТАЛИ")).to_be_visible()
    button(page, "Титульный").click()
    button(page, "Ячейка 5, 1").click()
    button(page, "Сбросить исходный текст").click()
    expect(source).to_have_value("Нижний колонтитул")
    source.fill("")
    expect(source).to_have_value("")
    source.fill("3D STUDIO / УЧЕБНЫЙ ПРАКТИКУМ")
    button(page, "Текстовые стили").click()
    manager = page.get_by_role("dialog", name="Текстовые стили")
    expect(manager).to_be_visible()
    styles = manager.locator(".global-style-fields")
    manager.get_by_label("Стиль текста", exact=True).select_option("title")
    size = styles.get_by_label("Размер шрифта", exact=True)
    size.fill("59")
    button(manager, "Отмена").click()
    expect(manager).to_have_count(0)
    button(page, "Текстовые стили").click()
    manager.get_by_label("Стиль текста", exact=True).select_option("title")
    assert size.input_value() != "59"
    size.fill("58")
    button(manager, "Справа").click()
    button(manager, "Снизу").click()
    manager.get_by_label("Фон предпросмотра").select_option("compare")
    expect(manager.locator(".style-preview .atlas-stage")).to_have_count(2)
    manager.get_by_label("Фон предпросмотра").select_option("white")
    button(manager, "Применить").click()
    heading = stage(page).get_by_text("VERTEX / 3D-МОДЕЛИРОВАНИЕ", exact=True)
    expect(
        heading.locator('xpath=ancestor::div[contains(@class,"atlas-slide-text")]')
    ).to_have_css("text-align", "right")
    manager.get_by_label("Поиск гарнитуры").fill("Unbounded")
    manager.get_by_label("Гарнитура", exact=True).select_option("unbounded")
    expect(styles.get_by_label("Курсив")).to_have_count(0)
    with page.expect_file_chooser() as upload:
        manager.get_by_label("Гарнитура", exact=True).select_option("@upload")
    upload.value.set_files(ROOT / "src" / "assets" / "fonts" / "Sans.woff")
    expect(
        manager.get_by_text("Шрифт доступен в списке гарнитур.", exact=True)
    ).to_be_visible()
    manager.get_by_label("Поиск гарнитуры").fill("Sans.woff")
    expect(manager.get_by_role("option", name="Sans.woff", exact=True)).to_have_count(1)
    manager.get_by_label("Поиск гарнитуры").fill("")
    manager.get_by_text("Эффекты текста", exact=True).click()
    styles.get_by_label("Тень текста", exact=True).check()
    styles.get_by_label("Обводка текста", exact=True).check()
    styles.get_by_label("Свечение текста", exact=True).check()
    button(manager, "Применить").click()
    assert heading.evaluate("el => getComputedStyle(el).textShadow !== 'none'")
    capture(page, "typography-style-manager")
    button(manager, "Создать стиль").click()
    first = manager.get_by_label("Стиль текста", exact=True).input_value()
    assert first.startswith("s")
    button(manager, "Готово").click()
    expect(manager).to_have_count(0)
    button(page, "Ячейка 4, 1").click()
    cell_style = page.get_by_label("Пользовательский стиль", exact=True)
    cell_style.select_option(first)
    button(page, "Текстовые стили").click()
    selected_style = manager.get_by_label("Стиль текста", exact=True)
    selected_style.select_option(first)
    button(manager, "Дублировать стиль").click()
    second = selected_style.input_value()
    assert second != first
    name = manager.get_by_label("Название стиля", exact=True)
    name.fill("Текст чертежа")
    name.press("Tab")
    selected_style.select_option(first)
    manager.get_by_label("Заменить ссылки при удалении").select_option(second)
    button(manager, "Удалить стиль").click()
    button(manager, "Готово").click()
    expect(cell_style).to_have_value(second)
    button(page, "Сохранить шаблон").click()
    expect(button(page, "Действия: " + title)).to_be_visible()
    _, legacy = download(
        page, lambda: choose(page, title, "Скачать исходный JSON до миграции")
    )
    assert json.loads(legacy)["deck"]["footer"] == "3D STUDIO / УЧЕБНЫЙ ПРАКТИКУМ"
    _, exported = download(page, lambda: choose(page, title, "Экспортировать JSON"))
    template = json.loads(exported)
    assert template["format"] == 4
    assert (
        template["deck"]["theme"]["systemStyles"]["title"]["verticalAlign"] == "bottom"
    )
    choose(page, title, "Редактировать")
    button(page, "Оформление и объекты").click()
    button(page, "Слой X / Y / Z").click()
    expect(page.get_by_text("Слой заблокирован", exact=True)).to_be_visible()
    page.get_by_text("Действия с объектом", exact=True).click()
    button(page, "Разблокировать").click()
    field = edit_canvas(page, stage(page).get_by_text("X / Y / Z", exact=True))
    field.press("End")
    field.press_sequentially(" · ОСИ")
    field.press("Escape")
    expect(stage(page).get_by_text("X / Y / Z · ОСИ")).to_be_visible()
    button(page, "Слой Куб · контур").click()
    expect(stage(page).locator("path").first).to_be_visible()
    capture(page, "typography-decoration")
    expect(stage(page)).to_have_class("atlas-stage atlas-editable atlas-bleed")
    # A new free decoration may be dragged past the edge and keeps the cell inspector.
    button(page, "Фигура").click()
    expect(page.get_by_role("region", name="Область редактирования")).to_be_visible()
    expect(
        page.locator('.inspector [data-section="object-editor-cell"]')
    ).to_be_visible()
    expect(page.get_by_label("Пользовательский стиль", exact=True)).to_have_count(0)
    selected = stage(page).locator(".atlas-selected").last
    rect = selected.bounding_box()
    frame = stage(page).bounding_box()
    assert rect and frame
    page.mouse.move(rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2)
    page.mouse.down()
    page.mouse.move(
        frame["x"] + rect["width"] / 2 - 15, rect["y"] + rect["height"] / 2, steps=10
    )
    page.mouse.up()
    moved = selected.bounding_box()
    assert moved and moved["x"] < frame["x"] - 2, (moved, frame)
    capture(page, "typography-decoration-bleed")
    button(page, "Отменить").click()
    button(page, "Отменить").click()

    button(page, "Сохранить шаблон").click()
    expect(button(page, "Действия: " + title)).to_be_visible()


def verify_lesson(page, title):
    choose(page, title, "Создать методичку")
    heading = stage(page).get_by_text("VERTEX / 3D-МОДЕЛИРОВАНИЕ", exact=True)
    toolbar = page.get_by_role("group", name="Форматирование текста", exact=True)
    button(page, "Свернуть свойства").click()
    strict = edit_canvas(page, heading)
    expect(toolbar.get_by_text("Заголовок")).to_be_visible()
    expect(
        toolbar.get_by_role("button", name="Дополнительное форматирование")
    ).to_have_count(0)
    strict.press("Tab")
    expect(toolbar.get_by_label("Гарнитура")).to_be_focused()
    size = toolbar.get_by_label("Размер шрифта")
    size.fill("54")
    expect(size).to_be_focused()
    size.press("Enter")
    expect(strict).to_be_focused()
    assert strict.evaluate("element => getComputedStyle(element).fontSize") == "54px"
    strict.press("ControlOrMeta+a")
    strict.evaluate(
        'element => { const data = new DataTransfer(); data.setData("text/plain", "ЁЖ"); data.setData("text/html", "<b>Другое</b>"); element.dispatchEvent(new ClipboardEvent("paste", {bubbles:true, clipboardData:data})); }'
    )
    expect(strict).to_have_text("ЁЖ")
    expect(strict.locator("b")).to_have_count(0)
    strict.press("ControlOrMeta+a")
    strict.press("Backspace")
    strict.press("Escape")
    expect(toolbar).to_have_count(0)
    expect(heading).to_have_count(0)
    button(page, "Показать свойства").click()
    button(page, "Вернуть исходный текст ячейки").click()
    expect(heading).to_be_visible()
    untouched = edit_canvas(page, heading)
    untouched.press("Escape")
    _, untouched_raw = download(
        page, lambda: button(page, "Экспортировать JSON").click()
    )
    assert not any(
        o.get("slot") == "m/heading"
        for o in json.loads(untouched_raw)["slides"][0]["items"]
    )

    detail = stage(page).get_by_text("Проверьте в пространстве", exact=True)
    rich = edit_canvas(page, detail)
    rich.press("ControlOrMeta+a")
    rich.press_sequentially("Alpha beta")
    select_prefix(rich, 5)
    toolbar.get_by_label("Гарнитура", exact=True).select_option("manrope")
    expect(rich).to_be_focused()
    expect(rich.locator("span").filter(has_text="Alpha")).to_have_css(
        "font-family", "Atlas-manrope, Atlas-sans, Arial, sans-serif"
    )
    rich.press("Control+z")
    toolbar.get_by_label("Цвет текста", exact=True).fill("#f95588")
    expect(rich.locator("span").filter(has_text="Alpha")).to_have_css(
        "color", "rgb(249, 85, 136)"
    )
    rich.press("Control+z")
    expect(rich.locator("span").filter(has_text="Alpha")).to_have_count(0)
    rich.press("Control+Shift+z")
    expect(rich.locator("span").filter(has_text="Alpha")).to_have_css(
        "color", "rgb(249, 85, 136)"
    )
    select_prefix(rich, 5)
    button(toolbar, "Дополнительное форматирование").click()
    button(toolbar, "Нумерованный список").click()
    button(toolbar, "Увеличить отступ").click()
    expect(rich.locator('p[data-list="number"]').first).to_have_css(
        "padding-inline-start", "24px"
    )
    capture(page, "typography-rich-selection")
    viewport(page, 1024, 600)
    bar = toolbar.bounding_box()
    assert (
        bar["x"] >= 0
        and bar["y"] >= 0
        and bar["x"] + bar["width"] <= 1024
        and bar["y"] + bar["height"] <= 600
    )
    capture(page, "typography-inline-compact")
    viewport(page, 1440, 900)
    page.get_by_role("textbox", name="Заметки преподавателя").click()
    expect(toolbar).to_have_count(0)
    button(page, "Текстовые стили").click()
    manager = page.get_by_role("dialog", name="Текстовые стили")
    manager.get_by_label("Стиль текста", exact=True).select_option("text")
    manager.get_by_label("Размер шрифта", exact=True).fill("40")
    button(manager, "Готово").click()
    content = stage(page).get_by_text("Alpha", exact=True)
    expect(content).to_have_css("font-size", "40px")
    expect(content).to_have_css("color", "rgb(249, 85, 136)")
    _, raw = download(page, lambda: button(page, "Экспортировать JSON").click())
    deck = json.loads(raw)
    runs = next(
        item["paragraphs"][0]["runs"]
        for item in deck["slides"][0]["items"]
        if item.get("slot") == "m/detail"
    )
    assert runs[0] == {"text": "Alpha", "color": "#f95588"}, runs
    assert runs[1] == {"text": " beta"}, runs

    button(page, "Подготовить к офлайн-показу").click()
    expect(
        page.get_by_text("Готово к офлайн-показу.", exact=False).first
    ).to_be_visible(timeout=20000)
    font_keys = page.evaluate("""async () => {
        const keys = await caches.keys();
        return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(r => r.url)))).flat()
    }""")
    assert any("/fonts/unbounded/" in url for url in font_keys)
    assert not any("/fonts/lora/" in url for url in font_keys)
    button(page, "Показать").click()
    for width, height in SIZES:
        viewport(page, width, height)
        no_overflow(page)
        expect(
            page.locator(".atlas-preview-panel").get_by_text(
                "VERTEX / 3D-МОДЕЛИРОВАНИЕ", exact=True
            )
        ).to_be_visible()
    viewport(page, 1440, 900)
    capture(page, "typography-viewer")
    with page.expect_popup() as window:
        button(page, "Открыть экран учеников").click()
    projector = window.value
    expect(
        projector.get_by_text("VERTEX / 3D-МОДЕЛИРОВАНИЕ", exact=True)
    ).to_be_visible()
    projector.close()
    button(page, "Закрыть").click()
    button(page, "В библиотеку").click()
    page.context.set_offline(True)
    page.reload()
    choose(page, title, "Просмотр")
    expect(
        page.locator(".atlas-preview-panel").get_by_text(
            "VERTEX / 3D-МОДЕЛИРОВАНИЕ", exact=True
        )
    ).to_be_visible()
    page.wait_for_function(
        "Array.from(document.fonts).some(font => font.family === 'Atlas-unbounded' && font.status === 'loaded')"
    )
    capture(page, "typography-offline")


def main():
    with tempfile.TemporaryDirectory() as folder, sync_playwright() as playwright:
        root = Path(folder)
        (root / "atlas").symlink_to(ROOT / "dist", target_is_directory=True)
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=folder))
        Thread(target=server.serve_forever, daemon=True).start()
        chromium = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
        browser = playwright.chromium.launch(
            executable_path=chromium, args=["--no-sandbox"]
        )
        try:
            page = browser.new_page(
                viewport={"width": 1440, "height": 900}, accept_downloads=True
            )
            page.set_default_timeout(6500)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            style_names = iter(["Первый стиль", "Копия первого стиля"])
            page.on(
                "dialog",
                lambda dialog: (
                    dialog.accept(next(style_names))
                    if dialog.type == "prompt"
                    else dialog.accept()
                ),
            )
            page.goto(f"http://127.0.0.1:{server.server_port}/atlas/")
            expect(page.get_by_text("Здесь будут ваши методички")).to_be_visible()
            source = fixture("typography-vertex-v3")
            title = source["deck"]["title"]
            db_seed(page, [], [row(source)])
            page.reload()
            button(page, "Шаблоны").click()
            verify_template(page, title)
            verify_lesson(page, title)
            assert not errors, errors
        finally:
            browser.close()
            server.shutdown()
    print(
        "PASS: v4 template source, typography, rich selection, migration backup, decoration, projector and local fonts offline"
    )


if __name__ == "__main__":
    main()
