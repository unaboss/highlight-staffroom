"""Track progress (dev note 39) and the notes reader behind "View plan".

Progress: three lines over time, all in % of the course notes:
  needed    the straight pace from the start of term to every passage taught by the exam
  class     how far the class actually got: taught lessons, and how far each class transcript reached
  learners  the average learner's own Fast Track progress (levels passed per chapter)
plus a Counsellor catch-up plan built from those numbers.

Notes: the course notes (passages) chapter by chapter, opening on the next lesson's chapter.

On a public deployment these only ever serve the demo course, and the Counsellor's model calls go through
the live-AI gate (ai_gate) like every other action.
"""

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Request

from . import ai_gate, db, facilitate, fasttrack, mode
from .agents import counsellor, principal
from .llm import LLM

router = APIRouter()


def _course(cid: int) -> dict:
    course = db.one("SELECT * FROM courses WHERE id = ?", (cid,))
    if not course:
        raise HTTPException(404, "Course not found")
    if mode.public():
        from .main import DEMO_TITLE
        if course["title"] != DEMO_TITLE:            # the public demo never shows a school's own course
            raise HTTPException(404, "Course not found")
    return course


def _chapters(cid: int) -> list[dict]:
    """Chapters in teaching order with their passage counts and the passages that come before them."""
    counts = {r["chapter"]: r["n"] for r in db.q("SELECT chapter, COUNT(*) AS n FROM passages WHERE course_id = ? "
                                                  "GROUP BY chapter", (cid,))}
    out, before = [], 0
    for t in db.q("SELECT id, seq, title FROM topics WHERE course_id = ? ORDER BY seq", (cid,)):
        n = counts.get(t["title"], 0)
        out.append({"topic_id": t["id"], "title": t["title"], "passages": n, "before": before})
        before += n
    return out


def _pct(x: float, total: int) -> float:
    return round(100 * x / total, 1) if total else 0.0


