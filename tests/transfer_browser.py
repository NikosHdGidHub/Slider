"""Chromium handoff test. Pass the fixture build directory as argv[1]."""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from browser import ROOT, QuietHandler
from playwright.sync_api import expect, sync_playwright

OWNER = "43649fda-26cb-4b20-bbc1-0a398e9d8ce3"
LESSON = "11111111-1111-4111-8111-111111111111"
SECOND = "22222222-2222-4222-8222-222222222222"
API = "https://atlas-test.supabase.co"
FIELDS = {
    "start": ["sender_hash", "receiver_hash"],
    "inspect": ["request_id", "sender_token"],
    "send": ["request_id", "sender_token", "publication_id"],
    "poll": ["request_id", "receiver_token"],
    "cancel": ["request_id", "receiver_token"],
}


def jwt(claims):
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return "eyJhbGciOiJIUzI1NiJ9." + payload + ".Zml4dHVyZQ"


def scan(locator):
    png = locator.screenshot()
    # Decode the rendered QR at its actual screen size, independently of the encoder.
    return subprocess.run(
        [
            "node", "-e",
            "const {PNG}=require('pngjs');const qr=require('jsqr');"
            "const png=PNG.sync.read(require('fs').readFileSync(0));"
            "const result=qr(new Uint8ClampedArray(png.data),png.width,png.height);"
            "if(!result)process.exit(1);process.stdout.write(result.data);",
        ],
        input=png,
        capture_output=True,
        check=True,
        cwd=ROOT,
    ).stdout.decode()


