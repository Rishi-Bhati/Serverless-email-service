import datetime as dt
import threading
import time

import pytest

from helpers import accepted, api_error, raw, resp
from unsent import (
    MAX_DELIVERY_ATTEMPTS,
    CancelToken,
    UnsentConnectionError,
    UnsentError,
    UnsentNotFoundError,
    UnsentTimeoutError,
    UnsentValidationError,
)

UTC = dt.timezone.utc


def list_row(**over):
    row = {
        "id": 3, "to_json": '["a@b.co"]', "subject": "Hello", "body": "<p>Hi</p>", "html_body": "<p>Hi</p>",
        "text_body": "<p>Hi</p>", "from_email": "me@x.co", "from_name": "Me", "provider_id": None, "provider_used": "SES",
        "failover_history": '[{"provider":"SMTP","type":"smtp","error":"timeout","timestamp":1780000000000}]',
        "idempotency_key": "k-1", "status": "sent", "attempts": 1, "error": None, "error_message": None,
        "created_at": 1780000000000, "updated_at": 1780000005000, "to": ["a@b.co"], "cc": None, "bcc": None,
        "attachments": [{"filename": "a.pdf", "mimeType": "application/pdf", "size": 1234}], "attachment_count": 1,
    }  # fmt: skip
    row.update(over)
    return row


def setup(flavor, handler, **opts):
    opts.setdefault("max_retries", 0)
    opts.setdefault("api_secret", None)
    return flavor.make(handler, **opts)


class TestGet:
    def test_maps_the_detail_response(self, flavor):
        m, c = setup(
            flavor,
            lambda r, n: resp({"email": list_row(text_body="Hi", cc=["c@d.co"], attachments=[{"filename": "a.txt", "mimeType": "text/plain", "content": "aGVsbG8="}])}),
        )
        e = flavor.run(c.emails.get(3))
        assert m.calls[0].path == "/api/emails/3" and m.calls[0].header("X-API-Key") == "test-api-key"
        assert not m.calls[0].has("X-Signature")
        assert (e.id, e.status, e.to, e.cc, e.bcc, e.subject, e.html_body, e.text_body) == (3, "sent", ["a@b.co"], ["c@d.co"], None, "Hello", "<p>Hi</p>", "Hi")
        assert (e.from_email, e.from_name, e.provider_used, e.idempotency_key, e.attempts, e.error) == ("me@x.co", "Me", "SES", "k-1", 1, None)
        assert e.created_at == dt.datetime(2026, 5, 28, 20, 26, 40, tzinfo=UTC)
        assert e.updated_at - e.created_at == dt.timedelta(seconds=5)
        assert e.failover_history[0].provider == "SMTP" and e.failover_history[0].timestamp == e.created_at
        assert (e.attachments[0].filename, e.attachments[0].mime_type, e.attachments[0].size, e.attachments[0].content) == ("a.txt", "text/plain", 5, "aGVsbG8=")
        assert e.attachments[0].to_bytes() == b"hello"

    def test_text_body_is_none_when_the_api_only_echoed_html(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"email": list_row()}))
        assert flavor.run(c.emails.get(3)).text_body is None

    def test_404_raises_not_found(self, flavor):
        m, c = setup(flavor, lambda r, n: api_error(404, "not_found", "Email not found"))
        assert isinstance(flavor.raises(lambda: c.emails.get(999)), UnsentNotFoundError)

    @pytest.mark.parametrize("bad", [0, -1, 1.5, float("nan"), "3", None, True, 2**53, [3], b"3"])
    def test_rejects_invalid_ids_without_a_request(self, flavor, bad):
        m, c = setup(flavor, lambda r, n: resp({}))
        assert isinstance(flavor.raises(lambda: c.emails.get(bad)), UnsentValidationError)
        assert m.calls == []

    def test_tolerates_malformed_failover_history(self, flavor):
        for fh in ("{not json", "[1, null, {\"provider\": 5}]", 7, {"a": 1}):
            m, c = setup(flavor, lambda r, n, fh=fh: resp({"email": list_row(failover_history=fh)}))
            e = flavor.run(c.emails.get(3))
            assert isinstance(e.failover_history, list)

    def test_failover_history_may_already_be_an_array(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"email": list_row(failover_history=[{"provider": "A", "type": "t", "error": "e", "timestamp": 1000}])}))
        assert flavor.run(c.emails.get(3)).failover_history[0].timestamp == dt.datetime(1970, 1, 1, 0, 0, 1, tzinfo=UTC)

    @pytest.mark.parametrize("payload", [{}, {"email": None}, {"email": []}, {"email": {"status": "sent"}}, [], "x", 5])
    def test_malformed_detail_responses_raise_invalid_response(self, flavor, payload):
        m, c = setup(flavor, lambda r, n: resp(payload))
        err = flavor.raises(lambda: c.emails.get(3))
        assert type(err) is UnsentError and err.code == "invalid_response"

    def test_wrong_typed_fields_are_coerced_not_crashed(self, flavor):
        weird = list_row(to="x", cc="y", subject=5, status="bogus", attempts="two", created_at="never", updated_at=1e300, error=5, attachments=["x", {"filename": 5, "content": 7}])
        m, c = setup(flavor, lambda r, n: resp({"email": weird}))
        e = flavor.run(c.emails.get(3))
        assert e.status == "queued" and e.to == [] and e.cc is None and e.attempts == 0 and e.error is None
        assert e.created_at == dt.datetime(1970, 1, 1, tzinfo=UTC) and e.attachments[1].size == 0


