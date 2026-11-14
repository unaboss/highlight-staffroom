"""Dev notes: live feedback captured from the running app. Each note is a numbered folder in
dev-notes/ holding note.json (what the owner typed, where, and a status) and shot.png (the
region they marked). Kept out of git. Turned off with STAFFROOM_DEV_NOTES=0 (presentation mode)."""

import base64
import json
import os
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "dev-notes"
HISTORY = Path(__file__).resolve().parent.parent / "data" / "demo" / "notes-history.json"
TYPES = ("tweak", "feature")
# Public demo: visitors may leave notes, safely. They are kept for the team to review and are never
# picked up or acted on by any agent (the laptop watcher only reads the repo's own dev-notes/).
PUBLIC_MAX_TEXT, PUBLIC_MAX_IMAGE, PUBLIC_PER_MIN, PUBLIC_KEEP, PUBLIC_FIRST_ID = 1000, 2 * 1024 * 1024, 5, 200, 1000
QUEUED = ("Queued. On the team's laptop the notes agent picks each note up within 10 seconds and fixes it live; "
          "on this public demo, notes are kept for the team to review.")
_recent: dict[str, deque] = defaultdict(deque)
STATUSES = ("new", "working", "done", "question")
SCRIPT = Path(__file__).resolve().parent / "static" / "dev-notes.js"
_lock = threading.Lock()


def script_tag() -> bytes:
    """The Note button's script tag, versioned by the file's mtime so browsers pick up changes."""
    v = int(SCRIPT.stat().st_mtime) if SCRIPT.exists() else 0
    return f'<script src="/static/dev-notes.js?v={v}" defer></script>'.encode()


def enabled() -> bool:
    return os.environ.get("STAFFROOM_DEV_NOTES", "1") not in ("0", "false", "off")


def _public() -> bool:
    return os.environ.get("FASTTRACK_PUBLIC", "").lower() in ("1", "true", "yes", "on")


def root() -> Path:
    """Where notes live: the repo's dev-notes/ on the laptop; beside the database (/data) on a public deploy."""
    if os.environ.get("STAFFROOM_DEV_NOTES_DIR"):
        return Path(os.environ["STAFFROOM_DEV_NOTES_DIR"])
    if _public():
        from . import db
        return Path(db.db_path()).resolve().parent / "dev-notes"
    return ROOT


def history() -> list[dict]:
    """The team's own notes from the build, sanitised and cited (shown on the public demo)."""
    try:
        return json.loads(HISTORY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def _folder(nid: int) -> Path:
    return root() / f"{nid:03d}"


def _read(folder: Path) -> dict | None:
    try:
        n = json.loads((folder / "note.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    n["has_shot"] = (folder / "shot.png").exists()
    return n


def _write(folder: Path, note: dict) -> None:
    keep = {k: v for k, v in note.items() if k != "has_shot"}
    tmp = folder / "note.json.tmp"
    tmp.write_text(json.dumps(keep, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
    tmp.replace(folder / "note.json")


def list_notes() -> list[dict]:
    r = root()
    notes = [_read(f) for f in r.iterdir() if f.is_dir() and re.fullmatch(r"\d+", f.name)] if r.exists() else []
    out = sorted((n for n in notes if n), key=lambda n: n["id"], reverse=True)
    return out + (history()[::-1] if _public() else [])


def get(nid: int) -> dict | None:
    n = _read(_folder(nid))
    if n is None and _public():
        n = next((h for h in history() if h.get("id") == nid), None)
    return n


def _rate_ok(ip: str) -> bool:
    now = time.time()
    with _lock:
        q = _recent[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= PUBLIC_PER_MIN:
            return False
        q.append(now)
        return True


def _prune_public() -> None:
    """Keep at most PUBLIC_KEEP visitor notes; the oldest go first."""
    r = root()
    ids = sorted(int(f.name) for f in r.iterdir() if f.is_dir() and f.name.isdigit())
    for old in ids[:max(0, len(ids) - PUBLIC_KEEP)]:
        folder = _folder(old)
        for f in folder.iterdir():
            f.unlink()
        folder.rmdir()


class RateLimited(Exception):
    pass


def create(data: dict, ip: str | None = None) -> dict:
    public = _public()
    text = (data.get("note") or "").strip()
    if not text:
        raise ValueError("Write a note first")
    if public:
        if len(text) > PUBLIC_MAX_TEXT:
            raise ValueError(f"Keep a note under {PUBLIC_MAX_TEXT} characters")
        if not _rate_ok(ip or "?"):
            raise RateLimited("That's a lot of notes at once. Try again in a minute.")
    image = data.get("image") or ""
    if public and len(image) * 3 // 4 > PUBLIC_MAX_IMAGE:
        raise ValueError("That screenshot is over 2 MB")
    r = root()
    with _lock:
        r.mkdir(parents=True, exist_ok=True)
        ids = [int(f.name) for f in r.iterdir() if f.is_dir() and f.name.isdigit()]
        nid = max(ids, default=PUBLIC_FIRST_ID - 1 if public else 0) + 1
        folder = _folder(nid)
        folder.mkdir()
    now = datetime.now().isoformat(timespec="seconds")
    note = {
        "id": nid, "status": "new", "note": text[:4000], "created_at": now, "updated_at": now, "summary": "",
        "url": str(data.get("url") or "")[:500], "viewport": data.get("viewport") or {},
        "rect": data.get("rect") or {}, "selector": str(data.get("selector") or "")[:500],
        "element_text": str(data.get("text") or "")[:1000], "mode": data.get("mode") or "region", "reply": "",
        "type": data.get("type") if data.get("type") in TYPES else "tweak",
    }
    if public:
        note.update(visitor=True, reply=QUEUED)
    m = re.match(r"data:image/png;base64,(.+)", image, re.S)
    if m:
        try:
            (folder / "shot.png").write_bytes(base64.b64decode(m.group(1)))
        except ValueError:
            note["shot_error"] = "could not decode image"
    elif data.get("shot_error"):
        note["shot_error"] = str(data["shot_error"])[:300]
    _write(folder, note)
    if public:
        _prune_public()
    return get(nid)


def update(nid: int, data: dict) -> dict | None:
    folder = _folder(nid)
    note = _read(folder)
    if not note:
        return None
    if "status" in data:
        if data["status"] not in STATUSES:
            raise ValueError(f"status must be one of {', '.join(STATUSES)}")
        note["status"] = data["status"]
    for key in ("reply", "summary", "question", "commit"):
        if key in data:
            note[key] = str(data[key] or "")[:2000]
    note["updated_at"] = datetime.now().isoformat(timespec="seconds")
    _write(folder, note)
    return _read(folder)


def shot_path(nid: int) -> Path | None:
    p = _folder(nid) / "shot.png"
    return p if p.exists() else None
