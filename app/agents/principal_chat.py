"""Principal chat: the facilitator asks the school's Principal what is going on in the class.

The Principal answers from a brief built in code from the course's own data (pacing, coverage,
where the class stopped, learner track plans, open flags and tests). With a model saved in
Settings the model words the answer from that brief only; with no model the Principal still
answers the common questions from the same facts, so the chat never invents progress.
"""

from .. import db, facilitate
from . import principal

MAX_TURNS = 12              # conversation turns sent to the model
MAX_CHARS = 2000            # per message from the browser

SYSTEM = """You are the Principal of Classroom Fast Track, a background school that prepares learners
for an exam. You speak to the facilitator (the teacher) in a short, warm, direct voice, like a good
principal on a walk-through: say what is fine, what needs attention, and the one next step.
Answer ONLY from the school brief below. If the brief does not contain the answer, say you don't
have that information yet and say where the facilitator could record it. Never invent learners,
dates, scores or numbers. Keep answers under 120 words unless asked for detail. Plain text, short
lists are fine. Learners marked (sample) are demo profiles, not real learners."""


def _course_id(course_id: int | None) -> int | None:
    if course_id and db.one("SELECT 1 FROM courses WHERE id = ?", (course_id,)):
        return course_id
    rows = db.q("SELECT id, title FROM courses ORDER BY id DESC")
    pick = next((r for r in rows if "melsoft" in (r["title"] or "").lower()), rows[0] if rows else None)
    return pick["id"] if pick else None


def facts(course_id: int) -> dict:
    """Everything the Principal knows about one class, computed from the database."""
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    pace = principal.pacing(course_id) or {}
    try:
        fac = facilitate.summary(course_id)
    except Exception:                               # noqa: BLE001 - a course without lessons still gets a brief
        fac = {"coverage": None, "stopped": None, "next": None, "tracks": []}
    flags = db.q("SELECT f.reason, f.created_at, l.name FROM flags f JOIN learners l ON l.id = f.learner_id "
                 "WHERE f.course_id = ? AND f.status = 'Open' ORDER BY f.id DESC LIMIT 15", (course_id,))
    tests = db.q("SELECT t.title, t.status, t.verdict, l.name FROM tests t LEFT JOIN learners l ON l.id = t.learner_id "
                 "WHERE t.course_id = ? ORDER BY t.id DESC LIMIT 15", (course_id,))
    sessions = db.q("SELECT s.held_on, s.source, l.title AS lesson FROM sessions s LEFT JOIN lessons l ON l.id = s.lesson_id "
                    "WHERE s.course_id = ? ORDER BY s.id DESC LIMIT 5", (course_id,))
    return {"course": {"id": course["id"], "title": course["title"], "term_start": course["term_start"],
                       "exam_date": course["exam_date"]},
            "pacing": {k: v for k, v in pace.items() if k not in ("forecast", "at_risk_ids")},
            "coverage": fac.get("coverage"), "stopped": fac.get("stopped"), "next": fac.get("next"),
            "tracks": fac.get("tracks") or [], "flags": flags, "tests": tests, "sessions": sessions}


def brief(f: dict) -> str:
    """The facts as a compact text brief for the model."""
    c, p, cov = f["course"], f["pacing"], f["coverage"] or {}
    out = [f"Course: {c['title']} (term from {c['term_start']}, exam {c['exam_date']})"]
    if p.get("total"):
        out.append(f"Today: {p['today']}. Days to exam: {p['days_to_exam']}. Lessons: {p['taught']} of {p['total']} taught, "
                   f"{p['lessons_left']} left, {p['slots_left']} timetable slots left before the exam. "
                   f"Lessons due by today: {p['due_by_today']} (behind schedule by {p['behind_schedule']}). "
                   f"Forecast finish: {p['eta'] or 'unknown'}. "
                   + (f"{p['shortfall']} lesson(s) land after the exam: {', '.join(p['at_risk'][:8])}."
                      if p.get("shortfall") else "Every lesson fits before the exam."))
    else:
        out.append("No lessons planned yet.")
    if cov:
        out.append(f"Exam content covered: {cov['pct']}% ({cov['chapters_covered']} of {cov['chapters_total']} chapters touched).")
    s = f["stopped"]
    if s:
        out.append(f"Last class ({s.get('date') or 'date not recorded'}) stopped at {s['chapter']}"
                   + (f", section {s['section']}" if s.get("section") else "")
                   + (" (chapter finished)." if s.get("finished") else " (chapter part-taught)."))
    else:
        out.append("No class progress recorded yet.")
    n = f["next"]
    if n:
        out.append(f"Next lesson: {n['title']}" + (f", continuing from {n['continues_from']}" if n.get("continues_from") else "")
                   + (". Plan approved." if n.get("approved") else ". Plan not approved yet."))
    tracks = f["tracks"]
    if tracks:
        out.append("Learner track plans (name: chapters done/total, pace per week, forecast finish, status):")
        for t in tracks[:40]:
            out.append(f"- {t['name']}{' (sample)' if t['sample'] else ''}: {t['chapters_done']}/{t['chapters_total']}, "
                       f"{t['pace_per_week']}/wk, finish {t['eta'] or 'not started'}, {t['status']}"
                       + (f", pending: {', '.join(a['kind'] for a in t['actions'])}" if t.get("actions") else ""))
    else:
        out.append("No learners enrolled yet.")
    out.append("Open flags: " + ("; ".join(f"{x['name']}: {x['reason']}" for x in f["flags"]) if f["flags"] else "none."))
    out.append("Tests: " + ("; ".join(f"{x['title']} for {x['name'] or 'class'} ({x['status']})" for x in f["tests"])
                            if f["tests"] else "none drafted."))
    if f["sessions"]:
        out.append("Recent classes: " + "; ".join(f"{x['held_on'] or '?'} {x['lesson'] or ''} ({x['source']})" for x in f["sessions"]))
    return "\n".join(out)


