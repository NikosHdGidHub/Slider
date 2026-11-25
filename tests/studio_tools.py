"""Browser regression for backgrounds, layers, clipboard and history."""

import base64
import json
import os
import shutil
import tempfile
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from browser import ROOT, QuietHandler
from playwright.sync_api import expect, sync_playwright


def exercise(p, url, tmp):
    p.goto(url)
    p.set_default_timeout(5000)
    b = lambda name: p.get_by_role("button", name=name, exact=True)
    click = lambda name: b(name).click()
    p.on("dialog", lambda d: d.accept())

    def export():
        with p.expect_download() as ev:
            click("Экспортировать JSON")
        return json.loads(Path(ev.value.path()).read_text())

    click("Шаблоны")
    click("Создать шаблон")
    p.get_by_label("Название шаблона").fill("Контрольная рамка")
    click("Сохранить шаблон")
    click("Создать шаблон")
    p.get_by_label("Название шаблона").fill("Три фотографии")
    p.locator(".inspector summary").get_by_text("Фон", exact=True).click()
    files = [
        ROOT / "public/icons/atlas-192.png",
        ROOT / "public/icons/atlas-512.png",
        ROOT / "public/icons/atlas-512.png",
    ]
    import struct, zlib

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data))
        )

    large = tmp / "wide.png"
    large.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">2I5B", 2304, 270, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\x00" + b"\x64\x82\x91" * 2304) * 270))
        + chunk(b"IEND", b"")
    )
    files[1] = large
    for i, role in enumerate(["Титульный", "Обычный", "Завершающий"]):
        click(role)
        with p.expect_file_chooser() as ev:
            click("Фоновое изображение")
        ev.value.set_files(files[i])
        if i == 1:
            p.get_by_label("Обработка изображения").select_option("optimized")
        click("Загрузить фон")
        expect(p.locator(".grid-board img")).to_be_visible()
        if i == 1:
            assert p.locator(".grid-board img").evaluate("el=>el.naturalWidth") == 1920
        p.get_by_label("Яркость").fill(str(75 + i))
        p.get_by_label("Размытие").fill(str(i + 1))
    click("Добавить строку")
    p.keyboard.press("Control+z")
    expect(p.locator(".grid-cell")).to_have_count(1)
    p.keyboard.press("Control+Shift+z")
    expect(p.locator(".grid-cell")).to_have_count(2)
    cell = p.get_by_role("button", name="Ячейка 1, 1", exact=True)
    cell.click(button="right")
    p.get_by_role("menuitem", name="Копировать настройки").click()
    cell.click(button="right")
    p.get_by_role("menuitem", name="Вырезать настройки").click()
    expect(p.get_by_label("Тип ячейки")).to_have_value("empty")
    cell.click(button="right")
    p.get_by_role("menuitem", name="Вставить настройки").click()
    expect(p.get_by_label("Тип ячейки")).to_have_value("area")
    click("Сохранить шаблон")
    p.locator(".template-card").filter(has_text="Три фотографии").get_by_text(
        "Создать презентацию"
    ).click()
    d = export()
    assert len(set(s["background"] for s in d["slides"])) == 3
    assert (
        base64.b64decode(d["slides"][0]["background"].split(",")[1])
        == files[0].read_bytes()
    )
    assert [s["effects"]["blur"] for s in d["slides"]] == [1, 2, 3]
    p.locator(".thumb").nth(1).click()
    click("Слайд")
    p.get_by_label("Цвет фона").fill("#112233")
    click("Применить фон к схеме этой методички")
    assert all(
        s["color"] == "#112233" for s in export()["slides"] if s.get("kind") == "normal"
    )
    p.get_by_label("Цвет фона").fill("#123456")
    p.get_by_label("Сменить главный шаблон").select_option(label="Контрольная рамка")
    assert export()["slides"][2]["color"] == "#123456"
    click("Вернуть фон шаблона")
    assert export()["slides"][2]["color"] == "#ffffff"
    click("Добавить текст")
    row = p.locator(".layer-row").first
    expect(row).to_have_attribute("aria-pressed", "true")
    row.click(button="right")
    p.get_by_role("menuitem", name="Дублировать").click()
    expect(p.locator(".layer-row")).to_have_count(2)
    p.keyboard.press("Control+z")
    expect(p.locator(".layer-row")).to_have_count(1)
    p.keyboard.press("Control+Shift+z")
    expect(p.locator(".layer-row")).to_have_count(2)
    rows = p.locator(".layer-row")
    before = [o["id"] for o in export()["slides"][2]["items"]]
    rows.first.drag_to(rows.last)
    assert [o["id"] for o in export()["slides"][2]["items"]] == before[::-1]
    rows.first.click()
    p.keyboard.press("Control+x")
    expect(rows).to_have_count(1)
    p.locator(".thumb").nth(1).click()
    p.keyboard.press("Control+v")
    expect(rows).to_have_count(1)
    d = export()
    ids = [o["id"] for s in d["slides"] for o in s["items"]]
    assert len(set(ids)) == len(ids)
    rows.first.click(button="right")
    p.get_by_role("menuitem", name="Заблокировать").click()
    rows.first.click(button="right")
    expect(p.get_by_role("menuitem", name="Вырезать")).to_have_count(0)
    p.keyboard.press("Escape")
    click("В библиотеку")
    if p.get_by_role("button", name="Оставить локально и выйти").is_visible():
        click("Оставить локально и выйти")
    p.reload()
    p.get_by_role("button", name="Редактировать Три фотографии",exact=True).first.click()
    saved = export()
    assert saved["slides"][1]["items"][0]["locked"]
    click("В библиотеку")
    if p.get_by_role("button", name="Оставить локально и выйти").is_visible():
        click("Оставить локально и выйти")
    click("Мои методички")
    click("Импорт JSON")
    p.get_by_label("Или вставьте JSON").fill(json.dumps(saved, ensure_ascii=False))
    click("Импортировать")
    click("Открыть в редакторе")
    assert export()["slides"] == saved["slides"]


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
        root = Path(tmp)
        (root / "lessons").symlink_to(ROOT / "dist", target_is_directory=True)
        http = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(QuietHandler, directory=tmp)
        )
        Thread(target=http.serve_forever, daemon=True).start()
        browser = pw.chromium.launch(
            executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"),
            args=["--no-sandbox"],
        )
        page = browser.new_context(viewport={"width": 1536, "height": 960}).new_page()
        try:
            exercise(page, f"http://127.0.0.1:{http.server_port}/lessons/", root)
        finally:
            browser.close()
            http.shutdown()
        print("PASS: backgrounds, history, layer order, clipboard and persistence")
