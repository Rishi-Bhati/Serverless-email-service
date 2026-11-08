import base64
import io
import json
import subprocess

import pytest

from helpers import API_SECRET, BASE, MockTransport, accepted, resp, verify_signed
from unsent import Attachment, Unsent, UnsentValidationError

MSG = dict(to="a@b.co", subject="s", html="h")


def client(flavor, handler=None, **extra):
    return flavor.make(handler or (lambda r, n: accepted()), **extra)


def send(flavor, c, **kw):
    return flavor.run(c.send(**kw))


def test_sends_a_correctly_signed_request_the_server_accepts(flavor):
    m, c = client(flavor)
    res = send(flavor, c, from_="me@x.co", to="a@b.co", subject="Hello", html="<p>Hi</p>", text="Hi")
    req = m.calls[0]
    assert req.method == "POST" and req.path == "/api/send"
    assert req.header("Content-Type") == "application/json"
    assert req.header("Accept") == "application/json"
    assert req.header("User-Agent").startswith("unsent-sdk-python/")
    assert verify_signed(req) is True
    assert (res.id, res.status, res.idempotent_replay) == (1, "queued", False)


def test_signature_matches_openssl_hmac():
    """Cross-check against a completely separate implementation (the openssl CLI)."""
    m = MockTransport(lambda r, n: accepted())
    Unsent(base_url=BASE, api_key="k", api_secret=API_SECRET, transport=m).send(**MSG)
    r = m.calls[0]
    body_hash = subprocess.run(["openssl", "dgst", "-sha256", "-r"], input=r.body.encode(), capture_output=True, check=True).stdout.split()[0].decode()
    message = f"{r.header('X-Timestamp')}\n{r.header('X-Nonce')}\n{body_hash}"
    out = subprocess.run(["openssl", "dgst", "-sha256", "-hmac", API_SECRET, "-r"], input=message.encode(), capture_output=True, check=True)
    assert r.header("X-Signature") == "sha256=" + out.stdout.split()[0].decode()


def test_never_sends_routing_or_idempotency_headers(flavor):
    m, c = client(flavor)
    send(flavor, c, from_="me@x.co", to="a@b.co", subject="s", html="h", provider_id="p1", idempotency_key="k1")
    for name in ("X-Provider-Id", "X-Sender-Email", "Idempotency-Key"):
        assert not m.calls[0].has(name)
    assert m.calls[0].json["provider_id"] == "p1"
    assert m.calls[0].json["from"] == {"email": "me@x.co"}
    assert m.calls[0].json["idempotency_key"] == "k1"


def test_signs_unicode_and_large_bodies_byte_exactly(flavor):
    m, c = client(flavor)
    send(flavor, c, to="a@b.co", subject="Grüße 🎉", html='<p>日本語 — "quotes" \\ \n</p>' * 5000)
    assert verify_signed(m.calls[0]) is True
    assert "Grüße 🎉" in m.calls[0].body  # raw UTF-8, not \u escapes


def test_fresh_nonce_per_call(flavor):
    m, c = client(flavor)
    used = set()
    for _ in range(20):
        send(flavor, c, **MSG)
    for r in m.calls:
        assert verify_signed(r, used_nonces=used) is True
    assert len(used) == 20


def test_without_api_secret_only_the_api_key_is_sent(flavor):
    m, c = client(flavor, api_secret=None)
    send(flavor, c, **MSG)
    h = m.calls[0].headers
    assert h["x-api-key"] == "test-api-key"
    assert "x-signature" not in h and "x-nonce" not in h and "x-timestamp" not in h


def test_parses_named_senders(flavor):
    m, c = client(flavor)
    send(flavor, c, from_="Acme Support <help@acme.co>", **MSG)
    send(flavor, c, from_={"email": "help@acme.co", "name": "Acme"}, **MSG)
    send(flavor, c, from_='"Doe, Jane" <j@acme.co>', **MSG)
    send(flavor, c, from_="  <bare@acme.co>  ", **MSG)
    assert m.calls[0].json["from"] == {"email": "help@acme.co", "name": "Acme Support"}
    assert m.calls[1].json["from"] == {"email": "help@acme.co", "name": "Acme"}
    assert m.calls[2].json["from"] == {"email": "j@acme.co", "name": "Doe, Jane"}
    assert m.calls[3].json["from"] == {"email": "bare@acme.co"}


