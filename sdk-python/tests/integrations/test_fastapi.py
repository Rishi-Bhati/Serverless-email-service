import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from contextlib import asynccontextmanager  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from helpers import API_KEY, API_SECRET, BASE, AsyncMockTransport, accepted, api_error, hang  # noqa: E402
from unsent import AsyncUnsent  # noqa: E402
from unsent.fastapi import UnsentDep, add_exception_handlers, get_unsent, lifespan, unsent_lifespan  # noqa: E402


def make_client(handler=None, **kw):
    m = AsyncMockTransport(handler or (lambda r, n: accepted(n)))
    return m, AsyncUnsent(base_url=BASE, api_key=API_KEY, api_secret=API_SECRET, transport=m, max_retries=0, **kw)


def build_app(client, with_handlers=True):
    app = FastAPI(lifespan=lifespan(client))

    @app.post("/welcome")
    async def welcome(email: str, unsent: UnsentDep):
        result = await unsent.send(to=email, subject="Welcome", text="Hi!")
        return {"id": result.id, "replay": result.idempotent_replay}

    @app.get("/status")
    async def status(unsent: UnsentDep):
        s = await unsent.status()
        return {"queued": s.queued}

    if with_handlers:
        add_exception_handlers(app)
    return app


def test_lifespan_and_dependency_inject_the_shared_client():
    m, client = make_client()
    with TestClient(build_app(client)) as http:
        r = http.post("/welcome", params={"email": "a@b.co"})
        assert r.status_code == 200 and r.json() == {"id": 1, "replay": False}
        r = http.post("/welcome", params={"email": "c@d.co"})
        assert r.json()["id"] == 2
    assert [c.json["to"] for c in m.calls] == [["a@b.co"], ["c@d.co"]]
    assert m.calls[0].header("X-Signature")


def test_concurrent_requests():
    m, client = make_client()
    with TestClient(build_app(client)) as http:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(8) as pool:
            ids = list(pool.map(lambda i: http.post("/welcome", params={"email": f"u{i}@b.co"}).json()["id"], range(24)))
    assert sorted(ids) == list(range(1, 25))


def test_exception_handlers_map_sdk_errors():
    cases = [
        (lambda r, n: api_error(400, "unauthorized_sender", "Unauthorized Sender/Provider"), 502, "unauthorized_sender"),
        (lambda r, n: api_error(409, "idempotency_key_conflict", "dup"), 409, "idempotency_key_conflict"),
        (lambda r, n: api_error(500, "internal_error", "boom"), 502, "internal_error"),
    ]
    for handler, status, code in cases:
        m, client = make_client(handler)
        with TestClient(build_app(client)) as http:
            r = http.post("/welcome", params={"email": "a@b.co"})
            assert r.status_code == status and r.json()["error"] == code
    m, client = make_client()
    with TestClient(build_app(client)) as http:
        r = http.post("/welcome", params={"email": "not-an-address"})
        assert r.status_code == 422 and r.json()["error"] == "validation_error"
    m, client = make_client(hang, timeout=0.1)
    with TestClient(build_app(client)) as http:
        r = http.get("/status")
        assert r.status_code == 504 and r.json()["error"] == "timeout"


def test_without_handlers_errors_propagate_as_server_errors():
    m, client = make_client(lambda r, n: api_error(500, "internal_error", "boom"))
    with TestClient(build_app(client, with_handlers=False), raise_server_exceptions=False) as http:
        assert http.get("/status").status_code == 500


def test_custom_lifespan_composition_and_cleanup():
    m, client = make_client()
    closed = []

    @asynccontextmanager
    async def my_lifespan(app):
        async with unsent_lifespan(app, client):
            yield
        closed.append(True)

    app = FastAPI(lifespan=my_lifespan)

    @app.get("/x")
    async def x(unsent: UnsentDep):
        return {"same": unsent is client}

    with TestClient(app) as http:
        assert http.get("/x").json() == {"same": True}
        assert app.state.unsent is client
    assert closed == [True] and not hasattr(app.state, "unsent")


def test_lifespan_builds_a_client_from_options_and_the_environment(monkeypatch):
    monkeypatch.setenv("UNSENT_BASE_URL", BASE)
    monkeypatch.setenv("UNSENT_API_KEY", API_KEY)
    app = FastAPI(lifespan=lifespan(max_retries=1))

    @app.get("/x")
    async def x(unsent: UnsentDep):
        return {"retries": unsent._runner.state.max_retries}

    with TestClient(app) as http:
        assert http.get("/x").json() == {"retries": 1}


def test_dependency_lazily_creates_a_client_without_lifespan(monkeypatch):
    monkeypatch.setenv("UNSENT_BASE_URL", BASE)
    monkeypatch.setenv("UNSENT_API_KEY", API_KEY)
    app = FastAPI()

    @app.get("/x")
    async def x(unsent: UnsentDep):
        return {"ok": isinstance(unsent, AsyncUnsent)}

    with TestClient(app) as http:
        assert http.get("/x").json() == {"ok": True}
        assert isinstance(app.state.unsent, AsyncUnsent)


def test_dependency_overrides_work_for_tests():
    m, fake = make_client()
    app = build_app(fake)
    other_m, other = make_client(lambda r, n: accepted(900))
    app.dependency_overrides[get_unsent] = lambda: other
    with TestClient(app) as http:
        assert http.post("/welcome", params={"email": "a@b.co"}).json()["id"] == 900
    assert m.calls == [] and len(other_m.calls) == 1


def test_event_loop_is_not_blocked_by_a_slow_send():
    async def main():
        m, client = make_client(lambda r, n: (__import__("time").sleep(0.3), accepted(n))[1])
        ticks = 0

        async def ticker():
            nonlocal ticks
            for _ in range(20):
                await asyncio.sleep(0.01)
                ticks += 1

        await asyncio.gather(client.send(to="a@b.co", subject="s", text="t"), ticker())
        assert ticks == 20

    asyncio.run(main())
