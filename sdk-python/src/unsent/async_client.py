"""Asyncio client.

The stdlib transport is blocking, so each HTTP attempt runs in a worker thread (``asyncio.to_thread``).
Cancellation is real: cancelling the awaiting task (or ``asyncio.timeout``/``wait_for``) closes the
in-flight socket, so the worker thread returns promptly instead of lingering until the server answers.
``asyncio.CancelledError`` always propagates unchanged; a :class:`~unsent.CancelToken` gives the
``aborted`` error instead.
"""

from __future__ import annotations

import asyncio
import dataclasses
import inspect
from typing import Any, AsyncIterator, Mapping, Optional, Sequence, Union

from . import _core
from . import _resources as R
from ._config import resolve
from ._transport import StdlibTransport
from .cancel import CancelToken
from .client import Recipients, _Defaults
from .errors import UnsentError, UnsentTimeoutError
from .models import (
    Address,
    Attachment,
    Email,
    EmailDetail,
    Health,
    ListEmailsResult,
    QueueStatus,
    SendEmailResult,
    TransportResponse,
)

__all__ = ["AsyncUnsent", "AsyncEmails"]

#: Extra time the event loop waits beyond a transport's own timeout before giving up on it.
_HARD_TIMEOUT_GRACE = 1.0


def _ignore(_: Any) -> None:
    return None


async def _sleep(cancel: CancelToken, seconds: float) -> bool:
    """Sleep up to ``seconds``; returns True if the token was cancelled meanwhile. (Replaced by tests.)"""
    loop = asyncio.get_running_loop()
    event = asyncio.Event()
    remove = cancel.add_callback(lambda: _ignore(loop.call_soon_threadsafe(event.set)))
    try:
        try:
            await asyncio.wait_for(event.wait(), seconds)
        except asyncio.TimeoutError:
            pass
    finally:
        remove()
    return cancel.is_cancelled


class _AsyncRunner:
    def __init__(self, state: _core.ClientState, transport: Any) -> None:
        self.state = state
        self.transport = transport
        self._is_async = inspect.iscoroutinefunction(getattr(transport, "send", None))

    async def call(self, opts: _core.CallOptions, cancel: Optional[CancelToken] = None) -> _core.CallResult:
        child = CancelToken()
        unlink = cancel.add_callback(child.cancel) if cancel is not None else (lambda: None)
        gen = _core.call_plan(self.state, opts, child)
        try:
            step = next(gen)
            while True:
                try:
                    if isinstance(step, _core.Attempt):
                        value: Any = await self._perform(step.request, child)
                    else:
                        if await _sleep(child, step.seconds):
                            raise _core.abort_error("The request was aborted")
                        value = None
                except UnsentError as err:
                    step = gen.throw(err)
                    continue
                step = gen.send(value)
        except StopIteration as stop:
            result: _core.CallResult = stop.value
            return result
        except BaseException:  # includes asyncio.CancelledError: close the socket, then propagate
            child.cancel()
            raise
        finally:
            unlink()
            gen.close()

    async def _perform(self, request: Any, cancel: CancelToken) -> TransportResponse:
        loop = asyncio.get_running_loop()
        # A per-attempt token lets us kill one overrunning attempt (a timeout, which is retryable)
        # without marking the whole call as aborted.
        attempt_cancel = CancelToken()
        unlink = cancel.add_callback(attempt_cancel.cancel)
        try:
            return await self._attempt(dataclasses.replace(request, cancel=attempt_cancel), cancel, attempt_cancel, loop)
        finally:
            unlink()

    async def _attempt(self, request: Any, cancel: CancelToken, attempt_cancel: CancelToken, loop: Any) -> TransportResponse:
        if self._is_async:
            work: "asyncio.Future[Any]" = asyncio.ensure_future(self.transport.send(request))
        else:
            work = asyncio.ensure_future(asyncio.to_thread(self.transport.send, request))
        cancelled = asyncio.Event()
        remove = cancel.add_callback(lambda: _ignore(loop.call_soon_threadsafe(cancelled.set)))
        waiter = asyncio.ensure_future(cancelled.wait())
        try:
            done, _pending = await asyncio.wait(
                {work, waiter}, timeout=request.timeout + _HARD_TIMEOUT_GRACE, return_when=asyncio.FIRST_COMPLETED
            )
        except BaseException:  # the awaiting task itself was cancelled
            work.cancel()
            attempt_cancel.cancel()
            raise
        finally:
            remove()
            waiter.cancel()
        path = request.url.split("?")[0][len(self.state.base_url):]
        if work in done:
            try:
                resp = work.result()
            except BaseException as exc:
                mapped = _core.map_transport_error(exc, cancel=cancel, timeout=request.timeout, host=self.state.host, path=path)
                if mapped is None or mapped is exc:
                    raise
                raise mapped from exc
            if not isinstance(resp, TransportResponse):
                raise UnsentError("The transport did not return a TransportResponse", code="invalid_response")
            return resp
        # Either the caller cancelled or the transport overran its deadline; stop it either way.
        work.cancel()
        attempt_cancel.cancel()
        if waiter in done:
            raise _core.abort_error()
        raise UnsentTimeoutError(f"Request to {path} timed out after {request.timeout:g} s")