def test_derives_an_escaped_html_body_from_text_only_sends(flavor):
    m, c = client(flavor)
    send(flavor, c, to="a@b.co", subject="s", text="Line 1\n<b>& \"x\" 'y'</b>")
    body = m.calls[0].json
    assert body["text"] == "Line 1\n<b>& \"x\" 'y'</b>"
    assert body["html"] == '<div style="white-space:pre-wrap">Line 1\n&lt;b&gt;&amp; &quot;x&quot; &#39;y&#39;&lt;/b&gt;</div>'


def test_html_wins_and_text_is_kept_when_both_given(flavor):
    m, c = client(flavor)
    send(flavor, c, to="a@b.co", subject="s", html="<p>x</p>", text="x")
    assert m.calls[0].json["html"] == "<p>x</p>" and m.calls[0].json["text"] == "x"
    send(flavor, c, to="a@b.co", subject="s", html="<p>x</p>", text="   ")
    assert "text" not in m.calls[1].json


def test_recipients_accept_strings_lists_and_tuples_and_omit_empty_optionals(flavor):
    m, c = client(flavor)
    send(flavor, c, to=["a@b.co", " c@d.co ", "  "], cc="e@f.co", bcc=[], subject="s", html="h")
    send(flavor, c, to=("a@b.co",), subject="s", html="h")
    j = m.calls[0].json
    assert j["to"] == ["a@b.co", "c@d.co"] and j["cc"] == ["e@f.co"]
    for k in ("bcc", "attachments", "from", "provider_id"):
        assert k not in j
    assert m.calls[1].json["to"] == ["a@b.co"]


def test_encodes_attachments_from_every_supported_content_type(flavor, tmp_path):
    p = tmp_path / "report.csv"
    p.write_bytes(b"a,b\n1,2\n")
    from unsent import attachment_from_file

    m, c = client(flavor)
    send(
        flavor, c, to="a@b.co", subject="s", html="h",
        attachments=[
            Attachment(filename="a.txt", content=b"hello", content_type="text/plain"),
            {"filename": "b.bin", "content": bytearray([0, 255, 16]), "mime_type": "application/octet-stream"},
            {"filename": "c.txt", "content": "aGVs\nbG8=\n"},
            {"filename": "d.txt", "content": io.BytesIO(b"file-body"), "mimeType": "text/plain"},
            {"filename": "e.bin", "content": memoryview(bytes([7]) * 100_000)},
            attachment_from_file(p),
            {"content": io.BytesIO(b"x")} if False else Attachment(content=io.BytesIO(b"named")),
        ][:6],
    )  # fmt: skip
    a = m.calls[0].json["attachments"]
    assert a[0] == {"filename": "a.txt", "content": "aGVsbG8=", "mimeType": "text/plain"}
    assert a[1]["content"] == base64.b64encode(bytes([0, 255, 16])).decode() and a[1]["mimeType"] == "application/octet-stream"
    assert a[2] == {"filename": "c.txt", "content": "aGVsbG8="}
    assert a[3] == {"filename": "d.txt", "content": base64.b64encode(b"file-body").decode(), "mimeType": "text/plain"}
    assert a[4]["content"] == base64.b64encode(bytes([7]) * 100_000).decode()
    assert a[5] == {"filename": "report.csv", "content": base64.b64encode(b"a,b\n1,2\n").decode(), "mimeType": "text/csv"}


def test_file_object_name_is_used_when_filename_is_missing(flavor, tmp_path):
    p = tmp_path / "doc.txt"
    p.write_bytes(b"hi")
    m, c = client(flavor)
    with open(p, "rb") as fh:
        send(flavor, c, attachments=[{"content": fh}], **MSG)
    assert m.calls[0].json["attachments"][0]["filename"] == "doc.txt"


def test_maps_the_response_including_replays(flavor):
    m, c = client(
        flavor,
        lambda r, n: resp(
            {"success": True, "id": 9, "status": "sent", "idempotency_key": "k-1", "idempotent_replay": True, "message": "m", "targetProvider": "SES"},
            200, {"Idempotent-Replayed": "true"},
        ),
    )  # fmt: skip
    res = send(flavor, c, idempotency_key="k-1", **MSG)
    assert (res.id, res.status, res.idempotency_key, res.idempotent_replay, res.target_provider, res.message) == (9, "sent", "k-1", True, "SES", "m")


