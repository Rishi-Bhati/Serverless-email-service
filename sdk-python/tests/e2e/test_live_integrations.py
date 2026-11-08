"""Django and FastAPI against the live worker."""

import time

import pytest

from conftest import API_KEY, API_SECRET, BASE_URL, FROM, uid
from unsent import Unsent

pytestmark = pytest.mark.skipif(not BASE_URL, reason="live worker not configured")


def test_django_send_mail_against_the_live_worker():
    pytest.importorskip("django")
    from django.conf import settings

    if not settings.configured:
        settings.configure(EMAIL_BACKEND="unsent.django.UnsentEmailBackend", DEFAULT_FROM_EMAIL=FROM, SECRET_KEY="x", INSTALLED_APPS=[], USE_TZ=True)
        import django

        django.setup()
    from django.core.mail import EmailMessage, EmailMultiAlternatives, send_mail
    from django.test import override_settings

    tag = uid()
    live = Unsent(base_url=BASE_URL, api_key=API_KEY, api_secret=API_SECRET)
    with override_settings(UNSENT_BASE_URL=BASE_URL, UNSENT_API_KEY=API_KEY, UNSENT_API_SECRET=API_SECRET, EMAIL_BACKEND="unsent.django.UnsentEmailBackend", DEFAULT_FROM_EMAIL=FROM):
        assert send_mail(f"dj plain {tag}", "Plain body", None, [f"dj-{tag}@example.com"]) == 1
        msg = EmailMultiAlternatives(f"dj multi {tag}", "text part", f"Django Test <{FROM}>", [f"to-{tag}@example.com"], cc=[f"cc-{tag}@example.com"], bcc=[f"bcc-{tag}@example.com"])
        msg.attach_alternative(f"<p>html {tag}</p>", "text/html")
        msg.attach("data.bin", bytes(range(256)), "application/octet-stream")
        msg.attach("note.txt", "héllo", "text/plain")
        assert msg.send() == 1
        mail_obj = EmailMessage(f"dj html {tag}", "<b>bold</b>", FROM, [f"h-{tag}@example.com"])
        mail_obj.content_subtype = "html"
        assert mail_obj.send() == 1
        bad = EmailMessage(f"dj bad {tag}", "x", "stranger@evil.test", ["a@example.com"])
        assert bad.send(fail_silently=True) == 0
        with pytest.raises(Exception) as ei:
            bad.send()
        assert getattr(ei.value, "code", "") == "unauthorized_sender"

    ids = {}
    for e in live.emails.list(search=tag, limit=50).emails:
        ids[e.subject] = e
    assert set(ids) == {f"dj plain {tag}", f"dj multi {tag}", f"dj html {tag}"}
    multi = live.emails.wait(ids[f"dj multi {tag}"].id, timeout=30)
    assert multi.status == "sent" and multi.cc == [f"cc-{tag}@example.com"] and multi.bcc == [f"bcc-{tag}@example.com"]
    assert multi.from_name == "Django Test" and multi.text_body == "text part" and multi.html_body == f"<p>html {tag}</p>"
    assert {a.filename: a.size for a in multi.attachments} == {"data.bin": 256, "note.txt": len("héllo".encode())}
    assert next(a for a in multi.attachments if a.filename == "data.bin").to_bytes() == bytes(range(256))
    assert live.emails.wait(ids[f"dj plain {tag}"].id, timeout=30).status == "sent"
    assert live.emails.wait(ids[f"dj html {tag}"].id, timeout=30).html_body == "<b>bold</b>"


def test_fastapi_against_the_live_worker():
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from unsent.fastapi import UnsentDep, add_exception_handlers, lifespan

    app = FastAPI(lifespan=lifespan(base_url=BASE_URL, api_key=API_KEY, api_secret=API_SECRET, default_from=FROM))
    add_exception_handlers(app)

    @app.post("/send")
    async def send(to: str, unsent: UnsentDep):
        r = await unsent.send(to=to, subject="fastapi e2e", text="hello")
        e = await unsent.emails.wait(r.id, timeout=30)
        return {"id": r.id, "status": e.status}

    @app.post("/bad")
    async def bad(unsent: UnsentDep):
        await unsent.send(from_="stranger@evil.test", to="a@example.com", subject="s", text="t")

    with TestClient(app) as http:
        t0 = time.monotonic()
        r = http.post("/send", params={"to": f"fa-{uid()}@example.com"})
        assert r.status_code == 200 and r.json()["status"] == "sent", r.text
        assert time.monotonic() - t0 < 30
        r = http.post("/bad")
        assert r.status_code == 502 and r.json()["error"] == "unauthorized_sender"


def test_flask_recipe_against_the_live_worker():
    flask = pytest.importorskip("flask")
    from unsent import Unsent as _Unsent

    app = flask.Flask(__name__)
    client = _Unsent(base_url=BASE_URL, api_key=API_KEY, api_secret=API_SECRET, default_from=FROM)

    @app.post("/contact")
    def contact():
        data = flask.request.get_json()
        result = client.send(to="support@example.com", subject=f"Contact from {data['email']}", text=data["message"])
        return {"id": result.id}, 202

    c = app.test_client()
    r = c.post("/contact", json={"email": "me@example.com", "message": "Hello <there>"})
    assert r.status_code == 202
    assert client.emails.wait(r.get_json()["id"], timeout=30).text_body == "Hello <there>"
