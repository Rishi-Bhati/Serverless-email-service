"""Seeded generators of hostile values and hostile server responses."""

from __future__ import annotations

import datetime
import decimal
import random
import string
from collections.abc import Mapping
from typing import Any, Callable, Dict, List


class Boom:
    """An object whose every protocol method raises."""

    def _b(self, *a: Any, **k: Any) -> Any:
        raise RuntimeError("boom")

    __str__ = __repr__ = __len__ = __iter__ = __bool__ = __hash__ = __getitem__ = __contains__ = _b
    __eq__ = __lt__ = __gt__ = __int__ = __float__ = __index__ = __fspath__ = __bytes__ = _b

    def __getattr__(self, name: str) -> Any:
        raise RuntimeError("boom " + name)


class EvilStr(str):
    def _b(self, *a: Any, **k: Any) -> Any:
        raise RuntimeError("evil")

    strip = split = replace = encode = lower = startswith = endswith = __len__ = __iter__ = __getitem__ = _b
    __contains__ = __str__ = __repr__ = __hash__ = __eq__ = _b


class EvilInt(int):
    def _b(self, *a: Any, **k: Any) -> Any:
        raise RuntimeError("evil")

    __lt__ = __gt__ = __le__ = __ge__ = __eq__ = __index__ = __int__ = __hash__ = __repr__ = _b


class EvilMapping(Mapping):  # type: ignore[type-arg]
    def __getitem__(self, k: Any) -> Any:
        raise RuntimeError("evil")

    def __iter__(self) -> Any:
        raise RuntimeError("evil")

    def __len__(self) -> int:
        raise RuntimeError("evil")

    def get(self, *a: Any, **k: Any) -> Any:
        raise RuntimeError("evil")


class EvilList(list):  # type: ignore[type-arg]
    def __iter__(self) -> Any:
        raise RuntimeError("evil")

    def __len__(self) -> int:
        raise RuntimeError("evil")


def _cycle_list() -> List[Any]:
    a: List[Any] = []
    a.append(a)
    return a


def _cycle_dict() -> Dict[str, Any]:
    d: Dict[str, Any] = {}
    d["email"] = d
    d["filename"] = d
    d["content"] = d
    return d


def _deep(n: int) -> Any:
    x: Any = "x@y.co"
    for _ in range(n):
        x = [x]
    return x


STRINGS = [
    "", " ", "\t\n", "a", "a@b.co", "A <a@b.co>", '"A" <a@b.co>', "a@b.co\r\nBcc: evil@x.co", "a@b.co\nX: y", "a\0@b.co", "\r\n",
    "ünï@cödé.co", "🎉" * 50, "\ud800", "\udfff@x.co", "a@\ud800.co", "<", ">", "<>", "<<<>>>", '"""', "\\", "%s%n%x", "{}{0}{x}",
    "../../etc/passwd", "null", "None", "NaN", "Infinity", "-0", "1e999", "0x10", "true", "[]", "{}", "'; DROP TABLE emails;--",
    "<script>alert(1)</script>", "__proto__", "constructor", "‮", "\u0085", " ", "﻿", "\x1f", "\x7f", "a" * 300,
    "=" * 10, "QQ==", "QQ=", "====", "A" * 1000 + "=", "ab cd", "x" * 1000, " " * 5000,
]