def exercise(browser, server_url, db):
    assert db.stdout.readline().strip() == "ready"
    document = json.loads((ROOT / "tests/fixtures/water-cycle.json").read_text())
    titles = {LESSON: "Методичка для аудитории", SECOND: "Запасная методичка"}
    user = {"id": OWNER, "aud": "authenticated", "role": "authenticated",
            "email": "teacher@example.org", "app_metadata": {}, "user_metadata": {},
            "created_at": "2025-01-01T00:00:00Z"}
    access_token = jwt({"sub": OWNER, "role": "authenticated", "exp": int(time.time()) + 3600})
    calls = []

    def endpoint(route, device):
        request = route.request
        path = urlparse(request.url).path
        owned = request.headers.get("authorization") == "Bearer " + access_token
        calls.append((device, request.method, path, owned))

        def send(payload, status=200):
            route.fulfill(status=status, json=payload, headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            })

        if request.method == "OPTIONS":
            return send({})
        if path == "/auth/v1/token":
            assert device == "phone"
            return send({"user": user, "access_token": access_token, "refresh_token": "fixture-refresh",
                         "token_type": "bearer", "expires_in": 3600})
        if path.startswith("/rest/v1/rpc/atlas_transfer_"):
            action = path.rsplit("_", 1)[1]
            args = request.post_data_json
            assert set(args) == set(FIELDS[action])
            if action in ("start", "poll", "cancel"):
                assert not owned
            db.stdin.write(json.dumps({"action": action, "args": [args[field] for field in FIELDS[action]],
                                       "actor": {"teacher": OWNER} if owned else {}}) + "\n")
            db.stdin.flush()
            result = json.loads(db.stdout.readline())
            if "error" in result:
                return send({"message": result["error"], "code": result["code"]},
                            403 if result["code"] == "42501" else 400)
            if action == "poll" and result["data"]["status"] == "received":
                assert set(result["data"]) == {"status", "publication_id"}
            return send(result["data"])
        if path == "/rest/v1/atlas_templates":
            return send([])
        if path == "/storage/v1/object/list/presentations":
            assert owned and device == "phone", "Guest must never list publications"
            return send([{"name": i + ".json"} for i in titles])
        if path.startswith("/storage/v1/object/public/presentations/"):
            assert not owned
            lesson = path.rsplit("/", 1)[1].removesuffix(".json")
            if lesson in titles:
                return send({**document, "id": lesson, "title": titles[lesson]})
        return send({"message": "not found"}, 404)

    def make_device(label, size, **options):
        context = browser.new_context(viewport={"width": size[0], "height": size[1]}, **options)
        context.route(API + "/**", lambda route: endpoint(route, label))
        page = context.new_page()
        page.set_default_timeout(8000)
        return context, page

    def button(page, label):
        return page.get_by_role("button", name=label, exact=True)

    def receive(page):
        page.goto(server_url)
        button(page, "Опубликованные").click()
        expect(page.get_by_text("Публикации владельца")).to_be_visible()
        button(page, "Получить методичку с телефона").click()
        qr = page.get_by_alt_text("Одноразовый QR-код подключения компьютера")
        expect(qr).to_be_visible()
        url = scan(qr)
        assert url.startswith(server_url + "#transfer/")
        code = page.locator(".transfer-code strong").inner_text()
        return url, code

    ac, first = make_device("first", (1440, 900), permissions=["clipboard-read", "clipboard-write"])
    bc, second = make_device("second", (768, 1024))
    pc, phone = make_device("phone", (360, 780), is_mobile=True, has_touch=True)
    first_url, first_code = receive(first)
    second_url, second_code = receive(second)
    assert first_url != second_url
    assert first_url.split("/")[-1] != second_url.split("/")[-1]
    phone.goto(first_url)
    expect(button(phone, "Войти в аккаунт преподавателя")).to_be_visible()
    expect(phone.get_by_role("radio")).to_have_count(0)
    assert not any(device == "phone" and "/list/presentations" in path for device, _, path, _ in calls)
    button(phone, "Войти в аккаунт преподавателя").click()
    phone.get_by_label("Электронная почта").fill(user["email"])
    phone.get_by_label("Пароль").fill("fixture-password")
    phone.get_by_role("dialog").get_by_role("button", name="Войти", exact=True).click()
    expect(phone.get_by_role("radio")).to_have_count(2)
    assert phone.evaluate("document.documentElement.scrollWidth === innerWidth")
    expect(phone.locator(".transfer-code strong")).to_have_text(first_code)
    assert phone.url == first_url
    phone.get_by_role("radio", name=titles[LESSON]).check()
    expect(button(phone, "Передать на компьютер")).to_be_disabled()
    phone.get_by_role("checkbox").check()
    button(phone, "Передать на компьютер").click()
    expect(phone.get_by_role("heading", name="Ссылка передана на компьютер")).to_be_visible()
    expect(first.get_by_role("heading", name="Методичка получена")).to_be_visible()
    expect(first.get_by_text(titles[LESSON], exact=True)).to_be_visible()
    expect(second.get_by_text("Ожидаем передачу")).to_be_visible()
    assert first.url.endswith("#receive-lesson")
    public_link = server_url + "#p/" + LESSON
    expect(first.get_by_label("Публичная ссылка")).to_have_value(public_link)
    button(first, "Скопировать ссылку").click()
    expect(first.get_by_text("Публичная ссылка скопирована.")).to_be_visible()
    assert first.evaluate("navigator.clipboard.readText()") == public_link
    button(first, "Показать QR-код для учеников").click()
    student_qr = first.get_by_alt_text("Публичный QR-код для учеников")
    assert scan(student_qr) == public_link
    first.get_by_role("link", name="Открыть методичку").click()
    expect(first.locator(".atlas-stage").first).to_be_visible()
    assert first.url == public_link
    assert first.evaluate("Object.keys(localStorage).every(key => !key.includes('auth-token') && !key.startsWith('atlas-owner-'))")
    first_poll_count = sum(device == "first" and path.endswith("_poll") for device, _, path, _ in calls)
    phone.reload()
    expect(phone.get_by_text("Этот запрос уже использован.", exact=False)).to_be_visible()
    expect(phone.get_by_role("radio")).to_have_count(0)
    phone.goto(second_url)
    expect(phone.locator(".transfer-code strong")).to_have_text(second_code)
    bc.set_offline(True)
    expect(second.get_by_text("Нет интернета.", exact=False)).to_be_visible()
    bc.set_offline(False)
    expect(second.get_by_text("Ожидаем передачу")).to_be_visible()
    button(second, "Отменить ожидание").click()
    expect(second.get_by_text("Публикации владельца")).to_be_visible()
    phone.reload()
    expect(phone.get_by_text("Ожидание отменено на компьютере.")).to_be_visible()
    assert sum(device == "first" and path.endswith("_poll") for device, _, path, _ in calls) == first_poll_count
    for context in (pc, bc, ac):
        context.close()


def main():
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
        root = Path(tmp)
        (root / "lessons").symlink_to(Path(sys.argv[1]).resolve(), target_is_directory=True)
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=tmp))
        Thread(target=server.serve_forever, daemon=True).start()
        db = subprocess.Popen(["node", "tests/transfer-db.mjs"], cwd=ROOT, stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, text=True)
        browser = pw.chromium.launch(
            executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"),
            args=["--no-sandbox"],
        )
        try:
            exercise(browser, f"http://127.0.0.1:{server.server_port}/lessons/", db)
        finally:
            browser.close()
            db.stdin.close()
            db.wait(timeout=15)
            server.shutdown()
    print("PASS: handset login, two guest receivers, rendered QR decoding, one-time delivery, public viewing and cancellation")


if __name__ == "__main__":
    main()
