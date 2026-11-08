"""FastAPI helpers: a lifespan that owns one :class:`~unsent.AsyncUnsent`, and a dependency to inject it.

    from fastapi import FastAPI
    from unsent.fastapi import UnsentDep, lifespan

    app = FastAPI(lifespan=lifespan())          # reads UNSENT_BASE_URL / UNSENT_API_KEY / UNSENT_API_SECRET

    @app.post("/welcome")
    async def welcome(email: str, unsent: UnsentDep):
        result = await unsent.send(to=email, subject="Welcome", text="Hi!")
        return {"id": result.id}

Requires FastAPI (``pip install "unsent-sdk[fastapi]"``); the core SDK does not import this module.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated, Any, AsyncIterator, Callable, Optional

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from .async_client import AsyncUnsent
from .errors import UnsentAPIError, UnsentConfigError, UnsentError, UnsentTimeoutError, UnsentValidationError

__all__ = ["UnsentDep", "add_exception_handlers", "get_unsent", "lifespan", "unsent_lifespan"]

STATE_KEY = "unsent"


@asynccontextmanager
async def unsent_lifespan(app: FastAPI, client: Optional[AsyncUnsent] = None, **options: Any) -> AsyncIterator[AsyncUnsent]:
    """Create (or adopt) the client, store it on ``app.state.unsent`` and close it on shutdown.

    Use inside your own lifespan::

        @asynccontextmanager
        async def my_lifespan(app):
            async with unsent_lifespan(app):
                yield
    """
    owned = client is None
    active = client if client is not None else AsyncUnsent(**options)
    setattr(app.state, STATE_KEY, active)
    try:
        yield active
    finally:
        if getattr(app.state, STATE_KEY, None) is active:
            delattr(app.state, STATE_KEY)
        if owned:
            await active.aclose()


def lifespan(client: Optional[AsyncUnsent] = None, **options: Any) -> Callable[[FastAPI], Any]:
    """A ready-made lifespan: ``FastAPI(lifespan=lifespan())``. Options are :class:`AsyncUnsent`'s."""

    @asynccontextmanager
    async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with unsent_lifespan(app, client, **options):
            yield

    return _lifespan


async def get_unsent(request: Request) -> AsyncUnsent:
    """Dependency returning the app's client. Without a lifespan it builds one from the environment once."""
    client = getattr(request.app.state, STATE_KEY, None)
    if client is None:
        client = AsyncUnsent()  # raises UnsentConfigError (a 500 unless handled) if the environment is incomplete
        setattr(request.app.state, STATE_KEY, client)
    assert isinstance(client, AsyncUnsent)
    return client


#: ``async def endpoint(unsent: UnsentDep): ...``
UnsentDep = Annotated[AsyncUnsent, Depends(get_unsent)]


def _status_for(err: UnsentError) -> int:
    if isinstance(err, UnsentValidationError):
        return 422
    if isinstance(err, UnsentConfigError):
        return 500
    if isinstance(err, UnsentTimeoutError):
        return 504
    if isinstance(err, UnsentAPIError) and err.code == "idempotency_key_conflict":
        return 409
    return 502


def add_exception_handlers(app: FastAPI) -> None:
    """Map :class:`UnsentError` to JSON responses: 422 validation, 409 idempotency conflicts, 504 timeouts, 502 otherwise."""

    async def handler(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, UnsentError)
        return JSONResponse(status_code=_status_for(exc), content={"error": exc.code, "message": str(exc)})

    app.add_exception_handler(UnsentError, handler)