def _status_line(f: dict) -> str:
    p = f["pacing"]
    if not p.get("total"):
        return "There's no lesson plan yet, so I can't judge pace. Plan the term first."
    if p.get("shortfall"):
        return (f"We're tight: {p['shortfall']} lesson(s) land after the exam on {p['exam_date']}, "
                f"forecast finish {p['eta']}. Next step: decide which lessons to merge or move to Fast Track.")
    return f"We're on track: {p['lessons_left']} lessons left for {p['slots_left']} slots, forecast finish {p['eta']}."


def offline_answer(question: str, f: dict) -> str:
    """No model: answer the usual questions straight from the facts."""
    q = question.lower()
    p, cov, tracks = f["pacing"], f["coverage"] or {}, f["tracks"]
    real = [t for t in tracks if not t["sample"]] or tracks
    if any(w in q for w in ("behind", "risk", "struggl", "late", "who", "learner", "student", "pupil")):
        late = [t for t in real if t["status"] in ("late", "risk")]
        if not real:
            return "No learners are enrolled yet."
        if not late:
            return f"All {len(real)} learners are on pace for the exam. Keep an eye on the ready-to-test chapters."
        names = ", ".join(f"{t['name']} ({t['status']}, {t['chapters_done']}/{t['chapters_total']} chapters)" for t in late[:8])
        return f"{len(late)} of {len(real)} learners need attention: {names}. Next step: queue a catch-up for them."
    if any(w in q for w in ("flag", "concern", "issue", "problem", "worr")):
        if not f["flags"]:
            return "No open flags. Nothing has been raised about any learner."
        return "Open flags: " + "; ".join(f"{x['name']}: {x['reason']}" for x in f["flags"][:6]) + "."
    if any(w in q for w in ("test", "quiz", "assess", "approv")):
        waiting = [t for t in f["tests"] if t["status"] not in ("Approved", "Rejected")]
        if not f["tests"]:
            return "No tests have been drafted yet."
        return (f"{len(waiting)} test(s) waiting for you: " + "; ".join(f"{t['title']} for {t['name'] or 'the class'}" for t in waiting[:6])
                if waiting else f"All {len(f['tests'])} tests are decided. Nothing waiting.")
    if any(w in q for w in ("next", "tomorrow", "plan", "lesson", "stop", "where")):
        s, n = f["stopped"], f["next"]
        parts = []
        if s:
            parts.append(f"The last class stopped at {s['chapter']}" + (f" ({s['section']})" if s.get("section") else "") + ".")
        if n:
            parts.append(f"Next up is {n['title']}" + (f", continuing from {n['continues_from']}" if n.get("continues_from") else "")
                         + (". The plan is approved." if n.get("approved") else ". The plan still needs your approval."))
        return " ".join(parts) or "Nothing is planned yet."
    if any(w in q for w in ("cover", "progress", "how far", "percent", "syllabus")):
        return (f"{cov.get('pct', 0)}% of the exam content is covered, {cov.get('chapters_covered', 0)} of "
                f"{cov.get('chapters_total', 0)} chapters touched. {_status_line(f)}")
    # pace, exam, overview, hello, anything else
    lead = f"{f['course']['title']}: {p.get('days_to_exam', '?')} days to the exam. " if p.get("total") else ""
    return (lead + _status_line(f) + " Ask me about learners at risk, flags, tests waiting, or the next lesson."
            + " (No model is saved in Settings, so I'm answering from the records only.)")