def lines(cid: int) -> dict:
    from .prep import _sessions, match_transcript
    course = _course(cid)
    chapters = _chapters(cid)
    by_topic = {c["topic_id"]: c for c in chapters}
    by_title = {c["title"]: c for c in chapters}
    total = sum(c["passages"] for c in chapters)
    today = principal.today_for(cid)
    exam = date.fromisoformat(course["exam_date"])
    lessons = db.q("SELECT id, topic_id, part, parts, planned_date, status, taught_on FROM lessons "
                   "WHERE course_id = ? ORDER BY seq", (cid,))
    dates = [l["planned_date"] for l in lessons if l["planned_date"]] + [l["taught_on"] for l in lessons if l["taught_on"]]
    start = date.fromisoformat(min([course["term_start"]] if course["term_start"] else dates or [today.isoformat()]))
    start = min(start, today)

    # the class: taught lessons and how far each recorded class got, as a running maximum
    events: list[tuple[str, float]] = []
    for l in lessons:
        c = by_topic.get(l["topic_id"])
        if c and l["status"] in ("Taught", "Reviewed") and l["taught_on"]:
            events.append((l["taught_on"], c["before"] + c["passages"] * (l["part"] or 1) / (l["parts"] or 1)))
    for s in _sessions(cid):
        c = by_title.get(s["chapter"])
        if c and s["held_on"]:
            upto = match_transcript(cid, s["chapter"], db.loads(s["entries_json"], []) or [])["upto"]
            events.append((s["held_on"], c["before"] + upto))
    cls, best = [{"date": start.isoformat(), "pct": 0.0}], 0.0
    for d, pos in sorted(events):
        if d > today.isoformat():
            continue
        best = max(best, pos)
        if cls[-1]["date"] == d:
            cls[-1]["pct"] = max(cls[-1]["pct"], _pct(best, total))
        else:
            cls.append({"date": d, "pct": _pct(best, total)})
    if cls[-1]["date"] < today.isoformat():
        cls.append({"date": today.isoformat(), "pct": _pct(best, total)})

    # the average learner: share of each chapter's ladder passed (11 rungs with the final quiz)
    fasttrack.ensure_tables()
    learners = [r["id"] for r in db.q("SELECT id FROM learners WHERE course_id = ?", (cid,))]
    rows = db.q("SELECT f.learner_id, f.topic_id, f.level, f.updated_at FROM fast_track f JOIN topics t "
                "ON t.id = f.topic_id WHERE t.course_id = ? AND f.passed = 1", (cid,))
    samples, d = [], start
    while d < today:
        samples.append(d)
        d += timedelta(days=7)
    samples.append(today)
    avg = []
    if learners:
        for d in samples:
            iso = d.isoformat()
            top: dict[tuple[int, int], int] = {}
            for r in rows:
                if (r["updated_at"] or "") <= iso and r["topic_id"] in by_topic:
                    k = (r["learner_id"], r["topic_id"])
                    top[k] = max(top.get(k, 0), r["level"])
            pos = sum(by_topic[t]["passages"] * min(lv, fasttrack.QUIZ_LEVEL) / fasttrack.QUIZ_LEVEL for (_, t), lv in top.items())
            avg.append({"date": iso, "pct": _pct(pos / len(learners), total)})

    pace = principal.pacing(cid)
    slots_left = pace.get("slots_left") or 0
    at = best
    remaining = max(0, total - at)
    span = max(1, (exam - start).days)
    should_be = min(100.0, round(100 * max(0, (today - start).days) / span, 1))
    held = sorted({d for d, _ in events if d <= today.isoformat()})
    per_class = round(at / len(held), 1) if held else 0.0
    needed_per_class = round(remaining / slots_left, 1) if slots_left else None
    weak = db.q("SELECT t.title, COUNT(*) AS n FROM mastery m JOIN topics t ON t.id = m.topic_id "
                "WHERE t.course_id = ? AND m.level <= 2 GROUP BY t.id ORDER BY n DESC LIMIT 3", (cid,))
    behind = []
    if learners:
        last = {}
        for r in rows:
            if r["topic_id"] in by_topic:
                k = (r["learner_id"], r["topic_id"])
                last[k] = max(last.get(k, 0), r["level"])
        per = {lid: 0.0 for lid in learners}
        for (lid, t), lv in last.items():
            if lid in per:
                per[lid] += by_topic[t]["passages"] * min(lv, fasttrack.QUIZ_LEVEL) / fasttrack.QUIZ_LEVEL
        names = {r["id"]: r["name"] for r in db.q("SELECT id, name FROM learners WHERE course_id = ?", (cid,))}
        cut = _pct(at, total)
        behind = [{"name": names[lid], "pct": _pct(p, total)} for lid, p in sorted(per.items(), key=lambda x: x[1])
                  if _pct(p, total) < cut][:5]
    return {
        "start": start.isoformat(), "today": today.isoformat(), "exam_date": course["exam_date"], "total": total,
        "needed": [{"date": start.isoformat(), "pct": 0.0}, {"date": course["exam_date"], "pct": 100.0}],
        "class": cls, "learners": avg,
        "facts": {"class_pct": _pct(at, total), "should_be_pct": should_be, "learner_pct": avg[-1]["pct"] if avg else None,
                  "passages_left": round(remaining), "classes_left": slots_left, "classes_held": len(held),
                  "per_class": per_class, "needed_per_class": needed_per_class,
                  "learners": len(learners), "behind": behind, "weak_topics": [w["title"] for w in weak],
                  "days_to_exam": pace.get("days_to_exam")},
    }


@router.get("/api/ft/{cid}/progress")
def api_progress(cid: int):
    return lines(cid)


@router.post("/api/ft/{cid}/progress/plan")
def api_progress_plan(cid: int, request: Request):
    data = lines(cid)
    # one plan = one action; on the public demo the gate's caps decide whether the model is used
    llm, notice = ai_gate.for_action(request.client.host if request.client else None)
    try:
        out = counsellor.catch_up_plan(data["facts"], llm)
    except Exception:                                    # noqa: BLE001 - the model failing must not lose the plan
        out = counsellor.catch_up_plan(data["facts"], LLM())
    return {**out, "notice": notice} if notice else out


# ---------------------------------------------------------------- the notes reader (View plan)

