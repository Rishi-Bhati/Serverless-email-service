"""Behavior that only exists for the asyncio client: native cancellation, concurrency, async transports."""

import asyncio
import threading
import time

import pytest

from helpers import API_KEY, API_SECRET, BASE, AsyncMockTransport, MockTransport, accepted, hang, resp, verify_signed
from unsent import AsyncUnsent, CancelToken, UnsentTimeoutError, UnsentConnectionError

MSG = dict(to="a@b.co", subject="s", html="h")


def mk(handler, **kw):
    m = MockTransport(handler)
    return m, AsyncUnsent(base_url=BASE, api_key=API_KEY, api_secret=API_SECRET, transport=m, **kw)


def test_task_cancellation_propagates_cancelled_error_and_closes_the_attempt():
    async def main():
        m, c = mk(hang)
        task = asyncio.create_task(c.send(**MSG))
        await asyncio.sleep(0.1)
        assert len(m.calls) == 1
        t0 = time.monotonic()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        # the worker thread was told to stop: its token is cancelled and it exits promptly
        assert m.calls[0].cancel.is_cancelled
        assert time.monotonic() - t0 < 1
        await asyncio.sleep(0.05)
        assert len(m.calls) == 1  # no retry after cancellation

    asyncio.run(main())


def test_asyncio_timeout_cancels_the_call():
    async def main():
        m, c = mk(hang)
        with pytest.raises((asyncio.TimeoutError, TimeoutError)):
            await asyncio.wait_for(c.send(**MSG), 0.1)
        assert m.calls[0].cancel.is_cancelled

    asyncio.run(main())


def test_cancellation_during_backoff_sleep():
    async def main():
        m, c = mk(lambda r, n: resp({"error": "x", "code": "internal_error"}, 500))
        task = asyncio.create_task(c.send(**MSG))
        await asyncio.sleep(0.1)  # first attempt done, now backing off for >= 250 ms
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(m.calls) == 1

    asyncio.run(main())


def test_wait_is_cancellable_by_task_cancel():
    async def main():
        m, c = mk(lambda r, n: resp({"email": {"id": 3, "status": "queued", "attempts": 0}}), max_retries=0)
        task = asyncio.create_task(c.emails.wait(3, interval=5))
        await asyncio.sleep(0.1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(main())


def test_hung_transport_that_ignores_timeouts_is_bounded_by_the_event_loop():
    release = threading.Event()

    def stubborn(rec, n):
        release.wait(5)  # ignores both timeout and cancellation
        raise OSError("late")

    async def main():
        m, c = mk(stubborn, timeout=0.2, max_retries=0)
        t0 = time.monotonic()
        with pytest.raises(UnsentTimeoutError):
            await c.send(**MSG)
        assert time.monotonic() - t0 < 3
        release.set()

    asyncio.run(main())


def test_token_cancel_wins_even_over_a_stubborn_transport():
    release = threading.Event()

    def stubborn(rec, n):
        release.wait(5)
        raise OSError("late")

    async def main():
        m, c = mk(stubborn, max_retries=0)
        token = CancelToken()
        asyncio.get_running_loop().call_later(0.1, token.cancel)
        t0 = time.monotonic()
        with pytest.raises(UnsentConnectionError) as ei:
            await c.send(**MSG, cancel=token)
        assert ei.value.code == "aborted" and time.monotonic() - t0 < 2
        release.set()

    asyncio.run(main())


def test_native_async_transport_is_awaited_directly_and_bounded():
    async def main():
        m = AsyncMockTransport(lambda r, n: accepted(3))
        c = AsyncUnsent(base_url=BASE, api_key=API_KEY, api_secret=API_SECRET, transport=m)
        assert (await c.send(**MSG)).id == 3

        class Hung:
            async def send(self, req):
                await asyncio.sleep(30)

        h = AsyncUnsent(base_url=BASE, api_key=API_KEY, transport=Hung(), timeout=0.1, max_retries=0)
        t0 = time.monotonic()
        with pytest.raises(UnsentTimeoutError):
            await h.send(**MSG)
        assert time.monotonic() - t0 < 3

    asyncio.run(main())


def test_many_concurrent_sends_are_independent_and_correctly_signed():
    used = set()
    lock = threading.Lock()

    def h(rec, n):
        with lock:
            assert verify_signed(rec, used_nonces=used) is True
        return accepted(n)

    async def main():
        m, c = mk(h)
        results = await asyncio.gather(*[c.send(to="a@b.co", subject=f"s{i}", text="x") for i in range(40)])
        assert sorted(r.id for r in results) == list(range(1, 41))
        assert len(used) == 40

    asyncio.run(main())


def test_async_context_manager_and_aclose():
    async def main():
        m, c = mk(lambda r, n: accepted())
        async with c as cc:
            await cc.send(**MSG)
        await c.aclose()

    asyncio.run(main())


def test_async_iterate_is_an_async_generator_over_pages():
    rows = [{"id": i, "status": "sent", "attempts": 1} for i in range(1, 6)]

    def h(rec, n):
        off, lim = int(rec.query.get("offset", 0)), int(rec.query.get("limit", 100))
        return resp({"emails": rows[off : off + lim], "total": 5, "limit": lim, "offset": off})

    async def main():
        m, c = mk(h)
        assert [e.id async for e in c.emails.iterate(limit=2)] == [1, 2, 3, 4, 5]

    asyncio.run(main())
