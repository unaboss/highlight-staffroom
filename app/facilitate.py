"""Facilitator summary for Fast Track: exam coverage, where the class stopped, per-learner track
plans with ETA and ready-to-test topics, plan approvals and queued pace actions.

Everything is computed from the course's own data (lessons, passages, Fast Track results);
nothing here invents progress. Sample learners are flagged by the caller.
"""

from datetime import date, timedelta

from . import db, fasttrack
from .agents import principal

FULL_CHAPTER = 10          # Fast Track floors that make a chapter "done" for pace
READY_FLOOR = 2            # a topic unlocks for testing once Recall (floors 1-2) is cleared


def ensure_tables() -> None:
    fasttrack.ensure_tables()
    db.run("CREATE TABLE IF NOT EXISTS ft_lesson_state (lesson_id INTEGER PRIMARY KEY, stopped_section TEXT, "
           "approved INTEGER DEFAULT 0, approved_at TEXT, updated_at TEXT)")
    db.run("CREATE TABLE IF NOT EXISTS ft_actions (id INTEGER PRIMARY KEY, course_id INTEGER, learner_id INTEGER, "
           "kind TEXT, detail_json TEXT, status TEXT DEFAULT 'Pending approval', created_at TEXT DEFAULT CURRENT_TIMESTAMP)")


def _section(s: str | None) -> str:
    return fasttrack.section_name(s or "")


def chapter_sections(course_id: int, chapter: str) -> list[str]:
    """Sections of a chapter in reading order."""
    out: list[str] = []
    for r in db.q("SELECT section FROM passages WHERE course_id = ? AND chapter = ? ORDER BY id", (course_id, chapter)):
        s = _section(r["section"])
        if s not in out:
            out.append(s)
    return out


def record_progress(lesson_id: int, stopped_section: str | None, finished: bool, today: date) -> dict:
    """The teacher records where today's class stopped. Finished lessons count as taught."""
    ensure_tables()
    l = db.one("SELECT * FROM lessons WHERE id = ?", (lesson_id,))
    if not l:
        raise KeyError("lesson")
    if finished:
        db.update("lessons", lesson_id, status="Taught", taught_on=today.isoformat())
    db.run("INSERT INTO ft_lesson_state (lesson_id, stopped_section, updated_at) VALUES (?, ?, ?) "
           "ON CONFLICT(lesson_id) DO UPDATE SET stopped_section = excluded.stopped_section, updated_at = excluded.updated_at",
           (lesson_id, None if finished else (stopped_section or None), today.isoformat()))
    return {"lesson_id": lesson_id, "finished": finished, "stopped_section": None if finished else stopped_section}


def approve_plan(lesson_id: int, today: date) -> dict:
    ensure_tables()
    if not db.one("SELECT plan_json FROM lessons WHERE id = ? AND plan_json IS NOT NULL", (lesson_id,)):
        raise ValueError("Prepare the lesson before approving it")
    db.run("INSERT INTO ft_lesson_state (lesson_id, approved, approved_at, updated_at) VALUES (?, 1, ?, ?) "
           "ON CONFLICT(lesson_id) DO UPDATE SET approved = 1, approved_at = excluded.approved_at",
           (lesson_id, today.isoformat(), today.isoformat()))
    return {"lesson_id": lesson_id, "approved": True, "approved_at": today.isoformat()}


def queue_action(course_id: int, learner_id: int, kind: str, detail: dict) -> int:
    ensure_tables()
    if kind not in ("catch_up", "release_early"):
        raise ValueError("Unknown action")
    return db.insert("ft_actions", course_id=course_id, learner_id=learner_id, kind=kind, detail_json=db.dumps(detail))


