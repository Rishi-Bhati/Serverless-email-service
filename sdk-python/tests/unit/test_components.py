import base64
import pickle
import threading

import pytest

from unsent import (
    CancelToken,
    UnsentAPIError,
    UnsentAuthenticationError,
    UnsentConfigError,
    UnsentConflictError,
    UnsentConnectionError,
    UnsentError,
    UnsentTimeoutError,
    UnsentValidationError,
    attachment_from_file,
)
from unsent._address import normalize_recipients, parse_address
from unsent._attachments import base64_size, to_wire_attachment
from unsent._core import backoff, parse_http_date, parse_retry_after
from unsent.errors import api_error_from_response


class TestParseAddress:
    @pytest.mark.parametrize(
        "given,expected",
        [
            ("a@b.co", {"email": "a@b.co"}),
            ("  a@b.co  ", {"email": "a@b.co"}),
            ("Name <a@b.co>", {"email": "a@b.co", "name": "Name"}),
            ('"Name" <a@b.co>', {"email": "a@b.co", "name": "Name"}),
            ('  "Doe, Jane"  <  j@x.co  >  ', {"email": "j@x.co", "name": "Doe, Jane"}),
            ("<a@b.co>", {"email": "a@b.co"}),
            ("Name <a@b.co", {"email": "Name <a@b.co"}),
            ('Na"me <a@b.co>', {"email": 'Na"me <a@b.co>'}),
            ("A <b> <c@d.co>", {"email": "A <b> <c@d.co>"}),
            ("Name <a b@c.co>", {"email": "Name <a b@c.co>"}),
            ("Name <>", {"email": "Name <>"}),
            ({"email": " a@b.co ", "name": " N "}, {"email": "a@b.co", "name": "N"}),
            ({"email": "a@b.co", "name": "  "}, {"email": "a@b.co"}),
            ({"email": "a@b.co", "name": None}, {"email": "a@b.co"}),
        ],
    )
    def test_cases(self, given, expected):
        assert parse_address(given, "from") == expected

    @pytest.mark.parametrize("bad", ["", "   ", 5, None, [], {"email": ""}, {"email": 5}, {"name": "x"}, {"email": "a@b.co", "name": 5}])
    def test_rejects(self, bad):
        with pytest.raises(UnsentValidationError):
            parse_address(bad, "from")


class TestNormalizeRecipients:
    def test_basic(self):
        assert normalize_recipients("a@b.co", "to", True) == ["a@b.co"]
        assert normalize_recipients(["a@b.co", " ", "c@d.co"], "to", True) == ["a@b.co", "c@d.co"]
        assert normalize_recipients(None, "cc", False) is None
        assert normalize_recipients([], "cc", False) is None
        assert normalize_recipients("  ", "cc", False) is None

    def test_exactly_100_is_allowed(self):
        assert len(normalize_recipients([f"u{i}@x.co" for i in range(100)], "to", True)) == 100

    def test_display_name_recipients_pass_through_unchanged(self):
        assert normalize_recipients("Jane <j@x.co>", "to", True) == ["Jane <j@x.co>"]

    def test_comma_separated_string_is_one_entry(self):
        # The SDK does not split on commas; pass a list.
        assert normalize_recipients("a@b.co,c@d.co", "to", True) == ["a@b.co,c@d.co"]


class TestAttachments:
    def test_size_helper(self):
        for n in range(0, 50):
            assert base64_size(base64.b64encode(bytes(n)).decode()) == n

    def test_base64_text_is_whitespace_tolerant(self):
        w = to_wire_attachment({"filename": "a", "content": " aGVs\r\n bG8= "}, 0)
        assert w["content"] == "aGVsbG8="

    def test_filename_control_chars_are_stripped(self):
        assert to_wire_attachment({"filename": "a\r\nb.txt\0", "content": b"x"}, 0)["filename"] == "ab.txt"

    def test_path_content_points_at_the_helper(self, tmp_path):
        with pytest.raises(UnsentValidationError, match="attachment_from_file"):
            to_wire_attachment({"filename": "a", "content": tmp_path}, 0)

    def test_attachment_from_file_guesses_type_and_name(self, tmp_path):
        p = tmp_path / "pic.png"
        p.write_bytes(b"\x89PNG")
        a = attachment_from_file(p)
        assert (a.filename, a.content_type, a.content) == ("pic.png", "image/png", b"\x89PNG")
        b = attachment_from_file(p, filename="x.bin", content_type="application/x-y")
        assert (b.filename, b.content_type) == ("x.bin", "application/x-y")

    def test_failing_file_object_is_a_validation_error(self):
        class Boom:
            def read(self):
                raise OSError("disk")

        with pytest.raises(UnsentValidationError, match="could not be read"):
            to_wire_attachment({"filename": "a", "content": Boom()}, 0)

    def test_camel_case_dict_keys_are_accepted(self):
        w = to_wire_attachment({"filename": "a", "content": b"x", "contentType": "text/plain"}, 0)
        assert w["mimeType"] == "text/plain"


