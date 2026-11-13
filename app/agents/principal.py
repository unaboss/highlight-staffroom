"""Principal: turns the syllabus and the timetable into a dated lesson sequence, and keeps the
pacing forecast. The model may read a messy syllabus, but dates and counts are done in code.
"""

import math
import re
from datetime import date, timedelta

from .. import db

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

SYLLABUS_SYSTEM = """You read a school syllabus and list its topics in teaching order.
Reply: {"topics": [{"title": "...", "minutes": <teaching minutes, integer>, "keywords": "comma, separated, terms"}]}
Use only topics that appear in the syllabus text."""

TOPIC_RE = re.compile(r"^\s*(\d+)[.)]\s+(.+?)\s*\((\d+)\s*min(?:utes)?\)\s*(?:\|\s*keywords?\s*:\s*(.+))?\s*$", re.I)


def parse_syllabus(text: str, llm=None, emit=None) -> list[dict]:
    topics = []
    for line in text.splitlines():
        m = TOPIC_RE.match(line)
        if m:
            topics.append({"title": m.group(2).strip(), "minutes": int(m.group(3)),
                           "keywords": (m.group(4) or "").strip()})
    if not topics and llm is not None and llm.online:
        if emit:
            emit("Principal", "work", "Syllabus isn't in the standard format; reading it with the model")
        out = llm.json(SYLLABUS_SYSTEM, text[:12000], max_tokens=1500)
        for t in out.get("topics") or []:
            try:
                topics.append({"title": str(t["title"]).strip(), "minutes": max(15, int(t.get("minutes") or 45)),
                               "keywords": str(t.get("keywords") or "")})
            except (KeyError, TypeError, ValueError):
                continue
    return topics


def slots(start: date, end: date, days: list[int]) -> list[date]:
    """Teaching dates from start up to (not including) end."""
    out, d = [], start
    while d < end:
        if d.weekday() in days:
            out.append(d)
        d += timedelta(days=1)
    return out


def course_days(course: dict) -> list[int]:
    return [int(x) for x in (db.loads(course["slot_days"], []) or [0, 2, 4])]


def plan_course(course_id: int, emit) -> list[dict]:
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    topics = db.q("SELECT * FROM topics WHERE course_id = ? ORDER BY seq", (course_id,))
    emit("Principal", "start", f"Planning the term for {course['title']}: {len(topics)} syllabus topics")
    start = date.fromisoformat(course["term_start"])
    exam = date.fromisoformat(course["exam_date"])
    days = course_days(course)
    avail = slots(start, exam, days)
    slot_min = course["slot_minutes"] or 45
    emit("Principal", "work",
         f"Timetable: {', '.join(WEEKDAYS[d] for d in days)}, {slot_min}-minute lessons, "
         f"{len(avail)} slots before the exam on {exam.isoformat()}")

    existing = db.q("SELECT * FROM lessons WHERE course_id = ? ORDER BY seq", (course_id,))
    if existing:
        return replan(course, existing, days, exam, emit)
    lessons, seq = [], 0
    for t in topics:
        parts = max(1, math.ceil((t["minutes"] or slot_min) / slot_min))
        for part in range(1, parts + 1):
            seq += 1
            when = avail[seq - 1].isoformat() if seq <= len(avail) else None
            title = t["title"] if parts == 1 else f"{t['title']} (part {part} of {parts})"
            lid = db.insert("lessons", course_id=course_id, seq=seq, topic_id=t["id"], part=part, parts=parts,
                            title=title, planned_date=when, minutes=slot_min, status="Planned")
            lessons.append({"id": lid, "seq": seq, "title": title, "planned_date": when})

    # Code-side checks: every topic covered once, every date a real timetable slot.
    covered = {r["topic_id"] for r in db.q("SELECT DISTINCT topic_id FROM lessons WHERE course_id = ?", (course_id,))}
    missing = [t["title"] for t in topics if t["id"] not in covered]
    if missing:
        emit("Principal", "warn", f"Topics with no lesson: {', '.join(missing)}")
    overflow = [l for l in lessons if l["planned_date"] is None]
    if overflow:
        emit("Principal", "warn", f"{len(overflow)} lesson(s) don't fit before the exam",
             {"lessons": [l["title"] for l in overflow]})
    emit("Principal", "handoff", f"Planned {len(lessons)} lessons from {lessons[0]['planned_date']} "
         f"to {lessons[-1]['planned_date'] or 'after the exam'}", {"lessons": len(lessons)})
    return lessons