def test_replay_header_alone_marks_a_replay(flavor):
    m, c = client(flavor, lambda r, n: resp({"id": 2, "status": "queued"}, 200, {"idempotent-replayed": "true"}))
    assert send(flavor, c, **MSG).idempotent_replay is True


def test_generated_keys_are_uuid4_unique_and_signed(flavor):
    m, c = client(flavor)
    r1, r2 = send(flavor, c, **MSG), send(flavor, c, **MSG)
    k1 = m.calls[0].json["idempotency_key"]
    import re
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", k1)
    assert m.calls[1].json["idempotency_key"] != k1
    assert (r1.idempotency_key, r2.idempotency_key) == (k1, m.calls[1].json["idempotency_key"])


def test_caller_key_is_trimmed(flavor):
    m, c = client(flavor)
    send(flavor, c, idempotency_key=" order-123:receipt ", **MSG)
    assert m.calls[0].json["idempotency_key"] == "order-123:receipt"


def test_key_can_be_disabled_with_false(flavor):
    m, c = client(flavor)
    res = send(flavor, c, idempotency_key=False, **MSG)
    assert "idempotency_key" not in m.calls[0].json and res.idempotency_key is None


@pytest.mark.parametrize("key", ["", "  ", "has space", "tab\there", "ünï", "x" * 256, "a\nb", True, 5, ["k"], b"k"])
def test_invalid_idempotency_keys_are_rejected_before_any_request(flavor, key):
    m, c = client(flavor)
    err = flavor.raises(lambda: c.send(idempotency_key=key, **MSG))
    assert isinstance(err, UnsentValidationError) and err.code == "invalid_idempotency_key"
    assert m.calls == []


