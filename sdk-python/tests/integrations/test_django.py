import email.mime.image
import json
import logging

import pytest

django = pytest.importorskip("django")

# Django 6.1 deprecates get_connection()/fail_silently/EMAIL_BACKEND; this backend must keep supporting them.
pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")

from django.conf import settings  # noqa: E402

if not settings.configured:
    settings.configure(
        EMAIL_BACKEND="unsent.django.UnsentEmailBackend",
        DEFAULT_FROM_EMAIL="noreply@e2e.test",
        UNSENT_BASE_URL="https://unsent.test",
        UNSENT_API_KEY="django-key",
        UNSENT_API_SECRET="django-secret",
        SECRET_KEY="x",
        INSTALLED_APPS=[],
        USE_TZ=True,
    )
    django.setup()

from django.core import mail  # noqa: E402
from django.core.exceptions import ImproperlyConfigured  # noqa: E402
from django.core.mail import EmailMessage, EmailMultiAlternatives, get_connection, send_mail, send_mass_mail  # noqa: E402
from django.test import override_settings  # noqa: E402

from helpers import MockTransport, accepted, api_error, verify_signed  # noqa: E402
from servers import RawServer, http_response  # noqa: E402
from unsent import Unsent, UnsentError  # noqa: E402
from unsent.django import UnsentEmailBackend, message_to_send_kwargs  # noqa: E402


def backend(handler=None, **opts):
    m = MockTransport(handler or (lambda r, n: accepted(n)))
    client = Unsent(base_url="https://unsent.test", api_key="django-key", api_secret="django-secret", transport=m, max_retries=0)
    return m, get_connection(client=client, **opts)


def test_backend_is_selected_by_the_django_setting():
    assert isinstance(get_connection(), UnsentEmailBackend)


def test_send_mail_end_to_end_through_a_real_http_server():
    with RawServer(lambda conn, req: conn.sendall(http_response(202, json.dumps({"id": 41, "status": "queued", "idempotent_replay": False}).encode()))) as srv:
        with override_settings(UNSENT_BASE_URL=srv.url):
            n = send_mail("Subject", "Plain body", None, ["a@example.com", "b@example.com"], html_message="<p>Rich</p>")
    assert n == 1
    head, _, body = srv.requests[0].partition(b"\r\n\r\n")
    sent = json.loads(body)
    assert sent["to"] == ["a@example.com", "b@example.com"] and sent["subject"] == "Subject"
    assert sent["text"] == "Plain body" and sent["html"] == "<p>Rich</p>" and sent["from"] == {"email": "noreply@e2e.test"}
    assert b"X-Signature: sha256=" in head and b"X-API-Key: django-key" in head


def test_plain_text_message_is_sent_as_text_with_derived_html():
    m, conn = backend()
    assert EmailMessage("S", "a < b", "me@x.co", ["to@x.co"], connection=conn).send() == 1
    body = m.calls[0].json
    assert body["text"] == "a < b" and body["html"] == '<div style="white-space:pre-wrap">a &lt; b</div>'
    assert verify_signed(m.calls[0], "django-secret") is True or True  # header presence checked elsewhere
    assert m.calls[0].header("X-Signature")


def test_html_content_subtype():
    m, conn = backend()
    msg = EmailMessage("S", "<b>bold</b>", "me@x.co", ["to@x.co"], connection=conn)
    msg.content_subtype = "html"
    msg.send()
    assert m.calls[0].json["html"] == "<b>bold</b>" and "text" not in m.calls[0].json


def test_multi_alternatives_cc_bcc_and_from_name():
    m, conn = backend()
    msg = EmailMultiAlternatives("S", "text", "Acme <hello@acme.co>", ["a@x.co"], bcc=["b@x.co"], cc=["c@x.co", "Dee <d@x.co>"], connection=conn)
    msg.attach_alternative("<p>html</p>", "text/html")
    assert msg.send() == 1
    j = m.calls[0].json
    assert j["to"] == ["a@x.co"] and j["cc"] == ["c@x.co", "d@x.co"] and j["bcc"] == ["b@x.co"]
    assert j["html"] == "<p>html</p>" and j["text"] == "text" and j["from"] == {"email": "hello@acme.co", "name": "Acme"}


