"""Export a clean copy of the course database for a deployment that should show the real course.

The copy keeps the course, its notes (passages), lessons, plans, the labelled sample learners and the
sample classes. It drops everything private or machine-specific: all saved settings (API keys, tokens,
connector credentials), any learner who isn't a labelled sample, the job and event logs, and connector
sync records. The result is zipped OUTSIDE the repo; it must never be committed.

    python -m tools.export_course_db --out "C:/path/outside/the/repo/cft-course-data.zip"

On the host: put staffroom.db from the zip at /data/staffroom.db (the mounted volume) and set
FASTTRACK_DATA=real. The app then serves that course instead of the demo one.
"""

import argparse
import sqlite3
import tempfile
import zipfile
from pathlib import Path

from app import db

README = """Classroom Fast Track: course data for the deployed site (private, never commit to git)

1. Copy staffroom.db to the server's data volume as /data/staffroom.db (STAFFROOM_DB points there).
2. Set FASTTRACK_DATA=real (keep FASTTRACK_PUBLIC=1 and FASTTRACK_PUBLIC_AI=1) and restart.
3. Set the model key as a host secret (NEBIUS_API_KEY), never in this file. No keys are inside it.
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    repo = Path(__file__).resolve().parent.parent
    if repo in a.out.resolve().parents:
        raise SystemExit("Save the bundle outside the repo, so it can never be committed.")
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "staffroom.db"
        src = sqlite3.connect(db.db_path())
        out = sqlite3.connect(dst)
        src.backup(out)
        src.close()
        c = out.cursor()
        c.execute("DELETE FROM settings")
        private = [r[0] for r in c.execute("SELECT id FROM learners WHERE COALESCE(email, '') NOT LIKE '%@sample.demo'")]
        for lid in private:
            for t in ("scores", "mastery", "fast_track", "fast_track_learner", "participation", "flags", "tests", "ft_actions"):
                c.execute(f"DELETE FROM {t} WHERE learner_id = ?", (lid,))
            c.execute("DELETE FROM learners WHERE id = ?", (lid,))
        for t in ("jobs", "events", "ft_tasks"):
            c.execute(f"DELETE FROM {t}")
        out.commit()
        c.execute("VACUUM")
        out.close()
        check = sqlite3.connect(dst)
        assert check.execute("SELECT COUNT(*) FROM settings").fetchone()[0] == 0
        courses = [r[0] for r in check.execute("SELECT title FROM courses")]
        learners = check.execute("SELECT COUNT(*) FROM learners").fetchone()[0]
        check.close()
        a.out.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(a.out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(dst, "staffroom.db")
            z.writestr("README.txt", README)
    print(f"Wrote {a.out} · courses {courses} · {learners} sample learners · {len(private)} non-sample learners removed · settings cleared")


if __name__ == "__main__":
    main()
