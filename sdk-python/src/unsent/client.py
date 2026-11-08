"""Synchronous client."""

from __future__ import annotations

import dataclasses
from typing import Any, Dict, Iterator, Mapping, Optional, Sequence, Union

from . import _core
from . import _resources as R
from ._config import resolve
from ._transport import StdlibTransport
from .cancel import CancelToken
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

__all__ = ["Unsent", "Emails"]

Recipients = Union[str, Sequence[str]]


@dataclasses.dataclass
class _Defaults:
    from_: Optional[Dict[str, str]]
    provider_id: Optional[str]


def _sleep(cancel: CancelToken, seconds: float) -> bool:
    """Sleep up to ``seconds``; returns True if cancelled meanwhile. (Replaced by tests.)"""
    return cancel.wait(seconds)


class _Runner:
    """Drives :func:`unsent._core.call_plan` with blocking I/O."""

    def __init__(self, state: _core.ClientState, transport: Any) -> None:
        self.state = state
        self.transport = transport

    def call(self, opts: _core.CallOptions, cancel: Optional[CancelToken] = None) -> _core.CallResult:
        child = CancelToken()
        unlink = cancel.add_callback(child.cancel) if cancel is not None else (lambda: None)
        gen = _core.call_plan(self.state, opts, child)
        try:
            step = next(gen)
            while True:
                try:
                    if isinstance(step, _core.Attempt):
                        value: Any = self._perform(step.request, child)
                    else:
                        if _sleep(child, step.seconds):
                            raise _core.abort_error("The request was aborted")
                        value = None
                except UnsentError as err:
                    step = gen.throw(err)
                    continue
                step = gen.send(value)
        except StopIteration as stop:
            result: _core.CallResult = stop.value
            return result
        except BaseException:
            child.cancel()
            raise
        finally:
            unlink()
            gen.close()

    def _perform(self, request: Any, cancel: CancelToken) -> TransportResponse:
        try:
            resp = self.transport.send(request)
        except BaseException as exc:
            mapped = _core.map_transport_error(
                exc, cancel=cancel, timeout=request.timeout, host=self.state.host, path=request.url.split("?")[0][len(self.state.base_url):]
            )
            if mapped is None:
                raise
            if mapped is exc:
                raise
            raise mapped from exc
        if not isinstance(resp, TransportResponse):
            raise UnsentError("The transport did not return a TransportResponse", code="invalid_response")
        return resp