def summary(course_id: int) -> dict:
    ensure_tables()
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    today = principal.today_for(course_id)
    exam = date.fromisoformat(course["exam_date"])
    topics = db.q("SELECT id, seq, title FROM topics WHERE course_id = ? ORDER BY seq", (course_id,))
    lessons = db.q("SELECT l.*, t.title AS chapter FROM lessons l JOIN topics t ON t.id = l.topic_id "
                   "WHERE l.course_id = ? ORDER BY l.seq", (course_id,))
    state = {r["lesson_id"]: r for r in db.q("SELECT * FROM ft_lesson_state")}
    per_chapter = {r["chapter"]: r["n"] for r in db.q(
        "SELECT chapter, COUNT(*) AS n FROM passages WHERE course_id = ? GROUP BY chapter", (course_id,))}
    total_passages = sum(per_chapter.values()) or 1

    # ---- coverage and where the class stopped
    taught = [l for l in lessons if l["status"] in ("Taught", "Reviewed")]
    covered_passages = sum(per_chapter.get(l["chapter"], 0) for l in taught)
    covered_topics = {l["topic_id"] for l in taught}
    partial = next((l for l in lessons if l["status"] == "Planned" and (state.get(l["id"]) or {}).get("stopped_section")), None)
    stopped = None
    if partial:
        sec = state[partial["id"]]["stopped_section"]
        rows = db.q("SELECT section FROM passages WHERE course_id = ? AND chapter = ? ORDER BY id",
                    (course_id, partial["chapter"]))
        names = [_section(r["section"]) for r in rows]
        upto = max((i for i, s in enumerate(names) if s == sec), default=-1) + 1
        covered_passages += upto
        covered_topics.add(partial["topic_id"])
        stopped = {"lesson_id": partial["id"], "title": partial["title"], "chapter": partial["chapter"],
                   "section": sec, "finished": False, "date": state[partial["id"]]["updated_at"]}
    elif taught:
        last = max(taught, key=lambda l: (l["taught_on"] or "", l["seq"]))
        stopped = {"lesson_id": last["id"], "title": last["title"], "chapter": last["chapter"],
                   "section": (chapter_sections(course_id, last["chapter"]) or [None])[-1], "finished": True,
                   "date": last["taught_on"]}

    nxt = partial or next((l for l in lessons if l["status"] == "Planned"), None)
    next_info = None
    if nxt:
        st = state.get(nxt["id"]) or {}
        next_info = {"lesson_id": nxt["id"], "title": nxt["title"], "chapter": nxt["chapter"],
                     "continues_from": st.get("stopped_section") if nxt is partial else None,
                     "sections": chapter_sections(course_id, nxt["chapter"]),
                     "approved": bool(st.get("approved")), "approved_at": st.get("approved_at")}

    # ---- per-learner track plans
    progress = {}
    for r in db.q("SELECT f.learner_id, f.topic_id, MAX(CASE WHEN f.passed AND f.level <= 10 THEN f.level ELSE 0 END) AS top "
                  "FROM fast_track f JOIN topics t ON t.id = f.topic_id WHERE t.course_id = ? GROUP BY f.learner_id, f.topic_id",
                  (course_id,)):
        progress.setdefault(r["learner_id"], {})[r["topic_id"]] = r["top"] or 0
    first = {r["learner_id"]: r["d"] for r in db.q(
        "SELECT s.learner_id, MIN(s.taken_on) AS d FROM scores s JOIN learners l ON l.id = s.learner_id "
        "WHERE l.course_id = ? AND s.kind LIKE 'fast_track%' GROUP BY s.learner_id", (course_id,))}
    pending = {}
    for a in db.q("SELECT * FROM ft_actions WHERE course_id = ? ORDER BY id DESC", (course_id,)):
        a["detail"] = db.loads(a.pop("detail_json"), {})
        pending.setdefault(a["learner_id"], []).append(a)

    tracks = []
    title_by_id = {t["id"]: t["title"] for t in topics}
    for l in db.q("SELECT id, name, email FROM learners WHERE course_id = ? ORDER BY id", (course_id,)):
        prog = progress.get(l["id"], {})
        done = sum(min(v, FULL_CHAPTER) for v in prog.values()) / FULL_CHAPTER          # chapter-equivalents
        started = first.get(l["id"])
        weeks = max(1.0, (today - date.fromisoformat(started)).days / 7) if started else None
        pace = round(done / weeks, 2) if weeks else 0.0
        remaining = max(0.0, len(topics) - done)
        if pace > 0:
            eta = today + timedelta(days=round(remaining / pace * 7))
            status = "ok" if eta <= exam else "risk" if eta <= exam + timedelta(days=21) else "late"
        else:
            eta, status = None, "late"
        ready = [t["id"] for t in topics if t["id"] in covered_topics or prog.get(t["id"], 0) >= READY_FLOOR]
        # catch-up path: the earliest ready chapters the learner hasn't finished
        catch_up = [tid for tid in ready if prog.get(tid, 0) < FULL_CHAPTER][:3]
        next_up = next((t["id"] for t in topics if prog.get(t["id"], 0) < FULL_CHAPTER), None)
        tracks.append({
            "learner_id": l["id"], "name": l["name"], "sample": (l["email"] or "").endswith("@sample.demo"),
            "chapters_done": round(done, 1), "chapters_total": len(topics), "pace_per_week": pace,
            "eta": eta.isoformat() if eta else None, "status": status, "started": started,
            "ready": [{"topic_id": tid, "title": title_by_id[tid]} for tid in ready],
            "catch_up": [{"topic_id": tid, "title": title_by_id[tid], "top": prog.get(tid, 0)} for tid in catch_up],
            "next_topic": {"topic_id": next_up, "title": title_by_id[next_up]} if next_up else None,
            "actions": pending.get(l["id"], []),
        })

    return {
        "today": today.isoformat(), "exam_date": exam.isoformat(),
        "coverage": {"passages_total": total_passages, "passages_covered": covered_passages,
                     "pct": round(100 * covered_passages / total_passages, 1),
                     "chapters_total": len(topics), "chapters_covered": len(covered_topics)},
        "stopped": stopped, "next": next_info, "tracks": tracks,
    }


