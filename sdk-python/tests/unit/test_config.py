import copy
import pickle

import pytest

from helpers import API_KEY, API_SECRET, BASE, MockTransport, accepted
from unsent import AsyncUnsent, Unsent, UnsentConfigError

MSG = dict(to="a@b.co", subject="s", text="t")


def mk(**kw):
    m = MockTransport(lambda r, n: accepted())
    kw.setdefault("base_url", BASE)
    kw.setdefault("api_key", "k")
    kw.setdefault("transport", m)
    return m, Unsent(**kw)


def test_requires_base_url_and_api_key_with_actionable_messages():
    with pytest.raises(UnsentConfigError, match=r"base_url.*UNSENT_BASE_URL"):
        Unsent(api_key="k")
    with pytest.raises(UnsentConfigError, match=r"api_key.*UNSENT_API_KEY"):
        Unsent(base_url=BASE)
    with pytest.raises(UnsentConfigError):
        Unsent()


def test_reads_environment_and_trims_whitespace(monkeypatch):
    monkeypatch.setenv("UNSENT_BASE_URL", f"{BASE}/\n")
    monkeypatch.setenv("UNSENT_API_KEY", f" {API_KEY}\n")
    monkeypatch.setenv("UNSENT_API_SECRET", f"{API_SECRET}\n")
    m = MockTransport(lambda r, n: accepted())
    Unsent(transport=m).send(**MSG)
    assert m.calls[0].url == f"{BASE}/api/send"
    assert m.calls[0].header("X-API-Key") == API_KEY
    assert m.calls[0].has("X-Signature")


def test_empty_env_vars_count_as_unset(monkeypatch):
    monkeypatch.setenv("UNSENT_BASE_URL", "")
    monkeypatch.setenv("UNSENT_API_KEY", "   ")
    with pytest.raises(UnsentConfigError, match="base_url"):
        Unsent()


def test_explicit_options_win_over_environment(monkeypatch):
    monkeypatch.setenv("UNSENT_BASE_URL", "https://wrong.test")
    monkeypatch.setenv("UNSENT_API_KEY", "wrong")
    m, u = mk()
    u.send(**MSG)
    assert m.calls[0].url.startswith(BASE)
    assert m.calls[0].header("X-API-Key") == "k"


def test_from_env_with_mapping_and_overrides():
    m = MockTransport(lambda r, n: accepted())
    u = Unsent.from_env(
        {"UNSENT_BASE_URL": BASE, "UNSENT_API_KEY": API_KEY, "UNSENT_API_SECRET": API_SECRET}, transport=m, timeout=5
    )
    u.send(**MSG)
    assert m.calls[0].header("X-Signature").startswith("sha256=")
    assert len(m.calls[0].header("X-Signature")) == 7 + 64
    assert m.calls[0].timeout == 5


@pytest.mark.parametrize(
    "given,expected",
    [
        (f"{BASE}/mail/?x=1#y", f"{BASE}/mail/api/send"),
        (f"{BASE}///", f"{BASE}/api/send"),
        ("HTTPS://Unsent.TEST:443/", f"{BASE}/api/send"),
        ("https://unsent.test:8443/a//", "https://unsent.test:8443/a/api/send"),
        ("https://unsent.test/a/./b/../c", "https://unsent.test/a/c/api/send"),
        ("http://localhost:8787", "http://localhost:8787/api/send"),
        ("http://[::1]:8787/", "http://[::1]:8787/api/send"),
        ("http://a.localhost", "http://a.localhost/api/send"),
        ("  https://unsent.test  ", f"{BASE}/api/send"),
    ],
)
def test_base_url_normalization(given, expected):
    m, u = mk(base_url=given)
    u.send(**MSG)
    assert m.calls[0].url == expected