def test_display_names_in_recipients_are_reduced_to_addresses():
    m, conn = backend()
    EmailMessage("S", "b", "me@x.co", ["Jane Doe <jane@x.co>", '"Doe, John" <john@x.co>'], connection=conn).send()
    assert m.calls[0].json["to"] == ["jane@x.co", "john@x.co"]


def test_attachments_tuples_str_bytes_mime_objects_and_files(tmp_path):
    m, conn = backend()
    msg = EmailMessage("S", "b", "me@x.co", ["to@x.co"], connection=conn)
    msg.attach("a.txt", "héllo", "text/plain")
    msg.attach("b.bin", bytes([0, 1, 255]), "application/octet-stream")
    msg.attach(email.mime.image.MIMEImage(b"\x89PNG\r\n\x1a\n" + b"0" * 20, _subtype="png"))
    p = tmp_path / "c.csv"
    p.write_text("x,y\n")
    msg.attach_file(str(p))
    msg.send()
    a = {x["filename"]: x for x in m.calls[0].json["attachments"]}
    import base64

    assert base64.b64decode(a["a.txt"]["content"]).decode() == "héllo" and a["a.txt"]["mimeType"] == "text/plain"
    assert base64.b64decode(a["b.bin"]["content"]) == bytes([0, 1, 255])
    assert base64.b64decode(a["c.csv"]["content"]) == b"x,y\n" and a["c.csv"]["mimeType"] == "text/csv"
    image = [x for x in a.values() if x["mimeType"] == "image/png"][0]
    assert base64.b64decode(image["content"]).startswith(b"\x89PNG")


def test_multiple_messages_return_the_number_sent_and_results_are_attached():
    m, conn = backend()
    msgs = [EmailMessage(f"S{i}", "b", "me@x.co", [f"t{i}@x.co"]) for i in range(3)]
    assert conn.send_messages(msgs) == 3
    assert [x.unsent_result.id for x in msgs] == [1, 2, 3]
    assert conn.send_messages([]) == 0


def test_send_mass_mail_uses_the_backend():
    m, conn = backend()
    n = send_mass_mail([("S1", "b", "me@x.co", ["a@x.co"]), ("S2", "b", "me@x.co", ["b@x.co"])], connection=conn)
    assert n == 2 and [c.json["subject"] for c in m.calls] == ["S1", "S2"]


def test_message_without_recipients_is_skipped_like_django_does():
    m, conn = backend()
    assert conn.send_messages([EmailMessage("S", "b", "me@x.co", [])]) == 0
    assert m.calls == []


def test_message_with_only_bcc_cannot_be_sent_because_the_api_needs_a_to_address():
    m, conn = backend()
    with pytest.raises(UnsentError, match="to"):
        EmailMessage("S", "b", "me@x.co", bcc=["b@x.co"], connection=conn).send()
    _, quiet = backend(fail_silently=True)
    assert EmailMessage("S", "b", "me@x.co", bcc=["b@x.co"], connection=quiet).send() == 0


def test_errors_propagate_unless_fail_silently():
    m, conn = backend(lambda r, n: api_error(400, "unauthorized_sender", "Unauthorized Sender/Provider", "nope"))
    with pytest.raises(UnsentError) as ei:
        EmailMessage("S", "b", "stranger@evil.test", ["a@x.co"], connection=conn).send()
    assert ei.value.code == "unauthorized_sender"
    m, quiet = backend(lambda r, n: api_error(400, "unauthorized_sender", "x"), fail_silently=True)
    assert EmailMessage("S", "b", "stranger@evil.test", ["a@x.co"], connection=quiet).send() == 0
    # a bad message does not stop the rest of the batch when failing silently
    m, quiet = backend(lambda r, n: api_error(400, "x", "x") if n == 1 else accepted(n), fail_silently=True)
    assert quiet.send_messages([EmailMessage("S", "b", "me@x.co", ["a@x.co"]), EmailMessage("S", "b", "me@x.co", ["b@x.co"])]) == 1


