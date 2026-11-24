"""Acceptance of the three reference outputs in the two downloaded AI guides."""
import json
from copy import deepcopy
from uuid import uuid4
import os
import shutil
import tempfile
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright
from browser import ROOT, QuietHandler


def exercise(page, url, tmp):
    page.goto(url)
    page.set_default_timeout(6500)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    confirm = [True]
    page.on("dialog", lambda d: d.accept() if confirm[0] else d.dismiss())
    button = lambda label: page.get_by_role("button", name=label, exact=True)
    canvas = page.locator(".canvas .atlas-stage")
    captures = os.environ.get("ATLAS_GRID_CAPTURES")

    def click(label):
        button(label).click()

    def capture(label, stage=canvas):
        page.evaluate("document.fonts.ready")
        expect(stage.locator("[data-overflow]")).to_have_count(0)
        if captures:
            path = Path(captures)
            path.mkdir(parents=True, exist_ok=True)
            stage.screenshot(path=path / (label + ".png"))

    def guide(label):
        with page.expect_download() as event:
            click("Скачать инструкцию для генерации " + label)
        return Path(event.value.path()).read_text()

    def export():
        click("Действия с методичкой")
        with page.expect_download() as event:
            click("Экспортировать JSON")
        return json.loads(Path(event.value.path()).read_text())

    def import_lesson(deck):
        click("Импорт JSON")
        page.get_by_label("Или вставьте JSON").fill(json.dumps(deck, ensure_ascii=False))
        click("Импортировать")
        click("Открыть в редакторе")

    def open_lesson():
        button("Мои методички").click()
        page.get_by_role("button", name="Урок приёмки", exact=False).first.click()
        page.locator(".thumb").nth(1).click()

    lesson_text = guide("презентации")
    water = next(json.loads(line) for line in lesson_text.splitlines() if line.startswith('{"version"'))
    assert water == json.loads((ROOT / "docs/examples/water-cycle.json").read_text())
    click("Шаблоны")
    text = guide("шаблона")
    samples = [json.loads(line) for line in text.splitlines() if line.startswith('{"format"')]
    assert len(samples) == 2
    for i, (doc, file) in enumerate(zip(samples, ["main-frame", "structure-2x2"])):
        assert doc == json.loads((ROOT / ("docs/grid/" + file + ".json")).read_text())
        with page.expect_file_chooser() as event:
            click("Импорт шаблона")
        event.value.set_files({"name": file + ".json", "mimeType": "application/json",
                               "buffer": json.dumps(doc, ensure_ascii=False).encode()})
        expect(page.locator(".import-preview .atlas-stage")).to_have_count(1 if i else 3)
        click("Импортировать шаблон")
        card = page.locator(".template-card").filter(has_text=doc["deck"]["title"]).last
        card.get_by_role("button", name="Редактировать", exact=True).click()
        name = "Сетка приёмки" if i else "Рамка приёмки"
        page.get_by_label("Название шаблона").fill(name)
        if i:
            expect(page.locator(".grid-cell")).to_have_count(3)
            click("Ячейка 1, 1")
            padding = page.locator("details").filter(has=page.locator("summary", has_text="Отступы ячейки")).first
            padding.locator("summary").click()
            padding.get_by_label("Все стороны").fill("26")
            padding.get_by_label("Справа").fill("12")
            expect(padding.get_by_label("Слева")).to_have_value("26")
            boundary = page.get_by_role("separator", name="Строка 1").first
            box = boundary.bounding_box()
            px, py = box["x"] + box["width"]/2, box["y"] + box["height"]/2
            page.mouse.move(px, py)
            page.mouse.down()
            page.mouse.move(px, py-20)
            page.mouse.up()
            assert float(page.get_by_label("Вес строки").input_value()) < 2
            click("Ячейка 2, 1")
            click("Разделить ячейку")
            expect(page.locator(".grid-cell")).to_have_count(4)
            click("Объединить ячейки")
            click("Ячейка 2, 2")
            expect(page.locator(".grid-cell")).to_have_count(3)
        click("Сохранить шаблон")
        card = page.locator(".template-card").filter(has_text=name)
        card.get_by_role("button", name="Редактировать", exact=True).click()
        expect(page.get_by_label("Название шаблона")).to_have_value(name)
        click("В библиотеку")

    click("Презентации")
    page.locator(".template-card").filter(has_text="Рамка приёмки").get_by_text("Создать презентацию").click()
    page.get_by_label("Название методички").fill("Урок приёмки")
    expect(canvas.get_by_text("Алексей Дмитриевич")).to_be_visible()
    assert "rgb(118, 69, 170)" in canvas.locator('[data-slot="m/body"]').evaluate("el=>getComputedStyle(el).boxShadow")
    capture("title")
    page.locator(".thumb").last.click()
    expect(canvas.get_by_text("Спасибо")).to_be_visible()
    capture("end")
    page.locator(".thumb").nth(1).click()
    capture("normal")
    click("Добавить текст")
    page.get_by_role("textbox", name="Текст", exact=True).fill("Сохранённый объект")
    mode = page.get_by_label("Режим области слайда")
    confirm[0] = False
    mode.select_option(label="Сетка приёмки")
    expect(mode).to_have_value("free")
    expect(canvas.get_by_text("Сохранённый объект")).to_be_visible()
    confirm[0] = True
    mode.select_option(label="Сетка приёмки")
    expect(canvas.locator(".atlas-item")).to_have_count(0)
    click("Сохранённый объект")
    page.get_by_label("Размещение объекта").select_option("s/description")
    page.get_by_role("textbox", name="Текст", exact=True).fill("Вода из реки испаряется.")
    with page.expect_file_chooser() as event:
        canvas.locator('[data-slot="s/image"]').click()
    event.value.set_files(ROOT / "public/icons/atlas-192.png")
    expect(canvas.locator("img")).to_be_visible()
    page.get_by_label("Заполнение ячейки").select_option("cover")
    canvas.locator('[data-slot="s/conclusion"]').click()
    page.get_by_role("textbox", name="Текст", exact=True).fill("Вода возвращается дождём.")
    click("Свойства слайда")
    capture("filled-structure")
    original = export()
    click("В библиотеку")
    open_lesson()
    assert export() == original
    def boxes():
        return canvas.locator(".atlas-item").evaluate_all("els=>els.map(el=>{const {x,y,width,height}=el.getBoundingClientRect();return [x,y,width,height]})")
    before = boxes()
    mode.select_option("free")
    after = boxes()
    assert len(before) == len(after) == 3
    assert all(abs(a-b) < .1 for u,v in zip(before,after) for a,b in zip(u,v))
    mode.select_option(label="Сетка приёмки")
    stored = export()
    assert all(o["slot"] == "tray" for o in stored["slides"][1]["items"])
    click("В библиотеку")
    open_lesson()
    assert export() == stored
    click("Сохранить как шаблон")
    expect(page.get_by_label("Название шаблона")).to_have_value("Урок приёмки — шаблон")
    click("В библиотеку")
    expect(page.locator(".template-card").filter(has_text="Урок приёмки — шаблон")).to_have_count(1)

    click("Мои методички")
    import_lesson(water)
    click("Показать")
    for i in range(len(water["slides"])):
        stage = page.locator(".atlas-stage").filter(visible=True).first
        expect(stage.locator(".atlas-item")).to_have_count(len(water["slides"][i]["items"]))
        capture("water-" + str(i + 1), stage)
        if i + 1 < len(water["slides"]):
            click("Следующий слайд")
    click("Закрыть")
    page.get_by_label("Сменить главный шаблон").select_option(label="Рамка приёмки")
    changed = export()
    assert [len(s["items"]) for s in changed["slides"]] == [len(s["items"]) for s in water["slides"]]
    assert all(s["items"][0]["slot"]=="tray" for s in [changed["slides"][0],changed["slides"][-1]])
    click("В библиотеку")
    import_lesson(changed)
    assert export()["slides"] == changed["slides"]
    # Import an actual v2 release fixture. The content must match the original five slides.
    click("В библиотеку")
    legacy = json.loads((ROOT / "tests/water-v2.json").read_text())
    import_lesson(legacy)
    migrated = export()
    assert migrated["migrated"] and migrated["master"]["name"] == "По умолчанию"
    assert migrated["slides"] == legacy["slides"]
    for i in range(len(legacy["slides"])):
        page.locator(".thumb").nth(i).click()
        expect(canvas.locator(".atlas-item")).to_have_count(len(legacy["slides"][i]["items"]))
        capture("migration-" + str(i + 1))
    page.get_by_label("Сменить главный шаблон").select_option(label="Рамка приёмки")
    assert all(o["slot"]=="tray" for s in export()["slides"] for o in s["items"])
    click("В библиотеку")
    page.locator(".card-open").filter(has_text="до смены шаблона").click()
    assert export()["slides"] == legacy["slides"]
    click("В библиотеку")

    # Header inheritance, local overrides and drag a two-object group inside a reduced area.
    lesson = deepcopy(water)
    lesson["title"] = "Колонтитулы и группы"
    simple = deepcopy(lesson["master"]["schemes"]["normal"]["cells"][0])
    grid = dict(rows=[1, 7], cols=[1], padding=[0]*4, cells=[
        dict(simple, id="heading", type="header", value="Общий текст"), dict(simple, row=1)])
    lesson["master"]["schemes"]["normal"] = grid
    lesson["master"]["schemes"]["end"] = deepcopy(grid)
    slide = lesson["slides"][1]
    slide["items"] = [dict(slide["items"][-1], id=str(uuid4()), x=70+350*i, y=100,
                           w=220, h=130, rotation=0) for i in range(2)]
    import_lesson(lesson)
    page.locator(".thumb").nth(1).click()
    page.locator("summary").filter(has_text="Верхний колонтитул").click()
    page.get_by_label("Для всей методички").fill("Все слайды")
    page.get_by_label("Для этого слайда").fill("Только этот слайд")
    page.get_by_label("Для всей методички").fill("Новое общее значение")
    expect(canvas.get_by_text("Только этот слайд")).to_be_visible()
    page.locator(".thumb").nth(2).click()
    expect(canvas.get_by_text("Новое общее значение")).to_be_visible()
    page.locator(".thumb").nth(1).click()
    groups = page.locator("details").filter(has=page.locator("summary", has_text="Группы и связи")).first
    groups.locator("summary").click()
    for checkbox in groups.get_by_role("checkbox").all():
        checkbox.check()
    click("Сгруппировать")
    previous = export()["slides"][1]["items"]
    r = canvas.locator(".atlas-item").first.bounding_box()
    page.mouse.move(r["x"]+r["width"]/2, r["y"]+r["height"]/2)
    page.mouse.down()
    page.mouse.move(r["x"]+r["width"]/2+33, r["y"]+r["height"]/2+20)
    page.mouse.up()
    moved = export()["slides"][1]["items"]
    assert moved[0]["group"] == moved[1]["group"]
    delta = [(b["x"]-a["x"],b["y"]-a["y"]) for a,b in zip(previous,moved)]
    assert delta[0] == delta[1] and delta[0][0] > 0 and delta[0][1] > 0

    # Trigger a real IndexedDB revision conflict, keep the unsaved editor and abort save-as.
    other = page.context.new_page()
    other.goto(url)
    other.locator(".card-open").filter(has_text=lesson["title"]).click()
    other.get_by_label("Название методички").fill("Изменено в другой вкладке")
    expect(other.locator(".edit-head small")).to_contain_text("Сохранено")
    page.get_by_label("Название методички").fill("Локальный конфликт")
    expect(page.locator(".edit-head small")).to_contain_text("Ошибка записи")
    click("Сохранить как шаблон")
    expect(page.get_by_label("Название методички")).to_have_value("Локальный конфликт")
    expect(page.locator(".grid-designer")).to_have_count(0)
    assert export()["title"] == "Локальный конфликт"
    other.close()
    assert not errors, errors


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
        root = Path(tmp)
        (root/"lessons").symlink_to(ROOT/"dist", target_is_directory=True)
        http = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=tmp))
        Thread(target=http.serve_forever, daemon=True).start()
        browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"), args=["--no-sandbox"])
        page = browser.new_context(viewport={"width":1536, "height":960}).new_page()
        try:
            exercise(page, f"http://127.0.0.1:{http.server_port}/lessons/", root)
        finally:
            browser.close()
            http.shutdown()
        print("PASS: two downloaded guides, three visual scenarios, tray, geometry, persistence and template creation")
