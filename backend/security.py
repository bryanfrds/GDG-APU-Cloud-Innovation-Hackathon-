"""Demo passcode and bounded per-client in-memory request throttling.

An in-memory limiter is per process, not distributed. Place a shared limiter
in front of public deployments; never trust caller-supplied forwarded headers.
"""
import hmac
import os
import threading
import time
from collections import deque
from fastapi import HTTPException, Request


class RateLimiter:
    def __init__(self, max_hits: int, window_seconds: int):
        self.max_hits = max_hits
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            times = self._hits.setdefault(key, deque())
            while times and now - times[0] >= self.window_seconds:
                times.popleft()
            if len(times) >= self.max_hits:
                return False
            times.append(now)
            if len(self._hits) > 10_000:
                for address, q in list(self._hits.items()):
                    while q and now - q[0] >= self.window_seconds:
                        q.popleft()
                    if not q:
                        self._hits.pop(address, None)
            return True

    def clear(self):
        with self._lock:
            self._hits.clear()


UPLOAD_LIMITER = RateLimiter(max_hits=10, window_seconds=60)
GENERATE_LIMITER = RateLimiter(max_hits=5, window_seconds=60)


def _client_key(request: Request) -> str:
    # Trusted ASGI peer address, not an untrusted x-forwarded-for value.
    return request.client.host if request.client else 'unknown'


def _passcode(request: Request):
    configured = os.getenv('DEMO_PASSCODE')
    if not configured:
        # Fail closed rather than silently exposing the upload/AI endpoints.
        raise HTTPException(status_code=503, detail='DEMO_PASSCODE is not configured')
    supplied = request.headers.get('x-demo-code', '')
    if not hmac.compare_digest(supplied.encode(), configured.encode()):
        raise HTTPException(status_code=401, detail='Wrong or missing demo passcode')


def protect_read(request: Request):
    _passcode(request)


def protect_upload(request: Request):
    if not UPLOAD_LIMITER.check(_client_key(request)):
        raise HTTPException(status_code=429, detail='Too many uploads; try again later')
    _passcode(request)


def protect_generate(request: Request):
    if not GENERATE_LIMITER.check(_client_key(request)):
        raise HTTPException(status_code=429, detail='Too many generation requests; try again later')
    _passcode(request)


def one_line(value: str, limit: int, label: str) -> str:
    """Conservative equivalent of Next parsePlan: block hidden/format chars."""
    import unicodedata
    if not isinstance(value, str):
        raise ValueError(f'{label} must be a string')
    value = value.strip()
    if not value or len(value) > limit:
        raise ValueError(f'{label} must contain 1–{limit} characters')
    if any(unicodedata.category(ch) in {'Cc', 'Cf', 'Zl', 'Zp'} or
           ch in '\u034f\u115f\u1160\u3164\uffa0' for ch in value):
        raise ValueError(f'{label} must be a single line without hidden characters')
    return value
