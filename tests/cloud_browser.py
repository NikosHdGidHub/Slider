"""Client integration with a local HTTP fixture implementing the Supabase routes used by the app.
Build with VITE_SUPABASE_URL=https://atlas-test.supabase.co, VITE_SUPABASE_ANON_KEY=sb_publishable_fixture
and VITE_ADMIN_UUID=00000000-0000-4000-8000-000000000001. Pass the output directory as argv[1].
"""

import base64
import json
import os
import shutil
import sys
import tempfile
import time
from email.parser import BytesParser
from email.policy import default
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlparse

from browser import ROOT, QuietHandler
from playwright.sync_api import expect, sync_playwright

OWNER = "00000000-0000-4000-8000-000000000001"


def flow(browser, url, tmp):
    files, templates, requests = {}, {}, []

    def endpoint(route):
        r = route.request
        u = urlparse(r.url)
        q = parse_qs(u.query)
        path = u.path
        method = r.method
        requests.append((method, path))

        def send(data, status=200, mime="application/json"):
            route.fulfill(
                status=status,
                content_type=mime,
                body=json.dumps(data) if mime == "application/json" else data,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS,HEAD",
                },
            )

        if method == "OPTIONS":
            return send({})
        if path == "/auth/v1/token":
            user = {
                "id": OWNER,
                "aud": "authenticated",
                "role": "authenticated",
                "email": "owner@example.org",
                "app_metadata": {},
                "user_metadata": {},
                "created_at": "2025-01-01T00:00:00Z",
            }
            payload = (
                base64.urlsafe_b64encode(
                    json.dumps(
                        {
                            "sub": OWNER,
                            "role": "authenticated",
                            "exp": int(time.time()) + 3600,
                        }
                    ).encode()
                )
                .decode()
                .rstrip("=")
            )
            token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + payload + ".Zml4dHVyZQ"
            return send(
                {
                    "user": user,
                    "access_token": token,
                    "token_type": "bearer",
                    "refresh_token": "local-fixture",
                    "expires_in": 3600,
                }
            )
        if path == "/auth/v1/logout":
            return send({})
        if path == "/rest/v1/atlas_templates":
            if method == "GET":
                return send(list(templates.values()))
            data = r.post_data_json if method != "DELETE" else {}
            if method == "POST":
                templates[data["id"]] = data
                return send({"id": data["id"]}, 201)
            key = q["id"][0][3:]
            if (
                key not in templates
                or int(q["revision"][0][3:]) != templates[key]["revision"]
            ):
                return send({"message": "revision conflict"}, 409)
            if method == "PATCH":
                templates[key].update(data)
            elif method == "DELETE":
                del templates[key]
            return send({"id": key})
        if path.startswith("/storage/v1/object/public/"):
            key = path.split("/public/", 1)[1]
            if key not in files:
                return send({}, 404)
            if key.startswith("images/"):
                return send(files[key], mime="image/png")
            return send(json.loads(files[key]))
        if path == "/storage/v1/object/list/presentations":
            return send(
                [
                    {"name": k.split("/")[1]}
                    for k in files
                    if k.startswith("presentations/")
                ]
            )
        if path.startswith("/storage/v1/object/"):
            key = path.split("/object/", 1)[1]
            if method == "DELETE":
                for name in r.post_data_json["prefixes"]:
                    files.pop(key + "/" + name, None)
                return send([])
            if method == "POST":
                payload = r.post_data_buffer
                content_type = r.headers.get("content-type", "")
                if content_type.startswith("multipart/"):
                    parts = BytesParser(policy=default).parsebytes(
                        ("Content-Type: " + content_type + "\r\n\r\n").encode()
                        + payload
                    )
                    payload = next(
                        part.get_payload(decode=True)
                        for part in parts.iter_parts()
                        if part.get_filename() is not None
                    )
                files[key] = payload
                return send({"Key": key})
        return send({"message": "unhandled test route " + path}, 404)

    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.route("https://atlas-test.supabase.co/**", endpoint)
    page = ctx.new_page()
    page.set_default_timeout(8000)
    page.on("dialog", lambda d: d.accept())
    page.goto(url)
    btn = lambda n: page.get_by_role("button", name=n, exact=True)

    def click(n):
        btn(n).click()

    def action(n):
        click("Действия с методичкой")
        click(n)

    click("Создать методичку")
    page.get_by_label("Электронная почта").fill("owner@example.org")
    page.get_by_label("Пароль").fill("local-fixture")
    page.locator(".dialog").get_by_role("button", name="Войти", exact=True).click()
    click("Шаблоны")
    click("Создать шаблон")
    page.get_by_label("Название шаблона").fill("Облако")
    click("Сохранить шаблон")
    card = page.locator(".template-card").filter(has_text="Облако")
    card.locator("summary").click()
    card.get_by_role("button", name="Сохранить в облаке").click()
    expect(card).to_contain_text("На устройстве и в облаке")
    assert len(templates) == 1
    card.get_by_role("button", name="Создать презентацию").click()
    click("Добавить текст")
    page.get_by_label("Текст", exact=True).fill("Тема занятия")
    with page.expect_file_chooser() as chooser:
        click("Изображение")
    chooser.value.set_files(ROOT / "public/icons/atlas-192.png")
    expect(page.locator(".canvas img")).to_be_visible()
    page.locator(".inspector summary", has_text="Шрифты и общие стили").click()
    page.locator(".inspector input[type=file]").set_input_files(
        ROOT / "src/assets/fonts/Serif.woff"
    )
    style = (
        page.locator(".inspector details")
        .filter(has=page.locator("summary", has_text="Шрифты и общие стили"))
        .last
    )
    style.get_by_label("Гарнитура", exact=True).select_option(label="Serif.woff")
    click("Добавить текст")
    page.get_by_role("textbox", name="Текст", exact=True).fill("Черновой материал")
    page.get_by_label("Размещение объекта").select_option("tray")
    action("Опубликовать")
    link = page.locator(".dialog input[readonly]").input_value()
    assert any(k.startswith("images/") for k in files)
    guest = browser.new_context()
    guest.route("https://atlas-test.supabase.co/**", endpoint)
    public = guest.new_page()
    public.goto(link)
    expect(public.locator(".atlas-stage:visible").first).to_be_visible()
    expect(public.get_by_text("Тема занятия", exact=True).first).to_be_visible()
    expect(public.locator(".atlas-stage img").first).to_be_visible()
    public.wait_for_function(
        "Array.from(document.fonts).some(f=>f.family.startsWith('AtlasUser') && f.status==='loaded')"
    )
    assert not any(
        o["text"] == "Черновой материал"
        for raw in [v for k, v in files.items() if k.startswith("presentations/")]
        for s in json.loads(raw)["slides"]
        for o in s["items"]
    )
    assert (
        len(
            json.loads(
                next(v for k, v in files.items() if k.startswith("presentations/"))
            )["resources"]["fonts"]
        )
        == 1
    )
    click("Закрыть")
    click("В библиотеку")
    click("Опубликованные")
    click("Снять с публикации")
    expect(page.get_by_text("Публикаций пока нет")).to_be_visible()
    public.reload()
    expect(public.get_by_text("Публикация недоступна.", exact=False)).to_be_visible()
    click("Шаблоны")
    card.locator("summary").click()
    card.get_by_role("button", name="Удалить шаблон").click()
    expect(card).to_have_count(0)
    assert not templates
    guest.close()
    ctx.close()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        (Path(tmp) / "lessons").symlink_to(
            Path(sys.argv[1]).resolve(), target_is_directory=True
        )
        h = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=tmp))
        Thread(target=h.serve_forever, daemon=True).start()
        b = p.chromium.launch(
            executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"),
            args=["--no-sandbox"],
        )
        flow(b, f"http://127.0.0.1:{h.server_port}/lessons/", tmp)
        b.close()
        h.shutdown()
        print(
            "PASS: Supabase client fixture: owner login, private templates, image upload, public projector JSON, guest view and unpublish"
        )