class TestList:
    def test_builds_the_query_and_maps_the_page(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"emails": [list_row(), list_row(id=2)], "results": [], "total": 5, "limit": 2, "offset": 0}))
        page = flavor.run(c.emails.list(limit=2, status="failed", search="invoice & co", from_=dt.datetime(2026, 1, 5, 23, 0, tzinfo=UTC), to="2026-02-01", sort="created_at_asc"))
        assert m.calls[0].query == {"limit": "2", "status": "failed", "q": "invoice & co", "from": "2026-01-05", "to": "2026-02-01", "sort": "created_at_asc"}
        assert "invoice%20%26%20co" in m.calls[0].url
        assert [e.id for e in page.emails] == [3, 2]
        assert (page.total, page.limit, page.offset, page.has_more) == (5, 2, 0, True)
        assert page.emails[0].attachments[0].size == 1234 and page.emails[0].attachments[0].mime_type == "application/pdf"

    def test_omits_unset_params_and_reports_no_more_on_the_last_page(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"emails": [list_row()], "total": 1, "limit": 100, "offset": 0}))
        page = flavor.run(c.emails.list())
        assert m.calls[0].query == {} and "?" not in m.calls[0].url and page.has_more is False

    def test_dates_accept_date_objects_and_convert_aware_datetimes_to_utc(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"emails": [], "total": 0}))
        tz = dt.timezone(dt.timedelta(hours=5))
        flavor.run(c.emails.list(from_=dt.date(2026, 3, 4), to=dt.datetime(2026, 1, 1, 2, 0, tzinfo=tz)))
        assert (m.calls[0].query["from"], m.calls[0].query["to"]) == ("2026-03-04", "2025-12-31")
        flavor.run(c.emails.list(from_="2026-01-05T10:00:00Z"))
        assert m.calls[1].query["from"] == "2026-01-05"

    @pytest.mark.parametrize(
        "opts",
        [{"limit": 0}, {"limit": 201}, {"limit": 1.5}, {"limit": True}, {"limit": "5"}, {"offset": -1}, {"offset": 1.0}, {"from_": "yesterday"},
         {"from_": "2026-13-45"}, {"from_": 5}, {"to": dt.datetime.max.replace(tzinfo=UTC) if False else object()}, {"status": "bogus"}, {"status": 5},
         {"sort": "id_desc"}, {"sort": ["created_at_asc"]}, {"search": 5}, {"timeout": -1}, {"max_retries": 99}, {"cancel": 3}],
    )  # fmt: skip
    def test_rejects_invalid_arguments_without_a_request(self, flavor, opts):
        m, c = setup(flavor, lambda r, n: resp({}))
        assert isinstance(flavor.raises(lambda: c.emails.list(**opts)), UnsentValidationError)
        assert m.calls == []

    def test_iterate_walks_every_page_oldest_first_and_stops(self, flavor):
        allrows = [list_row(id=i + 1) for i in range(5)]

        def h(rec, n):
            off, lim = int(rec.query.get("offset", 0)), int(rec.query.get("limit", 100))
            return resp({"emails": allrows[off : off + lim], "total": 5, "limit": lim, "offset": off})

        m, c = setup(flavor, h)
        ids = [e.id for e in flavor.collect(c.emails.iterate(limit=2))]
        assert ids == [1, 2, 3, 4, 5]
        assert [r.query["offset"] for r in m.calls] == ["0", "2", "4"]
        assert m.calls[0].query["sort"] == "created_at_asc"

    def test_iterate_validates_eagerly_and_sort_can_be_overridden(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"emails": [], "total": 0}))
        with pytest.raises(UnsentValidationError):
            c.emails.iterate(limit=0)  # raises at call time, not at first next()
        assert flavor.collect(c.emails.iterate(sort="updated_at_desc")) == []
        assert m.calls[0].query["sort"] == "updated_at_desc"

    def test_iterate_ends_on_an_empty_page_even_if_total_is_over_reported(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"emails": [], "total": 10, "limit": 100, "offset": 0}))
        assert flavor.collect(c.emails.iterate()) == [] and len(m.calls) == 1

    @pytest.mark.parametrize("payload", [[], "x", {"emails": "nope"}, {"emails": [1]}, {"emails": [{"id": "abc"}]}])
    def test_malformed_list_responses_raise_invalid_response(self, flavor, payload):
        m, c = setup(flavor, lambda r, n: resp(payload))
        assert flavor.raises(lambda: c.emails.list()).code == "invalid_response"

    def test_hostile_totals_do_not_crash(self, flavor):
        m, c = setup(flavor, lambda r, n: raw(b'{"emails": [], "total": ' + b"9" * 400 + b', "limit": 1e999, "offset": -5}'))
        page = flavor.run(c.emails.list())
        assert page.emails == []