def chat(course_id: int | None, messages: list[dict], llm) -> dict:
    cid = _course_id(course_id)
    clean = [{"role": "assistant" if m.get("role") == "assistant" else "user",
              "content": str(m.get("content") or "")[:MAX_CHARS]} for m in (messages or []) if str(m.get("content") or "").strip()]
    if not clean or clean[-1]["role"] != "user":
        raise ValueError("Ask the Principal a question")
    if cid is None:
        return {"reply": "There's no class in the school yet. Add a course first and I'll keep an eye on it.",
                "online": False, "course_id": None}
    f = facts(cid)
    if not llm.online:
        return {"reply": offline_answer(clean[-1]["content"], f), "online": False, "course_id": cid}
    system = "/no_think\n" + SYSTEM + "\n\nSCHOOL BRIEF\n" + brief(f)
    reply = llm.converse(system, clean[-MAX_TURNS:], max_tokens=600, temperature=0.3)
    return {"reply": reply or _status_line(f), "online": True, "course_id": cid, "model": llm.model}


# ---------------------------------------------------------------- streaming (Vercel AI SDK UI message stream)

def ui_messages(messages: list[dict]) -> list[dict]:
    """AI SDK UIMessages ({role, parts: [{type: "text", text}]}) or plain {role, content} to {role, content}."""
    out = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        text = m.get("content")
        if not isinstance(text, str):
            text = "".join(str(p.get("text") or "") for p in m.get("parts") or []
                           if isinstance(p, dict) and p.get("type") == "text")
        out.append({"role": m.get("role") or "user", "content": text})
    return out


def records_used(f: dict) -> list[str]:
    """Which of the class's records the brief was built from, for the "records used" tool part."""
    p, out = f["pacing"], []
    if p.get("total"):
        out.append(f"Pacing: {p['taught']} of {p['total']} lessons taught")
    if f.get("coverage"):
        out.append(f"Coverage: {f['coverage'].get('pct', 0)}% of exam content")
    if f.get("stopped"):
        out.append(f"Last class: stopped at {f['stopped'].get('chapter')}")
    if f.get("next"):
        out.append(f"Next lesson: {f['next'].get('title')}")
    out.append(f"Learner track plans: {len(f['tracks'])}")
    out.append(f"Open flags: {len(f['flags'])}")
    out.append(f"Tests: {len(f['tests'])}")
    if f.get("sessions"):
        out.append(f"Recent classes: {len(f['sessions'])}")
    return out


def _chunks(text: str):
    import re as _re
    yield from (t for t in _re.findall(r"\S+\s*|\s+", text or "") if t)


def stream_parts(course_id: int | None, messages: list[dict], llm, notice: str | None = None, scrub=lambda s: s):
    """Yields AI SDK UI message stream parts (dicts): a tool call naming the records read, then the
    answer as text deltas (token by token from the model; word by word offline), then finish."""
    import uuid
    clean = [{"role": "assistant" if m.get("role") == "assistant" else "user",
              "content": str(m.get("content") or "")[:MAX_CHARS]} for m in ui_messages(messages)
             if str(m.get("content") or "").strip()]
    msg_id, text_id, call_id = f"msg-{uuid.uuid4().hex[:12]}", "t1", f"call-{uuid.uuid4().hex[:10]}"
    yield {"type": "start", "messageId": msg_id}
    if notice:
        yield {"type": "data-notice", "data": {"text": notice}}
    cid = _course_id(course_id)
    f = facts(cid) if cid else None
    yield {"type": "start-step"}
    yield {"type": "tool-input-start", "toolCallId": call_id, "toolName": "read_school_records", "dynamic": True}
    yield {"type": "tool-input-available", "toolCallId": call_id, "toolName": "read_school_records", "dynamic": True,
           "input": {"course_id": cid}}
    yield {"type": "tool-output-available", "toolCallId": call_id,
           "output": {"course": f["course"]["title"] if f else None, "records": records_used(f) if f else []}}
    yield {"type": "finish-step"}
    yield {"type": "start-step"}
    yield {"type": "text-start", "id": text_id}
    stream = None
    if not clean or clean[-1]["role"] != "user":
        answer = "Ask the Principal a question."
    elif not f:
        answer = "There's no class in the school yet. Add a course first and I'll keep an eye on it."
    elif not llm.online:
        answer = offline_answer(clean[-1]["content"], f)
    else:
        answer = None
        system = "/no_think\n" + SYSTEM + "\n\nSCHOOL BRIEF\n" + brief(f)
        stream = llm.converse_stream(system, clean[-MAX_TURNS:], max_tokens=600, temperature=0.3)
    if stream is not None:
        sent = False
        try:
            for delta in stream:
                sent = True
                yield {"type": "text-delta", "id": text_id, "delta": delta}
        except Exception as e:                       # noqa: BLE001 - provider error: fall back to the records
            if not sent:
                answer = offline_answer(clean[-1]["content"], f)
            yield {"type": "data-notice", "data": {"text": scrub(str(e))[:300]}, "transient": True}
        if not sent and answer is None:
            answer = _status_line(f)
    if answer:
        for piece in _chunks(answer):
            yield {"type": "text-delta", "id": text_id, "delta": piece}
    yield {"type": "text-end", "id": text_id}
    yield {"type": "finish-step"}
    yield {"type": "finish"}
