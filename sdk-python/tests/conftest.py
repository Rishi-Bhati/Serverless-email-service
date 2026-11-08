from __future__ import annotations

from typing import Any, Iterator

import pytest

from unsent import _core, async_client, client
from helpers import Flavor, FakeTime


@pytest.fixture(params=["sync", "async"])
def flavor(request: Any) -> Flavor:
    return Flavor(request.param)


@pytest.fixture
def fake_time(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeTime]:
    ft = FakeTime()
    monkeypatch.setattr(_core, "now_ms", ft.now_ms)
    monkeypatch.setattr(_core, "monotonic", ft.monotonic)
    monkeypatch.setattr(client, "_sleep", ft.sleep)
    monkeypatch.setattr(async_client, "_sleep", ft.asleep)
    yield ft


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("UNSENT_BASE_URL", "UNSENT_API_KEY", "UNSENT_API_SECRET"):
        monkeypatch.delenv(name, raising=False)
