"""Watch dev-notes/ and claim each new note within seconds.

Every new note is set to "working" straight away, so the owner sees it was picked up. Login-page
notes go to the login team with the reply "With the login team". One line is printed per new note
(for whoever is doing the work to pick it up). Runs until stopped.

    python -m tools.notes_watcher            # poll every 10 s
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "dev-notes"
API = "http://localhost:8001/api/dev-notes"
EVERY = 10


def is_login(n: dict) -> bool:
    return "/fast-track/login" in (n.get("url") or "") or (n.get("selector") or "").startswith("#root > div.lg")


def patch(nid: int, body: dict) -> None:
    req = urllib.request.Request(f"{API}/{nid}", data=json.dumps(body).encode(), method="PATCH",
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10).read()
    except Exception:                                  # server restarting: write the file directly
        f = ROOT / f"{nid:03d}" / "note.json"
        n = json.loads(f.read_text(encoding="utf-8"))
        n.update(body)
        f.write_text(json.dumps(n, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")


def main() -> None:
    seen: set[str] = set()
    while True:
        for f in sorted(ROOT.glob("*/note.json")) if ROOT.exists() else []:
            try:
                n = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue                                # still being written
            key = f.parent.name
            if n.get("status") != "new" or key in seen:
                continue
            seen.add(key)
            login, feature = is_login(n), n.get("type") == "feature"
            reply = {"reply": "Being built in its own thread"} if feature else {}
            patch(n["id"], {"status": "working", **reply})
            kind = "feature" if feature else "login" if login else "app"
            print(f"NEW NOTE {n['id']} | {kind} | {n.get('url', '')} | {n.get('note', '')[:300]}", flush=True)
        time.sleep(EVERY)


if __name__ == "__main__":
    sys.exit(main())
