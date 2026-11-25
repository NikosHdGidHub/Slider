"""Usage: python tests/fonts_browser.py sample.woff2 sample.woff sample.ttf sample.otf
Exercises all uploads, resizing, fallback, inherited styles, legacy IndexedDB and offline reload.
"""

import json
import os
import shutil
import sys
import tempfile
import uuid
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from browser import ROOT, QuietHandler
from playwright.sync_api import expect, sync_playwright


def run(page, ctx, url, files):
    uid = lambda: str(uuid.uuid4())
    i = {
        "id": uid(),
        "type": "text",
        "text": "Старая заметка",
        "src": "",
        "x": 80,
        "y": 80,
        "w": 500,
        "h": 140,
        "size": 48,
        "align": "left",
        "color": "#162e30",
    }
    deck = {
        "version": 1,
        "id": uid(),
        "title": "Черновик v1",
        "slides": [
            {
                "id": uid(),
                "color": "#ffffff",
                "background": None,
                "notes": "Сохранено до обновления",
                "items": [i],
            }
        ],
    }
    page.goto(url + "manifest.webmanifest")
    page.evaluate(
        """deck=>new Promise((res,rej)=>{const q=indexedDB.open('atlas-lessons-v1',1);q.onupgradeneeded=()=>{q.result.createObjectStore('lessons',{keyPath:'deck.id'});q.result.createObjectStore('images')};q.onsuccess=()=>{const db=q.result,tx=db.transaction('lessons','readwrite');tx.objectStore('lessons').put({deck,updated:10,revision:7});tx.oncomplete=()=>{db.close();res()};tx.onerror=()=>rej(tx.error)}})""",
        deck,
    )
    page.goto(url)
    page.set_default_timeout(8000)
    click = lambda n: page.get_by_role("button", name=n, exact=True).click()
    page.get_by_role("button", name="Черновик v1", exact=False).first.click()
    canvas = page.locator(".canvas")
    expect(canvas.get_by_text("Старая заметка")).to_be_visible()
    panel = page.locator(".inspector")
    styles = (
        panel.locator("details")
        .filter(has=page.locator("summary", has_text="Шрифты и общие стили"))
        .last
    )
    styles.locator("summary", has_text="Шрифты и общие стили").click()
    for f in files:
        styles.locator("input[type=file]").set_input_files(f)
        expect(
            styles.get_by_label("Гарнитура", exact=True)
            .locator("option")
            .filter(has_text=f.name)
        ).to_have_count(1)
    styles.get_by_label("Гарнитура", exact=True).select_option(label=files[1].name)
    styles.locator("summary", has_text="Шрифты и общие стили").click()
    click("Добавить текст")
    panel.get_by_label("Стиль текста", exact=True).select_option("title")
    panel.get_by_label("Текст", exact=True).fill("Текст для подгонки " * 15)
    panel.get_by_label("Цвет текста", exact=True).filter(visible=True).fill("#753b34")
    panel.locator("summary", has_text="Геометрия и слой").click()
    panel.get_by_label("Высота", exact=True).fill("48")
    panel.get_by_label("Ширина", exact=True).fill("220")
    block = canvas.locator(".atlas-item.atlas-selected .atlas-slide-text")
    expect(block).to_have_attribute("data-overflow", "true")
    sample = block.locator(":scope > div")
    assert float(sample.evaluate("e=>parseFloat(e.style.fontSize)")) == 18
    panel.get_by_label("Текст", exact=True).fill("Лес")
    panel.get_by_label("Высота", exact=True).fill("120")
    expect(block).not_to_have_attribute("data-overflow", "true")
    assert float(sample.evaluate("e=>parseFloat(e.style.fontSize)")) == 64
    assert (
        page.evaluate(
            "Array.from(document.fonts).filter(f=>f.family.startsWith('AtlasUser') && f.status==='loaded').length"
        )
        >= 4
    )
    assert "AtlasUser" in sample.evaluate("e=>getComputedStyle(e).fontFamily")
    styles.locator("summary", has_text="Шрифты и общие стили").click()
    styles.get_by_label("Гарнитура", exact=True).select_option("mono")
    assert "Atlas Mono" in sample.evaluate("e=>getComputedStyle(e).fontFamily")
    assert (
        block.locator("span").first.evaluate("e=>getComputedStyle(e).color")
        == "rgb(117, 59, 52)"
    )
    styles.get_by_label("Гарнитура", exact=True).select_option(label=files[1].name)
    click("Действия с методичкой")
    click("Подготовить к офлайн-показу")
    expect(page.locator(".toast")).to_contain_text("Готово к офлайн")
    ctx.set_offline(True)
    page.reload()
    page.get_by_role("button", name="Черновик v1", exact=False).first.click()
    page.evaluate("document.fonts.ready")
    assert (
        page.evaluate(
            "Array.from(document.fonts).filter(f=>f.family.startsWith('AtlasUser') && f.status==='loaded').length"
        )
        >= 4
    )
    click("Действия с методичкой")
    with page.expect_download() as d:
        click("Экспортировать JSON")
    actual = json.loads(Path(d.value.path()).read_text())
    assert actual["version"] == 3 and len(actual["resources"]["fonts"]) == 4
    assert actual["slides"][0]["items"][0]["overrides"] == {
        "font": "legacy",
        "fit": False,
    }
    click("В библиотеку")
    click("Импорт JSON")
    actual["resources"]["fonts"] = []
    actual["theme"]["styles"][0]["values"]["font"] = "unavailable"
    page.get_by_label("Или вставьте JSON").fill(json.dumps(actual, ensure_ascii=False))
    click("Импортировать")
    expect(
        page.get_by_text("использует отсутствующий шрифт", exact=False)
    ).to_be_visible()
    click("Открыть в редакторе")
    assert "Atlas Sans" in canvas.locator(".atlas-slide-text > div").last.evaluate(
        "e=>getComputedStyle(e).fontFamily"
    )


if __name__ == "__main__":
    files = [Path(f) for f in sys.argv[1:]]
    assert [f.suffix for f in files] == [".woff2", ".woff", ".ttf", ".otf"]
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        (Path(tmp) / "lessons").symlink_to(ROOT / "dist", target_is_directory=True)
        h = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=tmp))
        Thread(target=h.serve_forever, daemon=True).start()
        b = p.chromium.launch(
            executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"),
            args=["--no-sandbox"],
        )
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        run(ctx.new_page(), ctx, f"http://127.0.0.1:{h.server_port}/lessons/", files)
        b.close()
        h.shutdown()
        print(
            "PASS: v1 database upgrade, four font formats, inheritance, measured autofit, missing font and offline fonts"
        )
