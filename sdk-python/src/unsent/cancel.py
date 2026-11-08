"""Cooperative cancellation for blocking and async calls."""

from __future__ import annotations

import threading
from typing import Callable, List, Optional

__all__ = ["CancelToken"]


class CancelToken:
    """A thread-safe cancellation flag.

    Pass one as ``cancel=`` to any client method, then call :meth:`cancel` from another thread
    (or a signal handler, or an asyncio callback) to abort the call immediately, including while it
    waits between retries. The call then raises :class:`~unsent.UnsentConnectionError` with
    ``code == "aborted"``. The in-flight socket is closed, so the abort does not wait for the server.

    >>> token = CancelToken()
    >>> token.is_cancelled
    False
    >>> token.cancel()
    >>> token.is_cancelled
    True
    """

    def __init__(self) -> None:
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._callbacks: List[Callable[[], None]] = []

    @property
    def is_cancelled(self) -> bool:
        return self._event.is_set()

    def cancel(self) -> None:
        """Cancel. Idempotent and safe to call from any thread."""
        with self._lock:
            if self._event.is_set():
                return
            self._event.set()
            callbacks, self._callbacks = self._callbacks, []
        for cb in callbacks:
            try:
                cb()
            except Exception:  # a broken callback must not stop the others
                pass

    def wait(self, timeout: Optional[float] = None) -> bool:
        """Block until cancelled or ``timeout`` seconds pass. Returns True if cancelled."""
        return self._event.wait(timeout)

    def add_callback(self, callback: Callable[[], None]) -> Callable[[], None]:
        """Run ``callback`` on cancellation (immediately if already cancelled).

        Returns a function that unregisters the callback.
        """
        with self._lock:
            if not self._event.is_set():
                self._callbacks.append(callback)

                def remove() -> None:
                    with self._lock:
                        try:
                            self._callbacks.remove(callback)
                        except ValueError:
                            pass

                return remove
        try:
            callback()
        except Exception:
            pass
        return lambda: None

    def __repr__(self) -> str:
        return f"CancelToken(cancelled={self.is_cancelled})"
