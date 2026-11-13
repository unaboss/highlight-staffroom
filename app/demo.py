"""Seed the demo course: notes, syllabus, learners, past quiz marks and a term timetable.

Dates are set relative to today, so the demo always opens at the same point in the story:
the class is two lessons behind, today's lesson is Firewalls, and the mock class is ready to upload.
"""

import csv
import io
import json
from datetime import date, timedelta
from pathlib import Path

from . import db
from .agents import librarian, principal
from .events import Emitter

DEMO = Path(__file__).resolve().parent.parent / "data" / "demo"


def _last_slot(today: date, days: list[int]) -> date:
    d = today
    while d.weekday() not in days:
        d -= timedelta(days=1)
    return d


def seed(today: date | None = None) -> int:
    today = today or principal.today_for()
    info = json.loads((DEMO / "course.json").read_text())
    days = info["slot_days"]
    syllabus = (DEMO / "syllabus.md").read_text()
    topics = principal.parse_syllabus(syllabus)
    slot_min = info["slot_minutes"]
    parts = [max(1, -(-t["minutes"] // slot_min)) for t in topics]
    firewall_first = sum(parts[:3]) + 1          # first Firewalls lesson
    planned_today = firewall_first + 2            # the class is two lessons behind

    d0 = _last_slot(today, days)
    back, d = [], d0
    while len(back) < planned_today:              # walk back to find the term start
        if d.weekday() in days:
            back.append(d)
        d -= timedelta(days=1)
    term_start = back[-1]
    total = sum(parts)
    forward, d = [], d0 + timedelta(days=1)
    while len(forward) < total - planned_today + 1:
        if d.weekday() in days:
            forward.append(d)
        d += timedelta(days=1)
    exam = forward[-1]                             # all lessons fit if nobody falls behind

    cid = db.insert("courses", title=info["title"], subject=info["subject"], grade=info["grade"],
                    curriculum=info["curriculum"], teacher=info["teacher"], term_start=term_start.isoformat(),
                    exam_date=exam.isoformat(), slot_days=db.dumps(days), slot_minutes=slot_min,
                    meet_code=info.get("meet_code", ""))
    for i, t in enumerate(topics, 1):
        db.insert("topics", course_id=cid, seq=i, title=t["title"], minutes=t["minutes"], keywords=t["keywords"])
    for f in sorted((DEMO / "notes").glob("*.md")):
        librarian.ingest_file(cid, f.name, f.read_bytes())
    learners = {}
    for l in json.loads((DEMO / "learners.json").read_text()):
        learners[l["name"]] = db.insert("learners", course_id=cid, name=l["name"], email=l["email"], consent=1)
    topic_ids = {r["seq"]: r["id"] for r in db.q("SELECT id, seq FROM topics WHERE course_id = ?", (cid,))}
    for r in csv.DictReader(io.StringIO((DEMO / "scores.csv").read_text())):
        db.insert("scores", learner_id=learners[r["learner"]], topic_id=topic_ids[int(r["topic"])], kind="quiz",
                  score=float(r["score"]), max=float(r["max"]), taken_on=term_start.isoformat())

    principal.plan_course(cid, Emitter(None))
    for l in db.q("SELECT * FROM lessons WHERE course_id = ? AND seq < ?", (cid, firewall_first)):
        db.update("lessons", l["id"], status="Taught", taught_on=l["planned_date"])
    return cid


def demo_class() -> tuple[str, str]:
    return ((DEMO / "class-firewalls.vtt").read_text(), (DEMO / "attendance-firewalls.csv").read_text())
