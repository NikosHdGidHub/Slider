"""Client integration with a local HTTP fixture implementing the Supabase routes used by the app.
Build with VITE_SUPABASE_URL=https://atlas-test.supabase.co, VITE_SUPABASE_ANON_KEY=sb_publishable_fixture
and VITE_ADMIN_UUID=00000000-0000-4000-8000-000000000001. Pass the output directory as argv[1].
"""

import base64
import hashlib
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
from urllib.parse import parse_qs, unquote, urlparse

from browser import ROOT, QuietHandler
from playwright.sync_api import expect, sync_playwright

OWNER = "00000000-0000-4000-8000-000000000001"


def flow(browser, url, tmp):
    files, templates, requests = {}, {}, []

    catalog = {}
    folders = {}
    reject_publish = False
    reject_delete = False
    reject_read = False
    locks = {}

    def endpoint(route):
        r = route.request
        u = urlparse(r.url)
        q = parse_qs(u.query)
        path = unquote(u.path)
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
        if path == "/rest/v1/rpc/atlas_lock_publication":
            key = r.post_data_json["document_id"]
            if key in locks: return send(False)
            locks[key] = r.post_data_json["lock_token"]
            return send(True)
        if path == "/rest/v1/atlas_publication_locks":
            key=q["id"][0][3:]
            if locks.get(key)==q["token"][0][3:]: locks.pop(key)
            return send({})
        if path == "/rest/v1/atlas_folders":
            if method == "POST":
                folders[r.post_data_json["name"]] = r.post_data_json
                return send({},201)
            return send(list(folders.values()))
        if path in ("/rest/v1/atlas_files", "/rest/v1/atlas_file_inventory"):
            key = q.get("bucket", [""])[0][3:] + "/" + q.get("path", [""])[0][3:]
            if method == "POST":
                row = r.post_data_json
                catalog.setdefault(row["bucket"]+"/"+row["path"], row)
                return send({}, 201)
            if method == "PATCH":
                catalog[key].update(r.post_data_json)
                return send(catalog[key])
            if method == "DELETE":
                catalog.pop(key, None)
                return send({})
            rows = []
            for physical, contents in sorted(files.items()):
                bucket, name = physical.split("/",1)
                if bucket not in ("images","atlas-private"):
                    continue
                row = catalog.get(physical) or dict(
                    bucket=bucket,path=name,name=name.split("/")[-1],sha=None,folder="",
                    mime="image/png" if name.endswith(".png") else "application/octet-stream",
                    size=len(contents),created_at="2025-01-01",
                )
                if key != "/" and key != physical: continue
                if "sha" in q and q["sha"][0][3:] != row["sha"]: continue
                rows.append(row)
            if "vnd.pgrst.object" in r.headers.get("accept",""):
                return send(rows[0] if rows else None)
            return send(rows)
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
                return send(files[key], mime="image/" + (key.rsplit(".",1)[1].replace("jpg","jpeg")))
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
            if key.startswith("info/"):
                return send({} if key.removeprefix("info/") in files else {"message":"Missing"}, 200 if key.removeprefix("info/") in files else 404)
            if method in ("POST","DELETE") and not any(
                r.headers.get("x-client-info") == "atlas-storage/" + token for token in locks.values()
            ):
                return send({"message":"missing storage lease"}, 403)
            if method == "DELETE":
                if reject_delete: return send({"message":"Storage отказал в удалении"},403)
                for name in r.post_data_json["prefixes"]:
                    files.pop(key + "/" + name, None)
                return send([])
            if method == "GET" and key.removeprefix("authenticated/") in files:
                if reject_read and "presentations/" in key: return send({"message":"read unavailable"},503)
                return send(files[key.removeprefix("authenticated/")],mime="application/octet-stream")
            if method == "POST":
                if reject_publish and key.startswith("presentations/"):
                    return send({"message":"test failure"},403)
                if key in files and r.headers.get("x-upsert") != "true":
                    return send({"message":"The resource already exists","statusCode":"409"},409)
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
    assert not any(k.startswith("images/") for k in files)
    title = page.get_by_label("Название методички").input_value()
    click("В библиотеку")
    click("Оставить локально и выйти")
    click("Мои файлы")
    expect(page.locator(".file-card")).to_have_count(1)
    page.reload()
    click("Мои файлы")
    expect(page.locator(".file-card")).to_have_count(1)
    page.evaluate("""() => new Promise((resolve,reject) => {
        const request = indexedDB.open('atlas-lessons-v1')
        request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('lessons','readwrite')
            const store = tx.objectStore('lessons')
            const query = store.getAll()
            query.onsuccess = () => {
                const copy = query.result[0]
                copy.deck.title = 'Повторное использование'
                copy.deck.id = crypto.randomUUID()
                const slide = copy.deck.slides.find(s => s.items.some(o=>o.type==='image'))
                const image = slide.items.find(o=>o.type==='image')
                slide.background = image.src
                image.slot = 'tray'
                store.add(copy)
            }
            tx.oncomplete = () => { db.close(); resolve() }
            tx.onerror = () => reject(tx.error)
        }
    })""")
    ctx.set_offline(True)
    page.reload()
    click("Мои файлы")
    expect(page.locator(".file-card")).to_have_count(1)
    expect(page.get_by_text("Методички (2)")).to_be_visible()
    click("Мои методички")
    click("Удалить Повторное использование")
    click("Мои файлы")
    expect(page.get_by_text("Методички (1)")).to_be_visible()
    ctx.set_offline(False)
    page.locator(".file-links summary").click()
    click(title)
    click("Опубликовать")
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
    # A second browser profile has the same teacher account but an empty IndexedDB.
    device = browser.new_context(storage_state=ctx.storage_state(), viewport={"width": 1440, "height": 900})
    device.route("https://atlas-test.supabase.co/**", endpoint)
    second = device.new_page()
    dialog_handler = lambda dialog: dialog.accept()
    second.on("dialog", dialog_handler)
    second.goto(url)
    b = lambda text: second.get_by_role("button", name=text, exact=True)
    b("Опубликованные").click()
    b("Редактировать").click()
    expect(b("Опубликовано")).to_be_disabled()
    b("Слайд").click()
    b("Фон из моих файлов").click()
    second.locator(".file-grid button").first.click()
    second.get_by_label("Название методички").fill("Версия со второго устройства")
    public.reload()
    expect(public.get_by_text("Версия со второго устройства",exact=True)).to_have_count(0)
    b("Выбрать из моих файлов").click()
    second.locator(".file-grid button").first.click()
    expect(second.locator(".canvas img[src^='data:']").first).to_be_visible()
    expect(b("Обновить публикацию")).to_be_enabled()
    b("В библиотеку").click()
    b("Продолжить редактирование").click()
    b("В библиотеку").click()
    reject_publish = True
    b("Опубликовать и выйти").click()
    expect(second.get_by_text("Не удалось опубликовать методичку.", exact=False)).to_be_visible()
    expect(b("Продолжить редактирование")).to_be_visible()
    reject_publish = False
    b("Опубликовать и выйти").click()
    expect(second.locator(".cards .card")).to_have_count(1)
    assert len([k for k in files if k.startswith("presentations/")]) == 1
    assert len([k for k in files if k.startswith("images/")]) == 1
    public.reload()
    updated = json.loads(next(v for k,v in files.items() if k.startswith("presentations/")))
    assert updated["title"]=="Версия со второго устройства"
    assert any((s.get("background") or "").startswith("https://") for s in updated["slides"])
    b("Редактировать Версия со второго устройства").click()
    b("Действия с методичкой").click()
    b("Подготовить к офлайн-показу").click()
    expect(second.get_by_text("Готово к офлайн-показу.",exact=False)).to_be_visible()
    expect(b("Опубликовано")).to_be_disabled()
    b("В библиотеку").click()
    device.set_offline(True)
    second.reload()
    b("Редактировать Версия со второго устройства").click()
    expect(second.locator(".canvas img").first).to_be_visible()
    assert second.locator(".canvas img").first.get_attribute("src").startswith("data:image/")
    b("В библиотеку").click()
    if b("Оставить локально и выйти").is_visible(): b("Оставить локально и выйти").click()
    device.set_offline(False)
    b("Мои файлы").click()
    local_card = second.locator(".file-grid article")
    expect(local_card).to_have_count(1)
    expect(local_card).to_contain_text("Методички (1)")
    assert second.locator(".files-library input[type=file]").count()==0
    b("В облаке").click()
    expect(second.get_by_text("Используется в 1 публикации")).to_be_visible()
    reject_read = True
    b("Обновить список").click()
    expect(second.get_by_text("Использование не проверено")).to_be_visible()
    reject_read = False
    b("Обновить список").click()
    expect(second.get_by_text("Используется в 1 публикации")).to_be_visible()
    upload = second.locator("fieldset input[type=file]")
    for filename in ["lesson.pdf", "copy.pdf"]:
        upload.set_input_files({"name": filename,"mimeType":"application/pdf","buffer":b"%PDF-1.4\nexample"})
        expect(second.locator("fieldset")).to_be_enabled()
        expect(second.get_by_text("lesson.pdf",exact=True)).to_be_visible()
    assert len([k for k in files if k.startswith("atlas-private/")]) == 1
    second.get_by_label("Поиск по названию").fill("lesson.pdf")
    expect(second.locator(".file-grid article")).to_have_count(1)
    paper = second.locator(".file-grid article")
    paper.locator(".file-actions summary").click()
    b("Удалить из облака").click()
    reject_delete = True
    b("Удалить").click()
    expect(second.get_by_role("alert")).to_contain_text("Storage отказал")
    expect(paper).to_contain_text("lesson.pdf")
    reject_delete = False
    b("Удалить из облака").click()
    b("Удалить").click()
    expect(paper).to_have_count(0)
    assert not any(k.startswith("atlas-private/") for k in files)
    second.get_by_label("Поиск по названию").fill("")
    ask = lambda dialog: dialog.accept("Материалы" if "папк" in dialog.message.lower() else "Урок.pdf")
    second.remove_listener("dialog", dialog_handler)
    second.on("dialog",ask)
    b("Создать папку").click()
    expect(second.get_by_label("Папка",exact=True)).to_have_value("Материалы")
    pdf = {"name":"новый.pdf","mimeType":"application/pdf","buffer":b"%PDF-1.4\nsecond"}
    upload.set_input_files(pdf)
    expect(second.locator(".file-grid article")).to_have_count(1)
    second.locator(".file-actions summary").click()
    b("Переименовать").click()
    expect(second.locator(".file-grid article")).to_contain_text("Урок.pdf")
    with second.expect_download() as downloaded:
        b("Скачать").click()
    assert Path(downloaded.value.path()).read_bytes()==pdf["buffer"]
    second.get_by_label("Переместить в папку").select_option("")
    expect(second.locator(".file-grid article")).to_have_count(0)
    second.get_by_label("Папка", exact=True).select_option("")
    third = ctx.new_page()
    third.goto(url)
    third.get_by_role("button",name="Мои файлы",exact=True).click()
    third.get_by_role("button",name="В облаке",exact=True).click()
    twin = dict(pdf, name="другое.pdf",buffer=b"%PDF-1.4 concurrent")
    third.locator("fieldset input[type=file]").set_input_files(twin)
    upload.set_input_files(twin)
    expect(second.get_by_text("другое.pdf",exact=True)).to_be_visible()
    expect(third.get_by_text("другое.pdf",exact=True)).to_be_visible()
    assert len([k for k in files if k.startswith("atlas-private/")])==2
    third.close()
    for ext in ["png","jpeg","webp"]:
        uri=second.evaluate("(t)=>document.createElement('canvas').toDataURL('image/'+t)",ext)
        upload.set_input_files({"name":"цвет."+ext,"mimeType":"image/"+ext,"buffer":base64.b64decode(uri.split(",")[1])})
        expect(second.get_by_text("цвет."+ext,exact=True)).to_be_visible()
    upload.set_input_files({"name":"образец.json","mimeType":"application/json","buffer":next(v for k,v in files.items() if k.startswith("presentations/"))})
    expect(second.get_by_text("образец.json",exact=True)).to_be_visible()
    upload.set_input_files({"name":"образец.pptx","mimeType":"application/vnd.openxmlformats-officedocument.presentationml.presentation","buffer":b"PK\x03\x04test"})
    expect(second.get_by_text("образец.pptx",exact=True)).to_be_visible()
    legacy = "images/archive/legacy.png"
    files[legacy] = (ROOT / "public/icons/atlas-512.png").read_bytes()
    hidden = "images/previously-hidden.png"
    files[hidden] = (ROOT / "public/icons/atlas-192.png").read_bytes()
    catalog[hidden] = dict(bucket="images",path="previously-hidden.png",name="Ранее скрытый.png",
        sha=hashlib.sha256(files[hidden]).hexdigest(),mime="image/png",folder="",hidden=True,
        size=len(files[hidden]),created_at="2025-01-01")
    b("Обновить список").click()
    expect(second.get_by_text("legacy.png",exact=True)).to_be_visible()
    b("Открыть изображение legacy.png").click()
    expect(second.get_by_role("dialog",name="legacy.png").locator("img")).to_be_visible()
    b("Закрыть").click()
    expect(second.get_by_text("Ранее скрытый.png",exact=True)).to_be_visible()
    expect(second.locator("fieldset")).to_be_enabled()
    with second.expect_response(lambda response: response.request.method=="POST" and response.url.split("?")[0].endswith("/atlas_files")):
        upload.set_input_files(ROOT / "public/icons/atlas-512.png")
    expect(second.locator("fieldset")).to_be_enabled()
    assert catalog[legacy]["sha"] == hashlib.sha256(files[legacy]).hexdigest()
    assert sum(contents==files[legacy] for contents in files.values()) == 1
    previous=second.locator(".file-card").filter(has_text="Ранее скрытый.png")
    previous.locator(".file-actions summary").click()
    previous.get_by_role("button",name="Удалить из облака").click()
    expect(second.get_by_role("dialog",name="Удалить файл из облака?")).to_be_visible()
    reject_read=True
    b("Удалить").click()
    expect(second.get_by_text("Использование не проверено").first).to_be_visible()
    assert hidden in files
    reject_read=False
    b("Обновить список").click()
    previous.get_by_role("button",name="Удалить из облака").click()
    b("Удалить").click()
    expect(previous).to_have_count(0)
    assert hidden not in files and hidden not in catalog
    second.get_by_label("Тип файла").select_option("application/vnd")
    expect(second.locator(".file-grid article")).to_have_count(1)
    upload.set_input_files({"name":"bad.txt","mimeType":"text/plain","buffer":b"error"})
    expect(second.get_by_text("Формат файла не поддерживается.",exact=False)).to_be_visible()
    second.get_by_label("Тип файла").select_option("")
    files["images/"+"long"*40+".png"] = files[legacy]
    b("Обновить список").click()
    expect(second.get_by_text("long"*40+".png",exact=True)).to_be_visible()
    for width,height in [(1600,1000),(1280,800),(768,1024),(360,780)]:
        second.set_viewport_size({"width":width,"height":height})
        assert second.evaluate("document.documentElement.scrollWidth === innerWidth"),width
    second.set_viewport_size({"width":1440,"height":900})
    click("Редактировать")
    click("Синхронизовать")
    click("Загрузить опубликованную версию")
    expect(btn("Опубликовано")).to_be_disabled()
    click("В библиотеку")
    expect(page.locator(".cards")).to_contain_text("до синхронизации")
    click("Опубликованные")
    click("Снять с публикации")
    expect(page.get_by_text("Публикаций пока нет")).to_be_visible()
    second.get_by_label("Тип файла").select_option("image/")
    used_image = second.locator(".file-card").filter(has_text="Изображение.")
    used_image.locator(".file-actions summary").click()
    expect(used_image.get_by_role("button",name="Удалить из облака")).to_have_count(0)
    b("Обновить список").click()
    used_image.get_by_role("button",name="Удалить из облака").click()
    b("Удалить").click()
    expect(used_image).to_have_count(0)
    assert not any(row.get("name","").startswith("Изображение.") for row in catalog.values())
    b("Мои методички").click()
    b("Редактировать Версия со второго устройства").click()
    expect(second.locator(".canvas img[src^='data:']").first).to_be_visible()
    device.close()
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
            "PASS: cloud inventory, local copies, publication lifecycle, file deletion, deduplication and responsive layout"
        )