def replan(course: dict, existing: list[dict], days: list[int], exam: date, emit) -> list[dict]:
    """Keep what's been taught; move the rest onto the timetable slots that are left."""
    today = today_for(course["id"])
    taught = [l for l in existing if l["status"] in ("Taught", "Reviewed")]
    left = [l for l in existing if l["status"] not in ("Taught", "Reviewed")]
    taught_today = any(l["taught_on"] == today.isoformat() for l in taught)
    free = slots(today + timedelta(days=1) if taught_today else today, exam, days)
    emit("Principal", "work", f"{len(taught)} lessons already taught; re-planning the other {len(left)} "
         f"onto the {len(free)} slots left before the exam")
    out = []
    for i, l in enumerate(left):
        when = free[i].isoformat() if i < len(free) else None
        db.update("lessons", l["id"], planned_date=when)
        out.append({"id": l["id"], "seq": l["seq"], "title": l["title"], "planned_date": when})
    overflow = [l for l in out if l["planned_date"] is None]
    if overflow:
        emit("Principal", "warn", f"{len(overflow)} lesson(s) no longer fit before the exam: "
             + ", ".join(l["title"] for l in overflow), {"lessons": [l["title"] for l in overflow]})
    else:
        emit("Principal", "pass", "Every remaining lesson fits before the exam")
    emit("Principal", "handoff", f"Re-planned {len(out)} lessons", {"lessons": len(out)})
    return out or [{"id": l["id"], "seq": l["seq"], "title": l["title"], "planned_date": l["planned_date"]}
                   for l in existing]


def today_for(course_id: int | None = None) -> date:
    as_of = db.get_setting("as_of_date")
    if as_of:
        try:
            return date.fromisoformat(as_of)
        except ValueError:
            pass
    return date.today()


def pacing(course_id: int, today: date | None = None) -> dict:
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    if not course:
        return {}
    today = today or today_for(course_id)
    lessons = db.q("SELECT l.*, t.title AS topic FROM lessons l LEFT JOIN topics t ON t.id = l.topic_id "
                   "WHERE l.course_id = ? ORDER BY l.seq", (course_id,))
    if not lessons:
        return {"total": 0}
    exam = date.fromisoformat(course["exam_date"])
    days = course_days(course)
    taught = [l for l in lessons if l["status"] in ("Taught", "Reviewed")]
    left = [l for l in lessons if l["status"] not in ("Taught", "Reviewed")]
    taught_today = any(l["taught_on"] == today.isoformat() for l in taught)
    first_free = today + timedelta(days=1) if taught_today else today
    slots_left = slots(first_free, exam, days)
    due = [l for l in lessons if l["planned_date"] and l["planned_date"] < today.isoformat()]
    behind_schedule = max(0, len(due) - len(taught))
    # Forecast: remaining lessons continue on the timetable pattern, past the exam if needed.
    future = slots(first_free, first_free + timedelta(days=400), days)
    eta = future[len(left) - 1] if left and len(future) >= len(left) else (today if not left else None)
    shortfall = max(0, len(left) - len(slots_left))
    at_risk = [l["title"] for l in left[len(slots_left):]] if shortfall else []
    forecast = {str(l["id"]): future[i].isoformat() for i, l in enumerate(left) if i < len(future)}
    return {
        "today": today.isoformat(), "exam_date": exam.isoformat(), "total": len(lessons),
        "taught": len(taught), "due_by_today": len(due), "behind_schedule": behind_schedule,
        "lessons_left": len(left), "slots_left": len(slots_left),
        "eta": eta.isoformat() if eta else None, "shortfall": shortfall,
        "on_track": shortfall == 0, "at_risk": at_risk,
        "days_to_exam": (exam - today).days, "forecast": forecast,
        "at_risk_ids": [l["id"] for l in left[len(slots_left):]] if shortfall else [],
    }