class TestWait:
    def test_polls_until_sent_with_growing_intervals(self, flavor, fake_time):
        seq = ["queued", "sending", "sent"]
        m, c = setup(flavor, lambda r, n: resp({"email": list_row(status=seq[n - 1])}))
        e = flavor.run(c.emails.wait(3))
        assert e.status == "sent" and len(m.calls) == 3
        assert fake_time.sleeps == [1.0, 1.5]

    def test_interval_grows_by_1_5x_up_to_5_seconds(self, flavor, fake_time):
        m, c = setup(flavor, lambda r, n: resp({"email": list_row(status="queued", attempts=0)}))
        err = flavor.raises(lambda: c.emails.wait(3, timeout=30))
        assert isinstance(err, UnsentTimeoutError)
        assert fake_time.sleeps[:7] == [1.0, 1.5, 2.25, 3.375, 5.0, 5.0, 5.0]
        assert sum(fake_time.sleeps) == pytest.approx(30)

    def test_failed_with_attempts_left_keeps_waiting_and_final_failure_returns(self, flavor, fake_time):
        seq = [{"status": "failed", "attempts": 1}, {"status": "failed", "attempts": 2}, {"status": "failed", "attempts": MAX_DELIVERY_ATTEMPTS}]
        m, c = setup(flavor, lambda r, n: resp({"email": list_row(**seq[n - 1], error="boom")}))
        e = flavor.run(c.emails.wait(3))
        assert (e.status, e.attempts, e.error) == ("failed", 3, "boom") and len(m.calls) == 3

    def test_times_out_with_timeout_error(self, flavor, fake_time):
        m, c = setup(flavor, lambda r, n: resp({"email": list_row(status="queued", attempts=0)}))
        err = flavor.raises(lambda: c.emails.wait(3, timeout=3))
        assert isinstance(err, UnsentTimeoutError) and err.code == "timeout"
        assert 'Email 3 was still "queued" after 3 s' in str(err)

    def test_can_be_aborted(self, flavor):
        token = CancelToken()
        m, c = setup(flavor, lambda r, n: resp({"email": list_row(status="queued", attempts=0)}))
        threading.Timer(0.05, token.cancel).start()
        t0 = time.monotonic()
        err = flavor.raises(lambda: c.emails.wait(3, cancel=token, interval=5))
        assert isinstance(err, UnsentConnectionError) and err.code == "aborted" and time.monotonic() - t0 < 2

    def test_propagates_lookup_errors(self, flavor):
        m, c = setup(flavor, lambda r, n: api_error(404, "not_found", "Email not found"))
        assert isinstance(flavor.raises(lambda: c.emails.wait(3)), UnsentNotFoundError)

    @pytest.mark.parametrize("opts", [{"timeout": 0}, {"timeout": -1}, {"timeout": float("nan")}, {"interval": 0}, {"interval": "1"}, {"cancel": 1}])
    def test_validates_options(self, flavor, opts):
        m, c = setup(flavor, lambda r, n: resp({}))
        assert isinstance(flavor.raises(lambda: c.emails.wait(3, **opts)), UnsentValidationError) and m.calls == []

    def test_interval_has_a_floor_of_100ms(self, flavor, fake_time):
        seq = ["queued", "sent"]
        m, c = setup(flavor, lambda r, n: resp({"email": list_row(status=seq[n - 1])}))
        flavor.run(c.emails.wait(3, interval=0.001))
        assert fake_time.sleeps == [0.1]


