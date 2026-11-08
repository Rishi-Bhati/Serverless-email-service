"""Thousands of seeded-random hostile inputs and hostile server responses. Only SDK errors may escape."""

import asyncio
import json
import random
import threading

import pytest

from fuzzlib import VALID_BODIES, Boom, EvilStr, json_junk, junk, mutate
from helpers import API_KEY, API_SECRET, BASE, AsyncMockTransport, MockTransport, accepted, raw, resp
from unsent import AsyncUnsent, CancelToken, Unsent, UnsentError, UnsentValidationError, attachment_from_file
from unsent.models import Attachment

SEED = 20260607
ITERATIONS = 2500

SEND_BASE = dict(to="a@b.co", subject="s", html="h")
SEND_PARAMS = ["to", "subject", "html", "text", "cc", "bcc", "from_", "attachments", "provider_id", "idempotency_key", "timeout", "max_retries", "cancel"]
# Exceptions that would mean an unguarded internal crash if they were the *cause* of a validation error.
CRASHES = (TypeError, AttributeError, KeyError, IndexError, ValueError, RecursionError, OverflowError, UnicodeError, ZeroDivisionError)


def run(is_async, value):
    if is_async:
        async def go():
            return await value
        return asyncio.run(go())
    return value


def collect(is_async, it):
    if is_async:
        async def go():
            return [x async for x in it]
        return asyncio.run(go())
    return list(it)


def ok_handler(rec, n):
    if rec.path == "/api/send":
        return accepted(n)
    if rec.path == "/api/emails":
        return resp({"emails": [], "total": 0, "limit": 100, "offset": 0})
    if rec.path == "/api/status":
        return resp({"queued": 0, "sending": 0, "sent": 0, "failed": 0})
    if rec.path == "/api/health":
        return resp({"status": "ok", "timestamp": 1780000000000})
    return resp({"email": {"id": 1, "status": "sent", "attempts": 1}})


def make(is_async, handler=ok_handler, **opts):
    m = AsyncMockTransport(handler) if is_async else MockTransport(handler)
    cls = AsyncUnsent if is_async else Unsent
    opts.setdefault("max_retries", 0)
    return m, cls(base_url=BASE, api_key=API_KEY, api_secret=API_SECRET, transport=m, **opts)


def assert_only_sdk_errors(fn, hostile):
    try:
        fn()
    except UnsentError as err:
        if not hostile:
            # plain junk must be caught by explicit validation, not by the generic safety net
            assert not isinstance(err.__cause__, CRASHES), (type(err.__cause__), str(err))
    except BaseException as exc:  # noqa: BLE001
        raise AssertionError(f"internal crash escaped: {type(exc).__name__}: {exc}") from exc


@pytest.mark.parametrize("is_async", [False, True], ids=["sync", "async"])
@pytest.mark.parametrize("hostile", [False, True], ids=["plain", "hostile"])
def test_send_with_junk_arguments(is_async, hostile):
    rng = random.Random(SEED + is_async * 7 + hostile * 13)
    _m, c = make(is_async)
    sent = 0
    for _ in range(ITERATIONS):
        kwargs = dict(SEND_BASE)
        for name in rng.sample(SEND_PARAMS, rng.randint(1, 3)):
            kwargs[name] = junk(rng, hostile)
        if "cancel" in kwargs and rng.random() < 0.7:
            kwargs["cancel"] = CancelToken() if rng.random() < 0.5 else kwargs["cancel"]
        try:
            run(is_async, c.send(**kwargs)) if is_async else c.send(**kwargs)
            sent += 1
        except UnsentError as err:
            if not hostile:
                assert not isinstance(err.__cause__, CRASHES), (kwargs.keys(), type(err.__cause__), str(err))
        except BaseException as exc:  # noqa: BLE001
            raise AssertionError(f"internal crash: {type(exc).__name__}: {exc} for {list(kwargs)}") from exc
    assert 0 < sent < ITERATIONS


@pytest.mark.parametrize("is_async", [False, True], ids=["sync", "async"])
def test_every_argument_position_with_every_junk_family(is_async):
    """Systematic sweep: each parameter x a fixed family of nasty values."""
    rng = random.Random(SEED)
    _m, c = make(is_async)
    values = [junk(rng, True) for _ in range(120)]
    for name in SEND_PARAMS:
        for v in values:
            assert_only_sdk_errors(lambda: run(is_async, c.send(**{**SEND_BASE, name: v})) if is_async else c.send(**{**SEND_BASE, name: v}), True)


