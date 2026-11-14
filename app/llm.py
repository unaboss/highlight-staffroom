"""LLM access. Any OpenAI-compatible endpoint; Nemotron on Nebius Token Factory by default.

With no API key the app runs in offline mode: the agents fall back to extractive,
rule-based behaviour so the whole loop still works (and tests run without a network).
Either way, code checks every output before it is saved.
"""

import json
import re
import time

from . import db

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
DEFAULT_MODEL = "nvidia/Llama-3_3-Nemotron-Super-49B-v1_5"


def strip_think(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    return re.sub(r"^.*?</think>", "", text, flags=re.S).strip()


def parse_json(text: str) -> dict:
    """Pull the first balanced JSON object out of a model reply."""
    text = strip_think(text)
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M)
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    return {}


class LLM:
    def __init__(self, api_key: str = "", base_url: str = "", model: str = "", client=None):
        self.api_key = api_key
        self.base_url = base_url or DEFAULT_BASE_URL
        self.model = model or DEFAULT_MODEL
        self._client = client
        self.calls = 0
        self.seconds = 0.0
        self.tokens = 0                                 # total tokens the provider reported

    @property
    def online(self) -> bool:
        return bool(self._client or self.api_key)

    @property
    def label(self) -> str:
        return self.model if self.online else "offline mode (no LLM)"

    def client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key, timeout=90)
        return self._client

    def chat(self, system: str, user: str, max_tokens: int = 1500, temperature: float = 0.2) -> str:
        t0 = time.time()
        resp = self.client().chat.completions.create(
            model=self.model, temperature=temperature, max_tokens=max_tokens,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
        self.calls += 1
        self.seconds += time.time() - t0
        self.tokens += int(getattr(getattr(resp, "usage", None), "total_tokens", 0) or 0)
        return strip_think(resp.choices[0].message.content or "")

    def converse(self, system: str, messages: list[dict], max_tokens: int = 800, temperature: float = 0.3) -> str:
        """A multi-turn chat: messages are {"role": "user"|"assistant", "content": ...}, oldest first."""
        while messages and messages[0]["role"] != "user":       # providers want the user to speak first
            messages = messages[1:]
        t0 = time.time()
        resp = self.client().chat.completions.create(
            model=self.model, temperature=temperature, max_tokens=max_tokens,
            messages=[{"role": "system", "content": system}, *messages])
        self.calls += 1
        self.seconds += time.time() - t0
        self.tokens += int(getattr(getattr(resp, "usage", None), "total_tokens", 0) or 0)
        return strip_think(resp.choices[0].message.content or "")

    def converse_stream(self, system: str, messages: list[dict], max_tokens: int = 800, temperature: float = 0.3):
        """Like converse(), but yields text deltas as the provider streams them. <think> blocks are held back."""
        while messages and messages[0]["role"] != "user":
            messages = messages[1:]
        t0 = time.time()
        stream = self.client().chat.completions.create(
            model=self.model, temperature=temperature, max_tokens=max_tokens, stream=True,
            messages=[{"role": "system", "content": system}, *messages])
        self.calls += 1
        buf, thinking, chars = "", False, 0
        try:
            for chunk in stream:
                usage = getattr(chunk, "usage", None)
                if usage and getattr(usage, "total_tokens", None):
                    self.tokens += int(usage.total_tokens)
                    chars = -10 ** 9                       # provider counted; don't estimate
                choices = getattr(chunk, "choices", None) or []
                delta = getattr(getattr(choices[0], "delta", None), "content", None) if choices else None
                if not delta:
                    continue
                chars += len(delta)
                buf += delta
                while buf:
                    if thinking:
                        end = buf.find("</think>")
                        if end == -1:
                            buf = buf[-8:]
                            break
                        buf, thinking = buf[end + 8:], False
                    else:
                        start = buf.find("<think>")
                        if start == -1:
                            keep = 7 if "<" in buf[-7:] else 0      # a tag may be split across chunks
                            out, buf = (buf[:-keep], buf[-keep:]) if keep else (buf, "")
                            if out:
                                yield out
                            break
                        if start:
                            yield buf[:start]
                        buf, thinking = buf[start + 7:], True
            if buf and not thinking:
                yield buf
        finally:
            if chars > 0:
                self.tokens += chars // 4 + 1
            self.seconds += time.time() - t0

    def json(self, system: str, user: str, max_tokens: int = 1800) -> dict:
        """Ask for one JSON object; retry once with a reminder if it can't be parsed."""
        system = "/no_think\n" + system + "\nReply with ONE JSON object and nothing else."
        out = parse_json(self.chat(system, user, max_tokens))
        if not out:
            out = parse_json(self.chat(system, user + "\n\nYour last reply was not valid JSON. "
                                       "Reply with only the JSON object.", max_tokens))
        return out


def get_llm(public_ok: bool = False) -> LLM:
    """The configured model. On a public deployment it is offline unless the AI gate hands it out
    (app/ai_gate.py), so no code path can spend the key without being counted."""
    import os
    if not public_ok and os.environ.get("FASTTRACK_PUBLIC", "").lower() in ("1", "true", "yes", "on"):
        return LLM()
    return LLM(api_key=db.get_setting("nebius_api_key"),
               base_url=db.get_setting("nebius_base_url", DEFAULT_BASE_URL),
               model=db.get_setting("nebius_model", DEFAULT_MODEL))