MISSED_BELOW = 4           # a class-taught chapter counts as missed until Explain (floor 4) is cleared
MASTERED_AT = 6            # a chapter counts as covered by the learner from floor 6
MIN_PER_FLOOR = 4          # rough minutes per Fast Track floor, for time estimates


def student_view(course_id: int, learner_id: int) -> dict:
    """What one learner sees on the landing: how far through, what they missed, what to do next."""
    s = summary(course_id)
    topics = db.q("SELECT id, seq, title FROM topics WHERE course_id = ? ORDER BY seq", (course_id,))
    lessons = db.q("SELECT topic_id, status FROM lessons WHERE course_id = ?", (course_id,))
    class_covered = {l["topic_id"] for l in lessons if l["status"] in ("Taught", "Reviewed")}
    if s["stopped"] and not s["stopped"]["finished"]:
        t = db.one("SELECT id FROM topics WHERE course_id = ? AND title = ?", (course_id, s["stopped"]["chapter"]))
        if t:
            class_covered.add(t["id"])
    prog = {r["topic_id"]: r for r in db.q(
        "SELECT topic_id, MAX(CASE WHEN passed AND level <= 10 THEN level ELSE 0 END) AS top, "
        "MAX(CASE WHEN level = ? AND passed THEN 1 ELSE 0 END) AS quiz FROM fast_track WHERE learner_id = ? GROUP BY topic_id",
        (fasttrack.QUIZ_LEVEL, learner_id))}
    track = next((t for t in s["tracks"] if t["learner_id"] == learner_id), None)
    chapters, missed, ahead = [], [], []
    for t in topics:
        p = prog.get(t["id"]) or {}
        top, quiz = p.get("top") or 0, bool(p.get("quiz"))
        taught = t["id"] in class_covered
        state = ("mastered" if quiz or top >= 10 else "covered" if top >= MASTERED_AT else
                 "missed" if taught and top < MISSED_BELOW else "started" if top > 0 else
                 "taught" if taught else "untaught")
        chapters.append({"topic_id": t["id"], "title": t["title"], "top": top, "quiz": quiz, "taught": taught, "state": state})
        if state == "missed":
            missed.append({"topic_id": t["id"], "title": t["title"], "top": top,
                           "minutes": (10 - top) * MIN_PER_FLOOR})
        if not taught and top >= MASTERED_AT:
            ahead.append(t["id"])
    done_share = sum(min(c["top"], 10) / 10 for c in chapters) / max(1, len(chapters))
    complete = bool(chapters) and all(c["quiz"] or c["top"] >= 10 for c in chapters)
    started = [c for c in chapters if c["state"] in ("started", "taught")]
    path = missed + [{"topic_id": c["topic_id"], "title": c["title"], "top": c["top"], "minutes": (10 - c["top"]) * MIN_PER_FLOOR}
                     for c in started if c["topic_id"] not in {m["topic_id"] for m in missed}][: max(0, 5 - len(missed))]
    queued = next((a for a in (track or {}).get("actions", []) if a["kind"] == "catch_up"), None)
    state = "done" if complete else "behind" if missed else "ahead" if ahead else "on_track"
    return {
        "state": state, "percent": round(100 * done_share, 1), "missed": missed, "ahead_by": len(ahead),
        "path": path[:5], "due": (queued or {}).get("detail", {}).get("due"), "queued_status": (queued or {}).get("status"),
        "ready": (track or {}).get("ready", []), "floors": sum(min(c["top"], 10) for c in chapters),
        "chapters": chapters, "class_covered": sorted(class_covered),
    }