class TestRetryAfterParsing:
    @pytest.mark.parametrize("h,expected", [("0", 0.0), ("7", 7.0), (" 7 ", 7.0), ("1.5", 1.5), ("120", 60.0), ("99999999999999999999", 60.0)])
    def test_seconds(self, h, expected):
        assert parse_retry_after(h) == expected

    @pytest.mark.parametrize("h", [None, "", "abc", "-1", "1e3", "0x10", "inf", "nan", "1_0", "9" * 21, "x" * 500, "7 seconds"])
    def test_invalid_values_are_ignored(self, h):
        assert parse_retry_after(h) is None

    def test_http_date_in_the_past_is_zero(self):
        assert parse_retry_after("Mon, 01 Jun 2020 12:00:00 GMT") == 0.0

    def test_date_header(self):
        assert parse_http_date("Mon, 01 Jun 2026 12:00:00 GMT") == 1780315200.0
        assert parse_http_date("garbage") is None and parse_http_date(None) is None
        assert parse_http_date("Mon, 99 Foo 2026 99:99:99 GMT") is None

    def test_backoff_bounds(self):
        for attempt in range(0, 20):
            exp = min(8.0, 0.5 * 2**attempt)
            for _ in range(50):
                assert exp / 2 <= backoff(attempt) <= exp


class TestErrors:
    def test_hierarchy(self):
        for cls in (UnsentConfigError, UnsentValidationError, UnsentConnectionError, UnsentTimeoutError, UnsentAPIError, UnsentAuthenticationError):
            assert issubclass(cls, UnsentError)
        assert issubclass(UnsentTimeoutError, UnsentConnectionError)

    def test_picklable_with_all_fields(self):
        err = api_error_from_response(409, {"error": "dup", "code": "idempotency_key_conflict", "id": 5}, has_api_secret=True, retry_after=2.0, server_time=9.0)
        copy = pickle.loads(pickle.dumps(err))
        assert type(copy) is UnsentConflictError
        assert (copy.status, copy.code, copy.existing_email_id, copy.retry_after, copy.server_time, str(copy), copy.body) == (409, "idempotency_key_conflict", 5, 2.0, 9.0, "dup", err.body)
        for e in (UnsentValidationError("x", "invalid_idempotency_key"), UnsentTimeoutError("t"), UnsentConfigError("c")):
            c = pickle.loads(pickle.dumps(e))
            assert (type(c), c.code, str(c)) == (type(e), e.code, str(e))

    def test_cause_is_chained(self):
        cause = OSError("boom")
        assert UnsentConnectionError("x", cause=cause).__cause__ is cause

    def test_message_is_clipped_for_hostile_servers(self):
        err = api_error_from_response(500, {"error": "e" * 100000, "reason": "r" * 100000}, has_api_secret=False)
        assert len(str(err)) < 3000

    def test_repr_has_code(self):
        assert "code='x'" in repr(UnsentError("m", code="x"))
        assert "status=404" in repr(api_error_from_response(404, None, has_api_secret=False))


class TestCancelToken:
    def test_basics(self):
        t = CancelToken()
        seen = []
        remove = t.add_callback(lambda: seen.append("a"))
        t.add_callback(lambda: seen.append("b"))
        removed = t.add_callback(lambda: seen.append("c"))
        removed()
        assert not t.is_cancelled and t.wait(0.01) is False
        t.cancel()
        t.cancel()
        assert t.is_cancelled and t.wait(0) is True and seen == ["a", "b"]
        t.add_callback(lambda: seen.append("late"))
        assert seen[-1] == "late"
        remove()

    def test_a_failing_callback_does_not_block_the_others(self):
        t = CancelToken()
        seen = []

        def boom():
            raise RuntimeError("x")

        t.add_callback(boom)
        t.add_callback(lambda: seen.append(1))
        t.cancel()
        assert seen == [1]

    def test_wakes_waiters_from_another_thread(self):
        t = CancelToken()
        threading.Timer(0.05, t.cancel).start()
        assert t.wait(5) is True
