"""Live AI on the public demo, with caps.

On a private install every action uses the saved model. On a public deployment (FASTTRACK_PUBLIC=1):
- FASTTRACK_PUBLIC_AI unset or 0: no model calls at all; the agents give their offline answers.
- FASTTRACK_PUBLIC_AI=1: the configured model is used, counted per user ACTION (one Principal question,
  one lesson draft), however many agent calls that action makes. Caps, all adjustable by env var:
    FASTTRACK_AI_PER_IP_HOUR    actions per visitor IP per hour   (default 100)
    FASTTRACK_AI_PER_DAY        actions per day for everyone      (default 3000)
    FASTTRACK_AI_TOKENS_PER_DAY model tokens per day              (default 5,000,000)
    FASTTRACK_AI_MAX_TOKENS     max_tokens per model call         (default 900)
  When a cap is reached the action quietly falls back to the offline answer, with a calm notice.
"""

import os
import threading
import time
from collections import defaultdict, deque

from . import mode
from .llm import LLM, get_llm

LIMIT_NOTICE = "The live AI limit for the demo is reached, so this is the offline answer."
_lock = threading.Lock()
_by_ip: dict[str, deque] = defaultdict(deque)
_day = {"date": "", "actions": 0, "tokens": 0}


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def public_ai() -> bool:
    return os.environ.get("FASTTRACK_PUBLIC_AI", "").lower() in ("1", "true", "yes", "on")


def _today() -> str:
    return time.strftime("%Y-%m-%d")


def _roll() -> None:
    if _day["date"] != _today():
        _day.update(date=_today(), actions=0, tokens=0)


def reset() -> None:
    """For tests."""
    with _lock:
        _by_ip.clear()
        _day.update(date="", actions=0, tokens=0)


class GatedLLM(LLM):
    """The configured model with max_tokens clamped; every call's tokens count toward the day's budget."""

    def __init__(self, base: LLM):
        super().__init__(api_key=base.api_key, base_url=base.base_url, model=base.model, client=base._client)
        self.cap = _int("FASTTRACK_AI_MAX_TOKENS", 900)

    def _budget_left(self) -> bool:
        with _lock:
            _roll()
            return _day["tokens"] < _int("FASTTRACK_AI_TOKENS_PER_DAY", 5_000_000)

    def _count(self, before: int) -> None:
        used = max(0, self.tokens - before)
        with _lock:
            _roll()
            _day["tokens"] += used

    def chat(self, system: str, user: str, max_tokens: int = 1500, temperature: float = 0.2) -> str:
        if not self._budget_left():
            raise RuntimeError(LIMIT_NOTICE)
        before = self.tokens
        try:
            return super().chat(system, user, min(max_tokens, self.cap), temperature)
        finally:
            self._count(before)

    def converse(self, system: str, messages: list[dict], max_tokens: int = 800, temperature: float = 0.3) -> str:
        if not self._budget_left():
            raise RuntimeError(LIMIT_NOTICE)
        before = self.tokens
        try:
            return super().converse(system, messages, min(max_tokens, self.cap), temperature)
        finally:
            self._count(before)


    def converse_stream(self, system: str, messages: list[dict], max_tokens: int = 800, temperature: float = 0.3):
        if not self._budget_left():
            raise RuntimeError(LIMIT_NOTICE)
        before = self.tokens
        try:
            yield from super().converse_stream(system, messages, min(max_tokens, self.cap), temperature)
        finally:
            self._count(before)


def for_action(ip: str | None) -> tuple[LLM, str | None]:
    """The model to use for one user action, and a notice when it had to fall back to offline."""
    if not mode.public():
        return get_llm(), None
    if not public_ai():
        return LLM(), None
    base = get_llm(public_ok=True)
    if not base.online:
        return LLM(), None
    now = time.time()
    with _lock:
        _roll()
        q = _by_ip[ip or "?"]
        while q and now - q[0] > 3600:
            q.popleft()
        if (len(q) >= _int("FASTTRACK_AI_PER_IP_HOUR", 100)
                or _day["actions"] >= _int("FASTTRACK_AI_PER_DAY", 3000)
                or _day["tokens"] >= _int("FASTTRACK_AI_TOKENS_PER_DAY", 5_000_000)):
            return LLM(), LIMIT_NOTICE
        q.append(now)
        _day["actions"] += 1
    return GatedLLM(base), None


def usage() -> dict:
    with _lock:
        _roll()
        return {"actions_today": _day["actions"], "tokens_today": _day["tokens"]}