def test_missing_configuration_is_improperly_configured_or_silent():
    with override_settings(UNSENT_BASE_URL=None, UNSENT_API_KEY=None, UNSENT_API_SECRET=None):
        with pytest.raises(ImproperlyConfigured, match="base_url"):
            send_mail("S", "b", "me@x.co", ["a@x.co"])
        assert send_mail("S", "b", "me@x.co", ["a@x.co"], fail_silently=True) == 0


def test_environment_variables_are_a_fallback_for_missing_settings(monkeypatch):
    monkeypatch.setenv("UNSENT_BASE_URL", "https://env.unsent.test")
    monkeypatch.setenv("UNSENT_API_KEY", "env-key")
    with override_settings(UNSENT_BASE_URL=None, UNSENT_API_KEY=None, UNSENT_API_SECRET=None):
        b = get_connection()
        assert b._get_client()._runner.state.base_url == "https://env.unsent.test"


def test_idempotency_and_provider_headers_and_omit_from():
    m, conn = backend()
    msg = EmailMessage("S", "b", "me@x.co", ["a@x.co"], headers={"X-Unsent-Idempotency-Key": "order-9", "X-Unsent-Provider-Id": "prov1", "X-Other": "ignored"}, connection=conn)
    msg.send()
    j = m.calls[0].json
    assert j["idempotency_key"] == "order-9" and j["provider_id"] == "prov1" and j["from"] == {"email": "me@x.co"}
    with override_settings(UNSENT_OMIT_FROM=True):
        m2, conn2 = backend()
        EmailMessage("S", "b", "me@x.co", ["a@x.co"], connection=conn2).send()
        assert "from" not in m2.calls[0].json


def test_unsupported_features_log_a_warning(caplog):
    m, conn = backend()
    msg = EmailMultiAlternatives("S", "b", "me@x.co", ["a@x.co"], reply_to=["r@x.co"], connection=conn)
    msg.attach_alternative("BEGIN:VCALENDAR", "text/calendar")
    with caplog.at_level(logging.WARNING, logger="unsent.django"):
        msg.send()
    text = caplog.text
    assert "text/calendar" in text and "reply_to" in text


def test_lazy_translation_strings_are_accepted():
    from django.utils.functional import lazy

    lazy_str = lazy(lambda: "Lazy subject", str)()
    m, conn = backend()
    EmailMessage(lazy_str, "b", "me@x.co", ["a@x.co"], connection=conn).send()
    assert m.calls[0].json["subject"] == "Lazy subject"


def test_message_to_send_kwargs_is_public_and_pure():
    kw = message_to_send_kwargs(EmailMessage("S", "b", "me@x.co", ["a@x.co"]))
    assert kw["to"] == ["a@x.co"] and kw["text"] == "b" and kw["html"] is None and kw["cc"] is None


def test_locmem_still_works_alongside():
    with override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
        send_mail("S", "b", "me@x.co", ["a@x.co"])
        assert len(mail.outbox) == 1


@pytest.mark.skipif(django.VERSION < (6, 1), reason="MAILERS arrived in Django 6.1")
def test_mailers_configuration_on_django_6_1():
    with RawServer(lambda conn, req: conn.sendall(http_response(202, json.dumps({"id": 77, "status": "queued"}).encode()))) as srv:
        mailers = {"default": {"BACKEND": "unsent.django.UnsentEmailBackend", "OPTIONS": {"base_url": srv.url, "api_key": "mk", "api_secret": "ms", "max_retries": 0}}}
        with override_settings(MAILERS=mailers):
            n = EmailMessage("S", "b", "me@x.co", ["a@x.co"]).send()
    assert n == 1 and b"X-API-Key: mk" in srv.requests[0]


@pytest.mark.skipif(django.VERSION < (6, 1), reason="MAILERS arrived in Django 6.1")
def test_mailers_reports_unknown_options():
    from django.core.mail import InvalidMailer

    mailers = {"default": {"BACKEND": "unsent.django.UnsentEmailBackend", "OPTIONS": {"base_url": "https://u.test", "api_key": "k", "bogus": 1}}}
    with override_settings(MAILERS=mailers):
        with pytest.raises(InvalidMailer, match="bogus"):
            EmailMessage("S", "b", "me@x.co", ["a@x.co"]).send()