def junk(rng: random.Random, hostile: bool = True, depth: int = 0) -> Any:
    """A random value of a random (usually wrong) type."""
    kinds: List[Callable[[], Any]] = [
        lambda: None, lambda: True, lambda: False, lambda: 0, lambda: -1, lambda: 1, lambda: 2**64, lambda: -(2**70),
        lambda: rng.randint(-1000, 1000), lambda: rng.random() * rng.choice([1, 1e6, 1e300]), lambda: float("nan"), lambda: float("inf"),
        lambda: -float("inf"), lambda: complex(1, 2), lambda: b"", lambda: b"abc", lambda: bytes(rng.randrange(256) for _ in range(rng.randint(0, 40))),
        lambda: bytearray(b"xyz"), lambda: memoryview(b"mem"), lambda: decimal.Decimal("1.5"), lambda: datetime.datetime(2026, 1, 1),
        lambda: datetime.date(2026, 1, 1), lambda: datetime.timedelta(1), lambda: object(), lambda: Ellipsis, lambda: NotImplemented,
        lambda: len, lambda: (lambda: 1), lambda: type, lambda: ValueError("x"), lambda: iter([1, 2]), lambda: (x for x in "ab"),
        lambda: {1, 2}, lambda: frozenset(["a@b.co"]), lambda: range(3),
        lambda: rng.choice(STRINGS), lambda: rng.choice(STRINGS), lambda: rng.choice(STRINGS),
        lambda: "".join(rng.choice(string.printable + "ünï🎉\r\n\0\ud800") for _ in range(rng.randint(0, 200))),
        lambda: "".join(chr(rng.randrange(0, 0x3000)) for _ in range(rng.randint(0, 100))),
        lambda: rng.choice(["x", "ab@c.d", " "]) * rng.choice([1, 10, 1000, 100_000]),
        lambda: "x" * rng.choice([255, 256, 1000, 1001, 5000]),
        lambda: "a@b.co" * rng.choice([1, 100]),
        lambda: _deep(rng.choice([2, 50, 20000])),
    ]
    if depth < 3:
        kinds += [
            lambda: [junk(rng, hostile, depth + 1) for _ in range(rng.randint(0, 5))],
            lambda: tuple(junk(rng, hostile, depth + 1) for _ in range(rng.randint(0, 5))),
            lambda: {rng.choice(["email", "name", "filename", "content", "content_type", "mimeType", "x", 1, None, "__proto__"]): junk(rng, hostile, depth + 1) for _ in range(rng.randint(0, 5))},
            lambda: [rng.choice(["a@b.co", "c@d.co"]) for _ in range(rng.choice([1, 99, 100, 101, 150]))],
            lambda: [{"filename": rng.choice(["a.txt", "", 5, None]), "content": junk(rng, hostile, depth + 1)} for _ in range(rng.choice([1, 2, 20, 21]))],
        ]
    if hostile:
        kinds += [Boom, EvilMapping, lambda: EvilStr("a@b.co"), lambda: EvilInt(5), lambda: EvilList(["a@b.co"]), _cycle_list, _cycle_dict,
                  lambda: [Boom()], lambda: {"email": Boom()}, lambda: {"filename": "a", "content": Boom()}, lambda: [EvilStr("x@y.co")]]  # fmt: skip
    return rng.choice(kinds)()


# --- hostile server responses --------------------------------------------------------------

VALID_ROW: Dict[str, Any] = {
    "id": 3, "subject": "Hello", "body": "<p>Hi</p>", "html_body": "<p>Hi</p>", "text_body": "Hi", "from_email": "me@x.co", "from_name": "Me",
    "provider_id": None, "provider_used": "SES", "failover_history": '[{"provider":"SMTP","type":"smtp","error":"t","timestamp":1780000000000}]',
    "idempotency_key": "k-1", "status": "sent", "attempts": 1, "error": None, "created_at": 1780000000000, "updated_at": 1780000005000,
    "to": ["a@b.co"], "cc": ["c@d.co"], "bcc": None, "attachments": [{"filename": "a.pdf", "mimeType": "application/pdf", "size": 12, "content": "aGVsbG8="}],
}  # fmt: skip

VALID_BODIES: List[Any] = [
    {"success": True, "id": 1, "status": "queued", "idempotency_key": "k", "idempotent_replay": False, "message": "m", "targetProvider": "p"},
    {"email": VALID_ROW},
    {"emails": [VALID_ROW, dict(VALID_ROW, id=4)], "total": 5, "limit": 2, "offset": 0},
    {"queued": 1, "sending": 2, "sent": 3, "failed": 4},
    {"status": "ok", "runtime": "cf_worker", "d1": "bound", "timestamp": 1780000000000},
    {"error": "Unauthorized", "code": "invalid_signature", "reason": "bad", "id": 7},
]


def json_junk(rng: random.Random, depth: int = 0) -> Any:
    kinds: List[Callable[[], Any]] = [
        lambda: None, lambda: True, lambda: rng.randint(-5, 10**30), lambda: rng.random() * 1e308, lambda: 1e999, lambda: -1e999,
        lambda: rng.choice(STRINGS), lambda: "x" * rng.choice([10, 10000]), lambda: "", lambda: [], lambda: {}, lambda: "9" * 400,
        lambda: 1780000000000.5, lambda: -1780000000000, lambda: 10**20,
    ]
    if depth < 3:
        kinds += [lambda: [json_junk(rng, depth + 1) for _ in range(rng.randint(0, 4))],
                  lambda: {rng.choice(["id", "status", "email", "emails", "total", "to", "cc", "attachments", "__proto__", "constructor", "x"]): json_junk(rng, depth + 1) for _ in range(rng.randint(0, 4))}]  # fmt: skip
    return rng.choice(kinds)()


def mutate(rng: random.Random, value: Any, p: float = 0.25) -> Any:
    """Copy of a valid structure with random sub-values replaced by junk."""
    if rng.random() < p:
        return json_junk(rng)
    if isinstance(value, dict):
        out = {k: mutate(rng, v, p) for k, v in value.items() if rng.random() > 0.08}
        if rng.random() < 0.1:
            out["__proto__"] = {"polluted": True}
        return out
    if isinstance(value, list):
        return [mutate(rng, v, p) for v in value]
    return value