CASES = [
    ("missing to", {"subject": "s", "html": "h"}, r'"to" is required'),
    ("empty to array", {"to": [], "subject": "s", "html": "h"}, "at least one"),
    ("blank to", {"to": "  ", "subject": "s", "html": "h"}, "at least one"),
    ("non-string to entry", {"to": [1], "subject": "s", "html": "h"}, "string"),
    ("to dict", {"to": {"email": "a@b.co"}, "subject": "s", "html": "h"}, "string or an array"),
    ("address without @", {"to": "nope", "subject": "s", "html": "h"}, "invalid address"),
    ("CRLF in address", {"to": "a@b.co\r\nBcc: x@y.z", "subject": "s", "html": "h"}, "line break"),
    ("NUL in cc", {"to": "a@b.co", "cc": "a@b\0.co", "subject": "s", "html": "h"}, "line break"),
    ("101 recipients", {"to": [f"u{i}@x.co" for i in range(101)], "subject": "s", "html": "h"}, "maximum 100"),
    ("101 bcc", {"to": "a@b.co", "bcc": [f"u{i}@x.co" for i in range(101)], "subject": "s", "html": "h"}, "maximum 100"),
    ("missing subject", {"to": "a@b.co", "html": "h"}, '"subject" is required'),
    ("blank subject", {"to": "a@b.co", "subject": "   ", "html": "h"}, '"subject" is required'),
    ("numeric subject", {"to": "a@b.co", "subject": 5, "html": "h"}, '"subject" is required'),
    ("huge subject", {"to": "a@b.co", "subject": "x" * 1001, "html": "h"}, "maximum 1000"),
    ("no body", {"to": "a@b.co", "subject": "s"}, '"html", "text"'),
    ("blank bodies", {"to": "a@b.co", "subject": "s", "html": " ", "text": " "}, '"html", "text"'),
    ("non-string html", {"to": "a@b.co", "subject": "s", "html": 5}, '"html" must be a string'),
    ("non-string text", {"to": "a@b.co", "subject": "s", "html": "h", "text": b"x"}, '"text" must be a string'),
    ("attachments not array", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": {}}, "must be an array"),
    ("21 attachments", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": "QQ=="}] * 21}, "maximum 20"),
    ("attachment without filename", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"content": "QQ=="}]}, "filename is required"),
    ("attachment filename CRLF only", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "\r\n", "content": "QQ=="}]}, "filename is required"),
    ("attachment filename too long", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a" * 256, "content": "QQ=="}]}, "255"),
    ("attachment plain text content", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a.txt", "content": "hello world"}]}, "valid base64"),
    ("attachment bad padding", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": "QQ="}]}, "valid base64"),
    ("attachment excess padding", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": "Q==="}]}, "valid base64"),
    ("attachment whitespace only", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": "  \n"}]}, "valid base64"),
    ("attachment int content", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": 42}]}, "must be a base64 string"),
    ("attachment text file object", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": io.StringIO("x")}]}, "binary mode"),
    ("attachment empty bytes", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": b""}]}, "empty"),
    ("attachment not an object", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": ["x"]}, "must be an Attachment"),
    ("attachment bad mime", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": b"x", "content_type": 5}]}, "content_type"),
    ("attachment CRLF mime", {"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": b"x", "content_type": "a/b\r\nX: y"}]}, "line break"),
    ("empty from", {"to": "a@b.co", "subject": "s", "html": "h", "from_": ""}, '"from"'),
    ("from object without email", {"to": "a@b.co", "subject": "s", "html": "h", "from_": {"name": "x"}}, r"from\.email"),
    ("from with CRLF", {"to": "a@b.co", "subject": "s", "html": "h", "from_": "x@y.co\r\nBcc: z@y.co"}, "line break"),
    ("from name CRLF", {"to": "a@b.co", "subject": "s", "html": "h", "from_": {"email": "x@y.co", "name": "a\nb"}}, "line break"),
    ("from number", {"to": "a@b.co", "subject": "s", "html": "h", "from_": 5}, '"from"'),
    ("blank provider_id", {"to": "a@b.co", "subject": "s", "html": "h", "provider_id": " "}, "provider_id"),
    ("long provider_id", {"to": "a@b.co", "subject": "s", "html": "h", "provider_id": "p" * 256}, "provider_id"),
    ("bad timeout", {"to": "a@b.co", "subject": "s", "html": "h", "timeout": 0}, "timeout"),
    ("bad max_retries", {"to": "a@b.co", "subject": "s", "html": "h", "max_retries": 11}, "max_retries"),
    ("bad cancel", {"to": "a@b.co", "subject": "s", "html": "h", "cancel": object()}, "CancelToken"),
    ("lone surrogate", {"to": "a@b.co", "subject": "bad \ud800", "html": "h"}, "UTF-8"),
    ("no arguments", {}, '"to" is required'),
]


@pytest.mark.parametrize("name,kwargs,message", CASES, ids=[c[0] for c in CASES])
def test_client_side_validation_sends_nothing(flavor, name, kwargs, message):
    m, c = client(flavor)
    err = flavor.raises(lambda: c.send(**kwargs))
    assert isinstance(err, UnsentValidationError), err
    assert err.code == "validation_error"
    import re
    assert re.search(message, str(err)), str(err)
    assert m.calls == []


def test_body_over_3_mib_is_payload_too_large_without_a_request(flavor):
    m, c = client(flavor)
    err = flavor.raises(lambda: c.send(to="a@b.co", subject="s", html="x" * (3 * 1024 * 1024 + 1)))
    assert isinstance(err, UnsentValidationError) and err.code == "payload_too_large"
    assert m.calls == []
    send(flavor, c, to="a@b.co", subject="s", html="x" * (3 * 1024 * 1024 - 1000))
    assert len(m.calls) == 1


def test_non_ascii_body_size_is_measured_in_bytes(flavor):
    m, c = client(flavor)
    err = flavor.raises(lambda: c.send(to="a@b.co", subject="s", html="é" * (1_700_000)))
    assert err.code == "payload_too_large"


def test_subject_length_counts_utf16_units_like_the_server(flavor):
    m, c = client(flavor)
    err = flavor.raises(lambda: c.send(to="a@b.co", subject="🎉" * 501, html="h"))
    assert isinstance(err, UnsentValidationError) and "1002" in str(err)
    send(flavor, c, to="a@b.co", subject="🎉" * 500, html="h")


def test_wire_body_is_compact_json_with_only_present_fields(flavor):
    m, c = client(flavor)
    send(flavor, c, to="a@b.co", subject="s", html="h", idempotency_key="k")
    assert m.calls[0].body == '{"to":["a@b.co"],"subject":"s","html":"h","idempotency_key":"k"}'
    assert json.loads(m.calls[0].body) == m.calls[0].json


def test_per_call_timeout_is_passed_to_the_transport(flavor):
    m, c = client(flavor)
    send(flavor, c, timeout=7, **MSG)
    assert m.calls[0].timeout == 7