@router.get("/api/ft/{cid}/notes")
def api_notes(cid: int, topic_id: int | None = None):
    """One chapter of the course notes, section by section. With no topic, the next lesson's chapter."""
    _course(cid)
    chapters = [c for c in _chapters(cid) if c["passages"]]
    if not chapters:
        raise HTTPException(404, "This course has no notes yet")
    nxt = (facilitate.summary(cid).get("next") or {})
    next_topic = None
    if nxt.get("lesson_id"):
        row = db.one("SELECT topic_id FROM lessons WHERE id = ?", (nxt["lesson_id"],))
        next_topic = row["topic_id"] if row else None
    tid = topic_id or next_topic or chapters[0]["topic_id"]
    k = next((i for i, c in enumerate(chapters) if c["topic_id"] == tid), None)
    if k is None:
        raise HTTPException(404, "Chapter not found")
    ch = chapters[k]
    sections: list[dict] = []
    for p in db.q("SELECT id, doc_title, section, page, text FROM passages WHERE course_id = ? AND chapter = ? "
                  "ORDER BY id", (cid, ch["title"])):
        name = fasttrack.section_name(p["section"] or "")
        if not sections or sections[-1]["name"] != name:
            sections.append({"name": name, "passages": []})
        sections[-1]["passages"].append({"id": p["id"], "text": p["text"], "doc": p["doc_title"], "page": p["page"]})
    return {
        "chapter": {"topic_id": ch["topic_id"], "title": ch["title"], "passages": ch["passages"]},
        "sections": sections, "is_next": ch["topic_id"] == next_topic, "next_topic_id": next_topic,
        "continues_from": nxt.get("continues_from") if ch["topic_id"] == next_topic else None,
        "prev": chapters[k - 1]["topic_id"] if k > 0 else None,
        "next": chapters[k + 1]["topic_id"] if k + 1 < len(chapters) else None,
        "chapters": [{"topic_id": c["topic_id"], "title": c["title"], "passages": c["passages"]} for c in chapters],
    }


# ---------------------------------------------------------------- review classes

CAUGHT_UP_LEVELS = 3            # Recall and the first Explain level passed on Fast Track


def _caught_up(cid: int, topic_id: int) -> dict:
    fasttrack.ensure_tables()
    learners = db.q("SELECT id FROM learners WHERE course_id = ?", (cid,))
    passed = {r["learner_id"]: r["top"] for r in db.q(
        "SELECT learner_id, MAX(level) AS top FROM fast_track WHERE topic_id = ? AND passed = 1 GROUP BY learner_id",
        (topic_id,))}
    return {"count": sum(1 for l in learners if (passed.get(l["id"]) or 0) >= CAUGHT_UP_LEVELS),
            "of": len(learners), "levels": CAUGHT_UP_LEVELS}


@router.get("/api/ft/{cid}/classes")
def api_classes(cid: int):
    """Every recorded class, newest first, with how far it got through its chapter."""
    from .prep import _sessions, class_card, session_coverage, timeline
    _course(cid)
    out = []
    for s in _sessions(cid):
        card, cov = class_card(cid, s), session_coverage(cid, s)
        out.append({"session_id": s["id"], "lesson_id": s["lesson_id"], "topic_id": s["topic_id"], "held_on": s["held_on"],
                    "chapter": s["chapter"], "lesson": s["lesson"], "source": card["source"], "minutes": card["minutes"],
                    "present": card["present"], "register": card["register"], "lines": card["lines"],
                    "pct": cov["pct"], "furthest": cov["furthest"]})
    return {"classes": out, "timeline": timeline(cid)}


@router.get("/api/ft/{cid}/classes/{sid}")
def api_class(cid: int, sid: int):
    """One class: its transcript, the note passages it taught (numbered P1.. in chapter order), and how many
    learners are caught up on its chapter."""
    from .prep import _chapter_passages, _sessions, class_card, session_coverage
    _course(cid)
    s = next((x for x in _sessions(cid) if x["id"] == sid), None)
    if not s:
        raise HTTPException(404, "Class not found")
    cov = session_coverage(cid, s)
    passages = _chapter_passages(cid, s["chapter"])
    num = {p["id"]: k + 1 for k, p in enumerate(passages)}
    hit = {c["pid"] for c in cov["cells"] if c["level"]}
    matched_lines: dict[int, list[int]] = {}
    for e in cov["evidence"]:
        e["n"] = num.get(e["pid"])
        matched_lines.setdefault(e["line"], []).append(e["n"])
    entries = db.loads(s["entries_json"], []) or []
    from .prep import _clock
    transcript = [{"line": e.get("i", k), "at": _clock(e.get("start", 0)), "speaker": e.get("speaker", ""),
                   "text": e.get("text", ""), "cites": sorted(set(matched_lines.get(e.get("i", k), [])))}
                  for k, e in enumerate(entries)]
    return {"class": class_card(cid, s), "topic_id": s["topic_id"], "coverage": cov, "transcript": transcript,
            "notes": [{"n": num[p["id"]], "pid": p["id"], "section": fasttrack.section_name(p.get("section") or ""),
                       "text": p["text"], "taught": p["id"] in hit} for p in passages],
            "caught_up": _caught_up(cid, s["topic_id"])}
