"""How this server runs.

FASTTRACK_DATA=demo  only the made-up demo course in data/demo plus labelled sample learners and a
                     sample class. Nothing else is loaded. It is also the default when the database
                     has no course yet (a fresh deploy).
FASTTRACK_PUBLIC=1   a public deployment: settings are read-only (keys come from env vars only) and
                     the dev Note button is off.
"""

import os


def demo() -> bool:
    return os.environ.get("FASTTRACK_DATA", "").lower() == "demo"


def public() -> bool:
    return os.environ.get("FASTTRACK_PUBLIC", "").lower() in ("1", "true", "yes", "on")


def bootstrap() -> dict:
    """On start-up in demo mode (or on an empty database), load the demo course and sample class."""
    from . import db, facilitate
    courses = db.q("SELECT id, title FROM courses")
    if courses and not demo():
        return {"seeded": False}
    from . import main
    cid = main.demo_seed()["course_id"]
    _code_topics(cid)
    facilitate.ensure_tables()
    has_samples = db.one("SELECT 1 FROM learners WHERE course_id = ? AND email LIKE '%@sample.demo'", (cid,))
    if not has_samples:
        from tools import seed_sample_class
        try:
            seed_sample_class.seed(cid)
        except Exception as e:                      # noqa: BLE001 - never block start-up on sample data
            print(f"Sample class not seeded: {e}")
    return {"seeded": True, "course_id": cid}


def _code_topics(cid: int) -> None:
    """Fast Track groups chapters by a module code ("NS-01 T03: ..."). Give the demo course two
    modules and line its passages up with the new chapter titles. Safe to run more than once."""
    from . import db
    topics = db.q("SELECT id, seq, title FROM topics WHERE course_id = ? ORDER BY seq", (cid,))
    half = (len(topics) + 1) // 2
    for t in topics:
        if t["title"].startswith("NS-"):
            continue
        mod = 1 if t["seq"] <= half else 2
        new = f"NS-{mod:02d} T{t['seq']:02d}: {t['title']}"
        db.run("UPDATE passages SET chapter = ? WHERE course_id = ? AND chapter = ?",
               (new, cid, f"Chapter {t['seq']}: {t['title']}"))
        db.update("topics", t["id"], title=new)