class AsyncEmails:
    """``client.emails`` for :class:`AsyncUnsent`."""

    def __init__(self, runner: _AsyncRunner, defaults: _Defaults) -> None:
        self._runner = runner
        self._defaults = defaults

    async def send(
        self,
        *,
        to: Optional[Recipients] = None,
        subject: Optional[str] = None,
        html: Optional[str] = None,
        text: Optional[str] = None,
        cc: Optional[Recipients] = None,
        bcc: Optional[Recipients] = None,
        from_: Optional[Address] = None,
        attachments: Optional[Sequence[Union[Attachment, Mapping[str, Any]]]] = None,
        provider_id: Optional[str] = None,
        idempotency_key: Union[str, bool, None] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        cancel: Optional[CancelToken] = None,
    ) -> SendEmailResult:
        """Queue an email for delivery. See :meth:`unsent.Emails.send`."""
        prepared = R.prepare_send(
            self._defaults, to=to, subject=subject, html=html, text=text, cc=cc, bcc=bcc, from_=from_,
            attachments=attachments, provider_id=provider_id, idempotency_key=idempotency_key,
            timeout=timeout, max_retries=max_retries, cancel=cancel,
        )  # fmt: skip
        res = await self._runner.call(
            _core.CallOptions(
                method="POST", path="/api/send", body=prepared.body, sign=True, retry_safe=prepared.retry_safe,
                timeout=timeout, max_retries=max_retries,
            ),  # fmt: skip
            cancel,
        )
        return R.map_send_result(res, prepared.idempotency_key)

    async def get(
        self, id: int, *, timeout: Optional[float] = None, max_retries: Optional[int] = None, cancel: Optional[CancelToken] = None
    ) -> EmailDetail:
        email_id = R.check_email_id(id)
        R.check_request_options(timeout, max_retries, cancel)
        res = await self._runner.call(
            _core.CallOptions(method="GET", path=f"/api/emails/{email_id}", retry_safe=True, timeout=timeout, max_retries=max_retries),
            cancel,
        )
        return R.map_get(res)

    async def list(
        self,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        from_: Any = None,
        to: Any = None,
        sort: Optional[str] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        cancel: Optional[CancelToken] = None,
    ) -> ListEmailsResult:
        query = R.prepare_list_query(limit=limit, offset=offset, status=status, search=search, from_=from_, to=to, sort=sort)
        R.check_request_options(timeout, max_retries, cancel)
        res = await self._runner.call(
            _core.CallOptions(method="GET", path="/api/emails", query=query, retry_safe=True, timeout=timeout, max_retries=max_retries),
            cancel,
        )
        return R.map_list(res)

    def iterate(
        self,
        *,
        limit: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        from_: Any = None,
        to: Any = None,
        sort: Optional[str] = "created_at_asc",
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        cancel: Optional[CancelToken] = None,
    ) -> AsyncIterator[Email]:
        """``async for email in client.emails.iterate(...)``; arguments are validated immediately."""
        R.prepare_list_query(limit=limit, offset=0, status=status, search=search, from_=from_, to=to, sort=sort)
        R.check_request_options(timeout, max_retries, cancel)
        return self._iterate(limit, status, search, from_, to, sort, timeout, max_retries, cancel)

    async def _iterate(self, limit: Any, status: Any, search: Any, from_: Any, to: Any, sort: Any, timeout: Any, max_retries: Any, cancel: Any) -> AsyncIterator[Email]:
        offset = 0
        while True:
            page = await self.list(
                limit=limit, offset=offset, status=status, search=search, from_=from_, to=to, sort=sort,
                timeout=timeout, max_retries=max_retries, cancel=cancel,
            )  # fmt: skip
            for email in page.emails:
                yield email
            if not page.has_more or not page.emails:
                return
            offset += len(page.emails)

    async def wait(
        self, id: int, *, timeout: float = 60.0, interval: float = 1.0, cancel: Optional[CancelToken] = None
    ) -> EmailDetail:
        """Poll until the email is ``sent`` (or permanently ``failed``). Raises ``UnsentTimeoutError`` at the deadline."""
        email_id = R.check_email_id(id)
        total, wait_for = R.check_wait_options(timeout, interval, cancel)
        deadline = _core.monotonic() + total
        while True:
            email = await self.get(email_id, cancel=cancel)
            if R.is_final(email):
                return email
            remaining = deadline - _core.monotonic()
            if remaining <= 0:
                raise UnsentTimeoutError(f'Email {email_id} was still "{email.status}" after {total:g} s')
            if await _sleep(cancel if cancel is not None else CancelToken(), min(wait_for, remaining)):
                raise _core.abort_error("The wait was aborted")
            wait_for = R.next_interval(wait_for)


