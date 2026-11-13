"""Dev notes: live feedback captured from the running app. Each note is a numbered folder in
dev-notes/ holding note.json (what the owner typed, where, and a status) and shot.png (the
region they marked). Kept out of git. Turned off with STAFFROOM_DEV_NOTES=0 (presentation mode)."""

import base64
import json
import os
import re
import threading
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "dev-notes"
STATUSES = ("new", "working", "done", "question")
SCRIPT = Path(__file__).resolve().parent / "static" / "dev-notes.js"
_lock = threading.Lock()


def script_tag() -> bytes:
    """The Note button's script tag, versioned by the file's mtime so browsers pick up changes."""
    v = int(SCRIPT.stat().st_mtime) if SCRIPT.exists() else 0
    return f'<script src="/static/dev-notes.js?v={v}" defer></script>'.encode()


def enabled() -> bool:
    return os.environ.get("STAFFROOM_DEV_NOTES", "1") not in ("0", "false", "off")


def _folder(nid: int) -> Path:
    return ROOT / f"{nid:03d}"


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
    if not ROOT.exists():
        return []
    notes = [_read(f) for f in ROOT.iterdir() if f.is_dir() and re.fullmatch(r"\d+", f.name)]
    return sorted((n for n in notes if n), key=lambda n: n["id"], reverse=True)


def get(nid: int) -> dict | None:
    return _read(_folder(nid))


def create(data: dict) -> dict:
    text = (data.get("note") or "").strip()
    if not text:
        raise ValueError("Write a note first")
    with _lock:
        ROOT.mkdir(exist_ok=True)
        ids = [int(f.name) for f in ROOT.iterdir() if f.is_dir() and f.name.isdigit()]
        nid = max(ids, default=0) + 1
        folder = _folder(nid)
        folder.mkdir()
    now = datetime.now().isoformat(timespec="seconds")
    note = {
        "id": nid, "status": "new", "note": text[:4000], "created_at": now, "updated_at": now, "summary": "",
        "url": str(data.get("url") or "")[:500], "viewport": data.get("viewport") or {},
        "rect": data.get("rect") or {}, "selector": str(data.get("selector") or "")[:500],
        "element_text": str(data.get("text") or "")[:1000], "mode": data.get("mode") or "region",
    }
    image = data.get("image") or ""
    m = re.match(r"data:image/png;base64,(.+)", image, re.S)
    if m:
        try:
            (folder / "shot.png").write_bytes(base64.b64decode(m.group(1)))
        except ValueError:
            note["shot_error"] = "could not decode image"
    elif data.get("shot_error"):
        note["shot_error"] = str(data["shot_error"])[:300]
    _write(folder, note)
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
    for key in ("summary", "question", "commit"):
        if key in data:
            note[key] = str(data[key] or "")[:2000]
    note["updated_at"] = datetime.now().isoformat(timespec="seconds")
    _write(folder, note)
    return _read(folder)


def shot_path(nid: int) -> Path | None:
    p = _folder(nid) / "shot.png"
    return p if p.exists() else None