class TestStatusAndHealth:
    def test_status_returns_counters_with_defaults(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"queued": 1, "sending": 2, "sent": 3, "failed": 4}))
        s = flavor.run(c.status())
        assert (s.queued, s.sending, s.sent, s.failed) == (1, 2, 3, 4)
        assert m.calls[0].path == "/api/status" and m.calls[0].header("X-API-Key") == "test-api-key"
        m, c = setup(flavor, lambda r, n: resp({"queued": "x"}))
        assert flavor.run(c.status()).queued == 0

    def test_health_needs_no_credentials(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"status": "ok", "runtime": "cf_worker", "d1": "bound", "timestamp": 1780000000000}))
        h = flavor.run(c.health())
        assert (h.status, h.runtime, h.d1) == ("ok", "cf_worker", "bound")
        assert h.timestamp == dt.datetime(2026, 5, 28, 20, 26, 40, tzinfo=UTC)
        assert not m.calls[0].has("X-API-Key")

    def test_health_without_a_timestamp_uses_now(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"status": "ok"}))
        assert abs((flavor.run(c.health()).timestamp - dt.datetime.now(UTC)).total_seconds()) < 5

    def test_status_rejects_bad_credentials_with_a_hint(self, flavor):
        m, c = setup(flavor, lambda r, n: api_error(401, "invalid_api_key", "Unauthorized: Invalid credentials or expired session"))
        err = flavor.raises(lambda: c.status())
        assert err.status == 401 and err.code == "invalid_api_key" and "API_KEY" in err.hint

    @pytest.mark.parametrize("payload", [[], "x", None, 5])
    def test_non_object_responses_raise_invalid_response(self, flavor, payload):
        m, c = setup(flavor, lambda r, n: resp(payload))
        assert flavor.raises(lambda: c.status()).code == "invalid_response"
        assert flavor.raises(lambda: c.health()).code == "invalid_response"


def test_send_rejects_non_object_success_bodies(flavor):
    for payload in ([], "x", {"id": "abc"}, {"id": 0}, {"id": None}, {"id": 1e999}):
        m, c = setup(flavor, lambda r, n, payload=payload: resp(payload, 202))
        assert flavor.raises(lambda: c.send(to="a@b.co", subject="s", text="t")).code == "invalid_response"


def test_send_tolerates_odd_but_usable_bodies(flavor):
    m, c = setup(flavor, lambda r, n: resp({"id": "12", "status": 5, "message": None, "targetProvider": {"a": 1}}, 202))
    res = flavor.run(c.send(to="a@b.co", subject="s", text="t"))
    assert (res.id, res.status, res.message, res.target_provider) == (12, "queued", "", "")


def test_accepted_helper_shape():
    assert accepted().status == 202