class Emails:
    """``client.emails``: send and inspect emails."""

    def __init__(self, runner: _Runner, defaults: _Defaults) -> None:
        self._runner = runner
        self._defaults = defaults

    def send(
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
        """Queue an email for delivery.

        Returns as soon as the service has accepted the email (HTTP 202); delivery happens in the
        background. Use :meth:`wait` to block until it is actually sent.

        Retries on network errors, timeouts, 429 and 5xx are automatic and cannot cause duplicates:
        every send carries an idempotency key (yours, or a generated UUID).
        ``idempotency_key=False`` disables the key and, with it, all retries.
        """
        prepared = R.prepare_send(
            self._defaults, to=to, subject=subject, html=html, text=text, cc=cc, bcc=bcc, from_=from_,
            attachments=attachments, provider_id=provider_id, idempotency_key=idempotency_key,
            timeout=timeout, max_retries=max_retries, cancel=cancel,
        )  # fmt: skip
        res = self._runner.call(
            _core.CallOptions(
                method="POST", path="/api/send", body=prepared.body, sign=True, retry_safe=prepared.retry_safe,
                timeout=timeout, max_retries=max_retries,
            ),  # fmt: skip
            cancel,
        )
        return R.map_send_result(res, prepared.idempotency_key)

    def get(
        self, id: int, *, timeout: Optional[float] = None, max_retries: Optional[int] = None, cancel: Optional[CancelToken] = None
    ) -> EmailDetail:
        """Fetch one email, including attachment contents. Raises ``UnsentNotFoundError`` if it does not exist."""
        email_id = R.check_email_id(id)
        R.check_request_options(timeout, max_retries, cancel)
        res = self._runner.call(
            _core.CallOptions(method="GET", path=f"/api/emails/{email_id}", retry_safe=True, timeout=timeout, max_retries=max_retries),
            cancel,
        )
        return R.map_get(res)

    def list(
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
        """List emails, newest-updated first by default. Attachment contents are not included."""
        query = R.prepare_list_query(limit=limit, offset=offset, status=status, search=search, from_=from_, to=to, sort=sort)
        R.check_request_options(timeout, max_retries, cancel)
        res = self._runner.call(
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
    ) -> Iterator[Email]:
        """Iterate over every matching email, fetching pages as needed.

        Defaults to oldest-first so that emails sent while iterating do not shift pages.
        """
        R.prepare_list_query(limit=limit, offset=0, status=status, search=search, from_=from_, to=to, sort=sort)
        R.check_request_options(timeout, max_retries, cancel)
        return self._iterate(limit, status, search, from_, to, sort, timeout, max_retries, cancel)

    def _iterate(self, limit: Any, status: Any, search: Any, from_: Any, to: Any, sort: Any, timeout: Any, max_retries: Any, cancel: Any) -> Iterator[Email]:
        offset = 0
        while True:
            page = self.list(
                limit=limit, offset=offset, status=status, search=search, from_=from_, to=to, sort=sort,
                timeout=timeout, max_retries=max_retries, cancel=cancel,
            )  # fmt: skip
            yield from page.emails
            if not page.has_more or not page.emails:
                return
            offset += len(page.emails)

    def wait(
        self, id: int, *, timeout: float = 60.0, interval: float = 1.0, cancel: Optional[CancelToken] = None
    ) -> EmailDetail:
        """Poll until the email is delivered (``sent``) or has permanently failed, then return it.

        Check ``email.status``; a permanent failure does not raise. Raises ``UnsentTimeoutError``
        if it is still in flight after ``timeout`` seconds (default 60).
        """
        email_id = R.check_email_id(id)
        total, wait_for = R.check_wait_options(timeout, interval, cancel)
        deadline = _core.monotonic() + total
        while True:
            email = self.get(email_id, cancel=cancel)
            if R.is_final(email):
                return email
            remaining = deadline - _core.monotonic()
            if remaining <= 0:
                raise UnsentTimeoutError(f'Email {email_id} was still "{email.status}" after {total:g} s')
            if _sleep(cancel if cancel is not None else CancelToken(), min(wait_for, remaining)):
                raise _core.abort_error("The wait was aborted")
            wait_for = R.next_interval(wait_for)


class Unsent:
    """The Unsent client.

    >>> unsent = Unsent(base_url="https://unsent.example.com", api_key="...", api_secret="...")  # doctest: +SKIP
    >>> unsent.send(to="user@example.com", subject="Hi", html="<p>Hello</p>")  # doctest: +SKIP

    With no arguments it reads ``UNSENT_BASE_URL``, ``UNSENT_API_KEY`` and ``UNSENT_API_SECRET``
    from the environment. Instances are thread-safe and cheap; create one and share it.
    """

    emails: Emails

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
            transport=transport, env=_env,
        )  # fmt: skip
        self._runner = _Runner(r.state, r.transport if r.transport is not None else StdlibTransport())
        self.emails = Emails(self._runner, _Defaults(r.default_from, r.default_provider_id))

    @classmethod
    def from_env(cls, env: Mapping[str, Any], **overrides: Any) -> "Unsent":
        """Build a client from an environment-like mapping (``UNSENT_BASE_URL``, ``UNSENT_API_KEY``, ``UNSENT_API_SECRET``)."""
        opts = {k: v for k, v in overrides.items() if v is not None}
        return cls(_env=env, **opts)

    def send(
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
        """Shortcut for :meth:`Emails.send`."""
        return self.emails.send(
            to=to, subject=subject, html=html, text=text, cc=cc, bcc=bcc, from_=from_, attachments=attachments,
            provider_id=provider_id, idempotency_key=idempotency_key, timeout=timeout, max_retries=max_retries,
            cancel=cancel,
        )  # fmt: skip

    def status(self, *, timeout: Optional[float] = None, max_retries: Optional[int] = None, cancel: Optional[CancelToken] = None) -> QueueStatus:
        """Queue counters. Also a cheap way to verify your credentials are accepted."""
        R.check_request_options(timeout, max_retries, cancel)
        res = self._runner.call(
            _core.CallOptions(method="GET", path="/api/status", retry_safe=True, timeout=timeout, max_retries=max_retries), cancel
        )
        return R.map_status(res)

    def health(self, *, timeout: Optional[float] = None, max_retries: Optional[int] = None, cancel: Optional[CancelToken] = None) -> Health:
        """Public liveness probe. Needs no credentials, so it does not verify them; use :meth:`status` for that."""
        R.check_request_options(timeout, max_retries, cancel)
        res = self._runner.call(
            _core.CallOptions(method="GET", path="/api/health", auth=False, retry_safe=True, timeout=timeout, max_retries=max_retries),
            cancel,
        )
        return R.map_health(res)

    def close(self) -> None:
        """Release resources. The client holds none today (connections are per request); safe to call."""

    def __enter__(self) -> "Unsent":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def __repr__(self) -> str:
        return f"Unsent(base_url={self._runner.state.base_url!r}, has_api_secret={self._runner.state.has_api_secret})"

    def __reduce__(self) -> Any:
        raise TypeError("Unsent clients cannot be pickled (they hold credentials); create one per process")