@pytest.mark.parametrize(
    "url,pattern",
    [
        ("not a url", "not a valid URL"),
        ("unsent.example.com", "not a valid URL"),
        ("https://", "not a valid URL"),
        ("https://exa mple.com", "not a valid URL"),
        ("https://example.com\r\nX: y", "not a valid URL"),
        ("https://exa\\mple.com", "not a valid URL"),
        ("https://example.com:notaport", "not a valid URL"),
        ("https://[::zz]/", "not a valid URL"),
        ("https://bad_host!.com", "not a valid URL"),
        ("ftp://x.test", "https://"),
        ("file:///etc/passwd", "https://"),
        ("javascript:alert(1)", "https://"),
        ("http://unsent.example.com", "plain http"),
        ("http://127.0.0.2", "plain http"),
        ("http://evil.localhost.example.com", "plain http"),
        ("https://user:pw@unsent.example.com", "credentials"),
        ("https://user@unsent.example.com", "credentials"),
        ("https://unsent.example.com@evil.test", "credentials"),
    ],
)
def test_rejects_unsafe_or_malformed_base_urls(url, pattern):
    with pytest.raises(UnsentConfigError, match=pattern):
        Unsent(base_url=url, api_key="k")


def test_allows_http_for_loopback_hosts():
    for host in ("localhost:8787", "127.0.0.1:8787", "[::1]:8787", "dev.localhost"):
        Unsent(base_url=f"http://{host}", api_key="k")


@pytest.mark.parametrize("bad", [0, -1, float("nan"), float("inf"), "5", True, [], 0.0])
def test_validates_timeout(bad):
    with pytest.raises(UnsentConfigError, match="timeout"):
        mk(timeout=bad)


@pytest.mark.parametrize("bad", [-1, 1.5, 11, True, "3", float("nan"), float("inf")])
def test_validates_max_retries(bad):
    with pytest.raises(UnsentConfigError, match="max_retries"):
        mk(max_retries=bad)


def test_accepts_boundary_and_integral_float_values():
    mk(max_retries=0)
    mk(max_retries=10)
    mk(max_retries=3.0)
    mk(timeout=0.001)


@pytest.mark.parametrize("bad", ["", "  ", "x@y\r\nBcc: z", 5, ["a@b.co"], {"name": "x"}])
def test_validates_default_from_at_construction(bad):
    with pytest.raises(UnsentConfigError):
        mk(default_from=bad)


@pytest.mark.parametrize("bad", ["", " ", 5, "x" * 256])
def test_validates_default_provider_id(bad):
    with pytest.raises(UnsentConfigError, match="default_provider_id"):
        mk(default_provider_id=bad)


def test_rejects_non_string_credentials_and_bad_transport():
    for kw in ({"api_key": 5}, {"base_url": 5}, {"api_secret": b"x"}, {"transport": object()}, {"transport": "http"}):
        with pytest.raises(UnsentConfigError):
            mk(**kw)


def test_sync_client_rejects_an_async_transport_but_async_client_accepts_it():
    class T:
        async def send(self, req):
            return accepted()

    with pytest.raises(UnsentConfigError, match="AsyncUnsent"):
        Unsent(base_url=BASE, api_key="k", transport=T())
    AsyncUnsent(base_url=BASE, api_key="k", transport=T())


def test_secrets_never_appear_in_repr_str_or_serialization():
    m, u = mk(api_key="SUPER-KEY", api_secret="SUPER-SECRET")
    dump = repr(u) + str(u) + repr(vars(u)) + repr(vars(u._runner)) + repr(vars(u._runner.state))
    dump += repr(u._runner.state._api_key) + repr(u._runner.state._api_secret)
    assert "SUPER-KEY" not in dump and "SUPER-SECRET" not in dump
    with pytest.raises(TypeError):
        pickle.dumps(u)
    with pytest.raises(TypeError):
        pickle.dumps(u._runner.state._api_key)
    assert "SUPER" not in repr(copy.deepcopy(u._runner.state._api_key))
    assert "SUPER" not in repr(AsyncUnsent(base_url=BASE, api_key="SUPER-KEY", api_secret="SUPER-SECRET"))


def test_default_from_and_provider_id_are_applied_with_per_call_overrides():
    m, u = mk(default_from="Default <d@x.co>", default_provider_id="prov-a")
    u.send(**MSG)
    u.send(**MSG, from_="o@x.co", provider_id="prov-b")
    assert m.calls[0].json["from"] == {"email": "d@x.co", "name": "Default"}
    assert m.calls[0].json["provider_id"] == "prov-a"
    assert m.calls[1].json["from"] == {"email": "o@x.co"}
    assert m.calls[1].json["provider_id"] == "prov-b"


def test_context_manager_and_close_are_harmless():
    m, u = mk()
    with u as c:
        assert c is u
        c.send(**MSG)
    u.close()