class AsyncUnsent:
    """The asyncio Unsent client; same API as :class:`unsent.Unsent` with awaitable methods.

    >>> async with AsyncUnsent() as unsent:  # doctest: +SKIP
    ...     await unsent.send(to="user@example.com", subject="Hi", text="Hello")
    """

    emails: AsyncEmails

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        *,
        default_from: Optional[Address] = None,
        default_provider_id: Optional[str] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        transport: Any = None,
        _env: Optional[Mapping[str, Any]] = None,
    ) -> None:
        r = resolve(
            base_url=base_url, api_key=api_key, api_secret=api_secret, default_from=default_from,
            default_provider_id=default_provider_id, timeout=timeout, max_retries=max_retries,
            transport=transport, env=_env, allow_async_transport=True,
        )  # fmt: skip
        self._runner = _AsyncRunner(r.state, r.transport if r.transport is not None else StdlibTransport())
        self.emails = AsyncEmails(self._runner, _Defaults(r.default_from, r.default_provider_id))

    @classmethod
    def from_env(cls, env: Mapping[str, Any], **overrides: Any) -> "AsyncUnsent":
        opts = {k: v for k, v in overrides.items() if v is not None}
        return cls(_env=env, **opts)

    async def send(
        self,
        *,
        to: Optional[Recipients] = None,
        subject: Optional[str] = None,
        html: Optional[str] = None,
        text: Optional[str] = None,
        cc: Optional[Recipients] = None,
        bcc: Optional[Recipients] = None,
        from_: Optional[Address] = None,
        attachments: Optional[Sequence[Union[Attachment, Mapping[str, Any]]]] = None,
        provider_id: Optional[str] = None,
        idempotency_key: Union[str, bool, None] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        cancel: Optional[CancelToken] = None,
    ) -> SendEmailResult:
        """Shortcut for :meth:`AsyncEmails.send`."""
        return await self.emails.send(
            to=to, subject=subject, html=html, text=text, cc=cc, bcc=bcc, from_=from_, attachments=attachments,
            provider_id=provider_id, idempotency_key=idempotency_key, timeout=timeout, max_retries=max_retries,
            cancel=cancel,
        )  # fmt: skip

    async def status(self, *, timeout: Optional[float] = None, max_retries: Optional[int] = None, cancel: Optional[CancelToken] = None) -> QueueStatus:
        R.check_request_options(timeout, max_retries, cancel)
        res = await self._runner.call(
            _core.CallOptions(method="GET", path="/api/status", retry_safe=True, timeout=timeout, max_retries=max_retries), cancel
        )
        return R.map_status(res)

    async def health(self, *, timeout: Optional[float] = None, max_retries: Optional[int] = None, cancel: Optional[CancelToken] = None) -> Health:
        R.check_request_options(timeout, max_retries, cancel)
        res = await self._runner.call(
            _core.CallOptions(method="GET", path="/api/health", auth=False, retry_safe=True, timeout=timeout, max_retries=max_retries),
            cancel,
        )
        return R.map_health(res)

    async def aclose(self) -> None:
        """Release resources. The client holds none today (connections are per request); safe to call."""

    async def __aenter__(self) -> "AsyncUnsent":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    def __repr__(self) -> str:
        return f"AsyncUnsent(base_url={self._runner.state.base_url!r}, has_api_secret={self._runner.state.has_api_secret})"

    def __reduce__(self) -> Any:
        raise TypeError("AsyncUnsent clients cannot be pickled (they hold credentials); create one per process")