@pytest.mark.parametrize("is_async", [False, True], ids=["sync", "async"])
def test_read_methods_with_junk_arguments(is_async):
    rng = random.Random(SEED + 1)
    _m, c = make(is_async)
    list_params = ["limit", "offset", "status", "search", "from_", "to", "sort", "timeout", "max_retries", "cancel"]
    for _ in range(ITERATIONS // 2):
        hostile = rng.random() < 0.5
        which = rng.choice(["get", "list", "iterate", "wait", "status", "health"])
        v = junk(rng, hostile)
        if which == "get":
            fn = lambda: run(is_async, c.emails.get(v)) if is_async else c.emails.get(v)
        elif which == "list":
            kw = {rng.choice(list_params): v}
            fn = lambda: run(is_async, c.emails.list(**kw)) if is_async else c.emails.list(**kw)
        elif which == "iterate":
            kw = {rng.choice([p for p in list_params if p != "offset"]): v}
            fn = lambda: collect(is_async, c.emails.iterate(**kw))
        elif which == "wait":
            kw = {rng.choice(["timeout", "interval", "cancel"]): v}
            fn = lambda: run(is_async, c.emails.wait(1, **kw)) if is_async else c.emails.wait(1, **kw)
        else:
            kw = {rng.choice(["timeout", "max_retries", "cancel"]): v}
            meth = getattr(c, which)
            fn = lambda: run(is_async, meth(**kw)) if is_async else meth(**kw)
        assert_only_sdk_errors(fn, hostile)


def test_constructor_and_from_env_with_junk():
    rng = random.Random(SEED + 2)
    names = ["base_url", "api_key", "api_secret", "default_from", "default_provider_id", "timeout", "max_retries", "transport"]
    built = 0
    for cls in (Unsent, AsyncUnsent):
        for _ in range(ITERATIONS):
            kw = {"base_url": BASE, "api_key": API_KEY}
            for n in rng.sample(names, rng.randint(1, 3)):
                kw[n] = junk(rng, True)
            try:
                cls(**kw)
                built += 1
            except UnsentError:
                pass
            except BaseException as exc:  # noqa: BLE001
                raise AssertionError(f"constructor crash: {type(exc).__name__}: {exc} for {[k for k in kw]}") from exc
    assert built > 0
    for _ in range(500):
        env = {rng.choice(["UNSENT_BASE_URL", "UNSENT_API_KEY", "UNSENT_API_SECRET", "x"]): junk(rng, True) for _ in range(3)}
        try:
            Unsent.from_env(env, **({rng.choice(names): junk(rng, True)} if rng.random() < 0.5 else {}))
        except UnsentError:
            pass


def test_attachment_helpers_with_junk():
    rng = random.Random(SEED + 3)
    for _ in range(300):
        try:
            attachment_from_file(junk(rng, True))
        except (UnsentError, OSError):
            pass  # documented: bad argument types are SDK errors, unreadable files are OSErrors
        try:
            Attachment(content=junk(rng, True), filename=junk(rng, True))
        except BaseException as exc:  # noqa: BLE001
            raise AssertionError("Attachment() must accept anything") from exc


def hostile_handler(rng):
    def handler(rec, n):
        roll = rng.random()
        status = rng.choice([200, 200, 200, 202, 201, 204, 100, 199, 299, 300, 301, 304, 307, 400, 401, 403, 404, 409, 413, 418, 429, 500, 502, 503, 599, 999, 0, -1])
        headers = {}
        for h, gen in (
            ("Retry-After", lambda: rng.choice(["0", "1", "99999999999999999999", "-1", "abc", "", "1e9", "Wed, 21 Oct 2099 07:28:00 GMT", "x" * 5000, "\x00"])),
            ("Date", lambda: rng.choice(["garbage", "Mon, 01 Jun 2099 12:00:00 GMT", "", "Thu, 01 Jan 1970 00:00:00 GMT", "x" * 300])),
            ("Location", lambda: rng.choice(["https://evil.test/", "", "x\r\ny", "http://[::1"])),
            ("Idempotent-Replayed", lambda: rng.choice(["true", "TRUE", "1", ""])),
        ):
            if rng.random() < 0.3:
                headers[h] = gen()
        if roll < 0.45:
            base = rng.choice(VALID_BODIES)
            body = json.dumps(mutate(rng, base)).encode()
            if b"Infinity" in body or b"NaN" in body:
                body = body.replace(b"Infinity", b"1").replace(b"NaN", b"1")
        elif roll < 0.6:
            body = json.dumps(json_junk(rng)).encode()
        elif roll < 0.75:
            body = bytes(rng.randrange(256) for _ in range(rng.randint(0, 300)))
        elif roll < 0.85:
            body = rng.choice([b"[" * 50000, b"{" * 50000, b'{"a":' * 10000, b"\xef\xbb\xbf{}", b"null", b"NaN", b'"str"', b"", b"{" + b'"a":1,' * 10000 + b'"b":2}', b'{"error":"' + b"e" * 1_000_000 + b'"}'])
        else:
            body = rng.choice([b'{"emails": null}', b'{"email": []}', b'{"id": 1}', b'{"queued": null}', b"<html>x</html>"])
        try:
            return raw(body, status, headers, reason=rng.choice(["", "OK", "x" * 300]))
        except Exception:  # an invalid status etc. is the mock's problem, not the SDK's
            return raw(body, 200, headers)

    return handler


@pytest.mark.parametrize("is_async", [False, True], ids=["sync", "async"])
def test_hostile_server_responses(is_async, fake_time):
    rng = random.Random(SEED + 4)
    _m, c = make(is_async, hostile_handler(rng), max_retries=2)
    outcomes = {"ok": 0, "err": 0}
    for i in range(ITERATIONS):
        which = i % 6
        if which == 0:
            fn = lambda: run(is_async, c.send(**SEND_BASE)) if is_async else c.send(**SEND_BASE)
        elif which == 1:
            fn = lambda: run(is_async, c.emails.get(1)) if is_async else c.emails.get(1)
        elif which == 2:
            fn = lambda: run(is_async, c.emails.list(limit=5)) if is_async else c.emails.list(limit=5)
        elif which == 3:
            fn = lambda: run(is_async, c.status()) if is_async else c.status()
        elif which == 4:
            fn = lambda: run(is_async, c.health()) if is_async else c.health()
        else:
            fn = lambda: collect(is_async, c.emails.iterate(limit=3))
        try:
            fn()
            outcomes["ok"] += 1
        except UnsentError:
            outcomes["err"] += 1
        except BaseException as exc:  # noqa: BLE001
            raise AssertionError(f"hostile response crashed the SDK ({type(exc).__name__}: {exc}) on call {which}") from exc
    assert outcomes["ok"] > 50 and outcomes["err"] > 50


def test_hostile_wait_never_hangs(fake_time):
    rng = random.Random(SEED + 5)
    _m, c = make(False, hostile_handler(rng), max_retries=1)
    for _ in range(300):
        try:
            c.emails.wait(1, timeout=20)
        except UnsentError:
            pass


def test_random_transport_exceptions_are_sdk_errors_or_propagate_as_bugs():
    rng = random.Random(SEED + 6)
    excs = [OSError("x"), ConnectionResetError(), TimeoutError(), BrokenPipeError(), EOFError(), UnsentValidationError("v"), UnsentError("u", code="c")]
    for _ in range(200):
        e = rng.choice(excs)

        def h(rec, n, e=e):
            raise e

        _m, c = make(False, h)
        with pytest.raises(UnsentError):
            c.status()


def test_threaded_use_with_junk_does_not_corrupt_state():
    rng = random.Random(SEED + 7)
    _m, c = make(False)
    errors = []

    def worker(seed):
        r = random.Random(seed)
        for _ in range(200):
            kw = dict(SEND_BASE)
            kw[r.choice(SEND_PARAMS)] = junk(r, False)
            try:
                c.send(**kw)
            except UnsentError:
                pass
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

    threads = [threading.Thread(target=worker, args=(rng.randrange(10**9),)) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == []


def test_unused_imports_stay_referenced():
    assert Boom and EvilStr
