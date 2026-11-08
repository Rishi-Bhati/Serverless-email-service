import os
import secrets
from typing import Any

import pytest

from helpers import Flavor
from unsent import AsyncUnsent, Unsent

BASE_URL = os.environ.get("UNSENT_E2E_BASE_URL")
API_KEY = os.environ.get("UNSENT_E2E_API_KEY", "")
API_SECRET = os.environ.get("UNSENT_E2E_API_SECRET", "")
FROM = os.environ.get("UNSENT_E2E_FROM", "")
MODE = os.environ.get("UNSENT_E2E_MODE", "full")
MAILS_FILE = os.environ.get("UNSENT_E2E_MAILS_FILE")


def pytest_collection_modifyitems(config: Any, items: Any) -> None:
    if BASE_URL:
        return
    skip = pytest.mark.skip(reason="set UNSENT_E2E_BASE_URL (see scripts/e2e-server.sh) to run the live tests")
    for item in items:
        if "e2e" in str(item.fspath):
            item.add_marker(skip)


def uid() -> str:
    return secrets.token_hex(5)


@pytest.fixture(params=["sync", "async"])
def live(request: Any) -> Any:
    """(flavor, client) against the live worker."""
    flavor = Flavor(request.param)
    cls = AsyncUnsent if flavor.is_async else Unsent
    client = cls(base_url=BASE_URL or "http://localhost:1", api_key=API_KEY, api_secret=API_SECRET, default_from=FROM or None)
    return flavor, client


@pytest.fixture
def sync_client() -> Unsent:
    return Unsent(base_url=BASE_URL or "http://localhost:1", api_key=API_KEY, api_secret=API_SECRET, default_from=FROM or None)
