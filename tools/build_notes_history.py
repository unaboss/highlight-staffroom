"""Build data/demo/notes-history.json: the team's own Note-button notes, sanitised and cited, for the
public demo. Each note keeps its words, page, status and the one-line reply, plus the evidence for the
fix: the local commit hash and subject, the files changed (linked to GitHub fast-track) and a short
code-only diff. Original screenshots are never published (they were taken on the private course);
an "after" screenshot from the demo server is used when one exists in app/static/demo-notes/.

    python -m tools.build_notes_history
"""

import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent
NOTES = REPO / "dev-notes"
OUT = REPO / "data" / "demo" / "notes-history.json"
AFTER = REPO / "app" / "static" / "demo-notes"
GITHUB = "https://github.com/unaboss/highlight-staffroom/blob/fast-track/"
CODE = re.compile(r"^(app/|web/src/|tools/|tests/|Dockerfile|render\.yaml)")
SKIP = re.compile(r"(^web/dist/|lock\.json$|^data/|^dev-notes/|\.(png|jpg|jpeg|gif|webp|ico)$)")
MAX_LINES, MAX_COMMITS = 70, 3


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout


# Published wording for notes whose original text mentions the owner's own machine.
OVERRIDE = {45: "Put the level pills on this side: one pill per chapter, with the chapter name next to it. Then only the "
                "Begin Fast Track button, with a line saying: select a branch, a leaf or the trunk to set your Fast Track. "
                "The depth of the Fast Track follows what you pick. For simplicity assume the class has only finished chapter 1."}
LOCAL = re.compile(r"([A-Za-z]:\\[^\s\"']*|/[cC]/Users/[^\s\"']*|\\Users\\[^\s\"']*|Documents[\\/]North Tech[^\s\"']*|Pictures[\\/]Screenshots[^\s\"']*)")


def clean(text: str) -> str:
    """Neutralise course codes from the private notes, and any local machine path."""
    text = LOCAL.sub("(local path)", text)
    text = re.sub(r"\bKM-\d+\s+KT\d+\b", "the chapter", text)
    text = re.sub(r"\bKM-\d+\b", "the module", text)
    return re.sub(r"\bKT\d{2,}\b", "the chapter", text)


def page(url: str) -> str:
    u = urlparse(url or "")
    return (u.path or "/") + (("#" + u.fragment) if u.fragment else "")


def commits_by_note() -> dict[int, list[str]]:
    """Map note numbers to commits whose message says "dev note(s) ..."."""
    out: dict[int, list[str]] = {}
    for block in git("log", "--format=%h%x00%B%x01").split("\x01"):
        if "\x00" not in block:
            continue
        sha, msg = block.strip().split("\x00", 1)
        for m in re.finditer(r"dev notes? ([\d ,\-–and]+)", msg):
            for a, b in re.findall(r"(\d+)(?:\s*[-–]\s*(\d+))?", m.group(1)):
                for n in range(int(a), int(b or a) + 1):
                    out.setdefault(n, []).append(sha.strip())
    return out


def cite(sha: str) -> dict:
    subject = git("log", "-1", "--format=%s", sha).strip()
    files = [f for f in git("show", "--format=", "--name-only", sha).split() if CODE.match(f) and not SKIP.search(f)]
    diff_lines: list[str] = []
    if files:
        for line in git("show", "--format=", "--unified=1", sha, "--", *files).splitlines():
            if len(diff_lines) >= MAX_LINES:
                diff_lines.append("… (diff shortened)")
                break
            diff_lines.append(line[:220])
    return {"commit": sha, "subject": subject, "files": [{"path": f, "url": GITHUB + f} for f in files],
            "diff": clean("\n".join(diff_lines))}


def after_shot(pg: str) -> str | None:
    key = "login" if "login" in pg else "prep" if "/class/prep" in pg else "learners" if "learners" in pg \
        else "class" if "#/class" in pg or "#/school" in pg else "play" if "play" in pg else ""
    f = AFTER / f"after-{key}.png"
    return f"/static/demo-notes/{f.name}" if key and f.exists() else None


def main() -> None:
    by_note = commits_by_note()
    hist = []
    for f in sorted(NOTES.glob("*/note.json")):
        n = json.loads(f.read_text(encoding="utf-8"))
        shas = list(dict.fromkeys(([n["commit"]] if n.get("commit") else []) + by_note.get(n["id"], [])))[:MAX_COMMITS]
        pg = page(n.get("url", ""))
        hist.append({
            "id": n["id"], "history": True, "status": n.get("status", "new"), "type": n.get("type", "tweak"),
            "note": OVERRIDE.get(n["id"]) or clean(n.get("note", ""))[:1000], "page": pg, "url": pg,
            "reply": clean(n.get("reply") or n.get("summary") or "")[:400],
            "created_at": n.get("created_at"), "updated_at": n.get("updated_at"),
            "commit": shas[0] if shas else "", "citations": [cite(s) for s in shas if git("cat-file", "-t", s).strip()],
            "before": None, "before_note": "Original screenshot kept private (taken on the course notes).",
            "after": after_shot(pg), "has_shot": False,
        })
    OUT.write_text(json.dumps(hist, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    print(f"Wrote {len(hist)} notes to {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
