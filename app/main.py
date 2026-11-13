"""Staffroom web app: FastAPI back end for the teacher dashboard."""

import json
import queue
from datetime import date
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, db, demo, devnotes, mode, events, facilitate, fasttrack, orchestrator
from .agents import librarian, observer, principal
from .integrations import clickup
from .integrations.meet import Meet, MeetError
from .integrations.moodle import Moodle, MoodleError
from .llm import DEFAULT_BASE_URL, DEFAULT_MODEL, get_llm

STATIC = Path(__file__).resolve().parent / "static"
app = FastAPI(title="Staffroom", version=__version__)
app.mount("/static", StaticFiles(directory=STATIC), name="static")
from . import connectors  # noqa: E402 - Meet, Moodle and ClickUp for Fast Track (/api/connectors, /lms/launch)
app.include_router(connectors.router)


@app.on_event("startup")
def _bootstrap():
    mode.bootstrap()                    # demo course + sample class on a fresh or demo deployment


def _writable():
    if mode.public():
        raise HTTPException(403, "Settings are read-only on this public demo.")


@app.middleware("http")
async def dev_notes_button(request: Request, call_next):
    """Every HTML page gets the floating Note button (one shared script), unless notes are off."""
    resp = await call_next(request)
    if mode.public() or not devnotes.enabled() or not resp.headers.get("content-type", "").startswith("text/html"):
        return resp
    body = b"".join([chunk async for chunk in resp.body_iterator])
    if b"/static/dev-notes.js" not in body and b"</body>" in body:
        body = body.replace(b"</body>", devnotes.script_tag() + b"</body>", 1)
    headers = {k: v for k, v in resp.headers.items() if k.lower() not in ("content-length", "etag")}
    return Response(body, status_code=resp.status_code, headers=headers, media_type=resp.media_type)

# Fast Track is the React app in web/ (build it with `npm run build` there). Its assets live under
# /fast-track/assets; the earlier plain-JS app stays reachable at /fast-track-classic as a fallback.
WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
app.mount("/fast-track/assets", StaticFiles(directory=WEB_DIST / "assets", check_dir=False), name="fast-track-assets")

SECRET_KEYS = {"nebius_api_key", "clickup_token", "google_access_token", "moodle_token"}
SETTING_KEYS = SECRET_KEYS | {"nebius_base_url", "nebius_model", "clickup_team_id", "moodle_url", "as_of_date"}


@app.get("/")
def home():
    return RedirectResponse("/fast-track/login")


@app.get("/staffroom")
def staffroom_board():
    """The original teacher dashboard (agents board, course plan, class report)."""
    return FileResponse(STATIC / "index.html")


def _react_index():
    index = WEB_DIST / "index.html"
    if not index.is_file():   # not built yet: fall back to the classic app rather than a 404
        return RedirectResponse("/fast-track-classic")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})   # always pick up a new build


@app.get("/fast-track")
@app.get("/fast-track/")
@app.get("/fast-track/login")
@app.get("/fast-track/settings")
def fast_track_page():
    return _react_index()


@app.get("/fast-track-classic")
def fast_track_classic():
    return FileResponse(STATIC / "ft" / "index.html")


@app.get("/fast-track-classic/login")
def fast_track_classic_login():
    return FileResponse(STATIC / "ft" / "login.html")


@app.get("/lms")
def lms_page():
    return FileResponse(STATIC / "lms" / "index.html")


@app.get("/api/health")
def health():
    llm = get_llm()
    course = db.one("SELECT title FROM courses ORDER BY id LIMIT 1")
    return {"ok": True, "version": __version__, "llm": {"online": llm.online, "label": llm.label},
            "mode": {"demo": mode.demo(), "public": mode.public()}, "course": course["title"] if course else None}


# ---------------------------------------------------------------- helpers

def _course(cid: int) -> dict:
    c = db.one("SELECT * FROM courses WHERE id = ?", (cid,))
    if not c:
        raise HTTPException(404, "Course not found")
    return c


def _mask(v: str) -> str:
    """A saved secret is never sent back: at most its first 3 and last 4 characters."""
    return (v[:3] + "…" + v[-4:]) if v and len(v) >= 16 else ("••••" if v else "")


def _integrations(course: dict | None = None) -> dict:
    return {
        "clickup": bool(db.get_setting("clickup_token")),
        "clickup_course": bool(course and clickup.course_lists(course)),
        "meet": bool(db.get_setting("google_access_token")),
        "moodle": bool(db.get_setting("moodle_url") and db.get_setting("moodle_token")),
    }


# ---------------------------------------------------------------- state

@app.get("/api/courses")
def courses():
    return db.q("SELECT id, title, subject, grade FROM courses ORDER BY id DESC")


@app.get("/api/state/{cid}")
def state(cid: int):
    course = _course(cid)
    llm = get_llm()
    topics = db.q("SELECT * FROM topics WHERE course_id = ? ORDER BY seq", (cid,))
    lessons = db.q("SELECT l.id, l.seq, l.title, l.topic_id, l.planned_date, l.status, l.verdict, l.examiner_rounds, "
                   "l.taught_on, l.clickup_task_id, (l.plan_json IS NOT NULL) AS has_plan, t.title AS topic "
                   "FROM lessons l LEFT JOIN topics t ON t.id = l.topic_id WHERE l.course_id = ? ORDER BY l.seq",
                   (cid,))
    learners = db.q("SELECT * FROM learners WHERE course_id = ? ORDER BY name", (cid,))
    last_session = db.one("SELECT * FROM sessions WHERE course_id = ? AND report_json IS NOT NULL "
                          "ORDER BY id DESC LIMIT 1", (cid,))
    last = {}
    if last_session:
        for p in db.q("SELECT * FROM participation WHERE session_id = ?", (last_session["id"],)):
            last[p["learner_id"]] = p
    for l in learners:
        p = last.get(l["id"])
        l["last_label"] = p["label"] if p else None
        l["last_score"] = p["score"] if p else None
        l["mastery"] = {m["topic_id"]: m["level"] for m in
                        db.q("SELECT topic_id, level FROM mastery WHERE learner_id = ?", (l["id"],))}
    flags = db.q("SELECT f.*, l.name FROM flags f JOIN learners l ON l.id = f.learner_id "
                 "WHERE f.course_id = ? AND f.status = 'Open' ORDER BY f.id DESC", (cid,))
    for f in flags:
        f["targets"] = db.loads(f.pop("topics_json"), [])
        f["evidence"] = db.loads(f.pop("evidence_json"), [])
    tests = db.q("SELECT t.id, t.title, t.status, t.verdict, t.examiner_rounds, t.learner_id, t.clickup_task_id, "
                 "t.questions_json, t.plan_json, t.created_at, l.name FROM tests t LEFT JOIN learners l "
                 "ON l.id = t.learner_id WHERE t.course_id = ? ORDER BY t.id DESC", (cid,))
    for t in tests:
        t["questions"] = len(db.loads(t.pop("questions_json"), []))
        t["targets"] = db.loads(t.pop("plan_json"), [])
    sessions = db.q("SELECT s.id, s.lesson_id, s.held_on, s.source, (s.report_json IS NOT NULL) AS has_report, "
                    "l.title AS lesson FROM sessions s LEFT JOIN lessons l ON l.id = s.lesson_id "
                    "WHERE s.course_id = ? ORDER BY s.id DESC", (cid,))
    course["slot_days"] = db.loads(course["slot_days"], [])
    course["clickup_lists"] = db.loads(course["clickup_lists"], {})
    return {
        "course": course, "llm": {"online": llm.online, "label": llm.label},
        "integrations": _integrations(db.one("SELECT * FROM courses WHERE id = ?", (cid,))),
        "pacing": principal.pacing(cid), "topics": topics, "lessons": lessons, "learners": learners,
        "flags": flags, "tests": tests, "sessions": sessions,
        "documents": db.q("SELECT d.id, d.title, d.kind, COUNT(p.id) AS passages FROM documents d "
                          "LEFT JOIN passages p ON p.document_id = d.id WHERE d.course_id = ? GROUP BY d.id", (cid,)),
        "jobs": db.q("SELECT id, kind, status, started, finished FROM jobs WHERE course_id = ? "
                     "ORDER BY id DESC LIMIT 5", (cid,)),
    }


@app.get("/api/lessons/{lid}")
def lesson(lid: int):
    l = db.one("SELECT l.*, t.title AS topic FROM lessons l LEFT JOIN topics t ON t.id = l.topic_id WHERE l.id = ?",
               (lid,))
    if not l:
        raise HTTPException(404, "Lesson not found")
    for k in ("plan_json", "passages_json", "review_json"):
        l[k.replace("_json", "")] = db.loads(l.pop(k), None)
    return l


@app.get("/api/tests/{tid}")
def test(tid: int):
    t = db.one("SELECT t.*, l.name FROM tests t LEFT JOIN learners l ON l.id = t.learner_id WHERE t.id = ?", (tid,))
    if not t:
        raise HTTPException(404, "Test not found")
    for k in ("plan_json", "questions_json", "passages_json", "review_json"):
        t[k.replace("_json", "")] = db.loads(t.pop(k), None)
    return t


@app.get("/api/sessions/{sid}")
def session(sid: int):
    s = db.one("SELECT s.*, l.title AS lesson FROM sessions s LEFT JOIN lessons l ON l.id = s.lesson_id "
               "WHERE s.id = ?", (sid,))
    if not s:
        raise HTTPException(404, "Session not found")
    for k in ("entries_json", "attendance_json", "report_json"):
        s[k.replace("_json", "")] = db.loads(s.pop(k), None)
    return s


@app.get("/api/learners/{lid}")
def learner(lid: int):
    l = db.one("SELECT * FROM learners WHERE id = ?", (lid,))
    if not l:
        raise HTTPException(404, "Learner not found")
    l["mastery"] = db.q("SELECT m.*, t.title, t.seq FROM mastery m JOIN topics t ON t.id = m.topic_id "
                        "WHERE m.learner_id = ? ORDER BY t.seq", (lid,))
    l["participation"] = db.q("SELECT p.*, s.held_on, le.title AS lesson FROM participation p "
                              "JOIN sessions s ON s.id = p.session_id LEFT JOIN lessons le ON le.id = s.lesson_id "
                              "WHERE p.learner_id = ? ORDER BY s.id DESC", (lid,))
    l["flags"] = db.q("SELECT * FROM flags WHERE learner_id = ? ORDER BY id DESC", (lid,))
    l["tests"] = db.q("SELECT id, title, status, verdict FROM tests WHERE learner_id = ? ORDER BY id DESC", (lid,))
    return l


@app.get("/api/passages/{pid}")
def passage(pid: int):
    p = db.one("SELECT * FROM passages WHERE id = ?", (pid,))
    if not p:
        raise HTTPException(404, "Passage not found")
    return p


# ---------------------------------------------------------------- courses and content

@app.post("/api/courses")
def create_course(title: str = Form(...), subject: str = Form(""), grade: str = Form(""), teacher: str = Form(""),
                  term_start: str = Form(...), exam_date: str = Form(...), slot_days: str = Form("0,2,4"),
                  slot_minutes: int = Form(45), syllabus: str = Form(...)):
    llm = get_llm()
    topics = principal.parse_syllabus(syllabus, llm)
    if not topics:
        raise HTTPException(400, "Couldn't find topics. Use lines like: 1. Topic title (45 min) | keywords: a, b")
    days = [int(x) for x in slot_days.split(",") if x.strip().isdigit()]
    cid = db.insert("courses", title=title, subject=subject, grade=grade, curriculum="", teacher=teacher,
                    term_start=term_start, exam_date=exam_date, slot_days=db.dumps(days), slot_minutes=slot_minutes)
    for i, t in enumerate(topics, 1):
        db.insert("topics", course_id=cid, seq=i, title=t["title"], minutes=t["minutes"], keywords=t["keywords"])
    return {"course_id": cid, "topics": len(topics)}


@app.post("/api/courses/{cid}/documents")
async def upload_document(cid: int, file: UploadFile = File(...)):
    _course(cid)
    data = await file.read()
    doc_id, n = librarian.ingest_file(cid, file.filename or "notes.md", data)
    return {"document_id": doc_id, "passages": n}


@app.post("/api/courses/{cid}/learners")
def add_learner(cid: int, name: str = Form(...), email: str = Form("")):
    _course(cid)
    return {"learner_id": db.insert("learners", course_id=cid, name=name.strip(), email=email.strip(), consent=1)}


@app.post("/api/courses/{cid}/moodle/import")
def moodle_import(cid: int, moodle_course_id: int = Body(..., embed=True)):
    _course(cid)
    url, token = db.get_setting("moodle_url"), db.get_setting("moodle_token")
    if not (url and token):
        raise HTTPException(400, "Add the Moodle site and token in Settings first")
    try:
        people = Moodle(url, token).enrolled_learners(moodle_course_id)
    except (MoodleError, Exception) as e:
        raise HTTPException(502, f"Moodle: {e}")
    have = {r["name"].lower() for r in db.q("SELECT name FROM learners WHERE course_id = ?", (cid,))}
    added = 0
    for p in people:
        if p["name"].lower() not in have:
            db.insert("learners", course_id=cid, name=p["name"], email=p["email"], consent=1)
            added += 1
    return {"added": added, "found": len(people)}


# ---------------------------------------------------------------- agent jobs

@app.post("/api/courses/{cid}/plan")
def plan(cid: int):
    _course(cid)
    return {"job_id": orchestrator.start_job("plan_course", cid, orchestrator.job_plan_course, cid)}


@app.post("/api/lessons/{lid}/prepare")
def prepare(lid: int):
    l = db.one("SELECT course_id FROM lessons WHERE id = ?", (lid,))
    if not l:
        raise HTTPException(404, "Lesson not found")
    return {"job_id": orchestrator.start_job("prepare_lesson", l["course_id"], orchestrator.job_prepare_lesson, lid)}


def _next_lesson(cid: int) -> dict:
    l = db.one("SELECT * FROM lessons WHERE course_id = ? AND status = 'Planned' ORDER BY seq LIMIT 1", (cid,))
    if not l:
        raise HTTPException(400, "Every lesson is already taught")
    return l


def _new_session(cid: int, lesson_id: int | None, entries, attendance, source: str, held_on: str | None) -> int:
    lesson_id = lesson_id or _next_lesson(cid)["id"]
    return db.insert("sessions", course_id=cid, lesson_id=lesson_id, source=source,
                     held_on=held_on or principal.today_for(cid).isoformat(),
                     entries_json=db.dumps(entries), attendance_json=db.dumps(attendance))


@app.post("/api/courses/{cid}/sessions")
async def upload_class(cid: int, transcript: UploadFile = File(...), attendance: UploadFile | None = File(None),
                       lesson_id: int | None = Form(None), held_on: str | None = Form(None)):
    _course(cid)
    entries = observer.parse_transcript((await transcript.read()).decode("utf-8", errors="replace"))
    if not entries:
        raise HTTPException(400, "Couldn't read any lines from that transcript")
    att = observer.parse_attendance((await attendance.read()).decode("utf-8", errors="replace")) if attendance else []
    sid = _new_session(cid, lesson_id, entries, att, "upload", held_on)
    return {"session_id": sid, "job_id": orchestrator.start_job("process_class", cid,
                                                                orchestrator.job_process_class, sid)}


@app.post("/api/courses/{cid}/sessions/meet")
def meet_class(cid: int, meeting_code: str = Body(..., embed=True), lesson_id: int | None = Body(None, embed=True)):
    course = _course(cid)
    token = db.get_setting("google_access_token")
    if not token:
        raise HTTPException(400, "Add a Google access token in Settings first")
    try:
        entries, att, rec = Meet(token).class_data(meeting_code.strip() or course.get("meet_code") or "")
    except MeetError as e:
        raise HTTPException(502, str(e))
    sid = _new_session(cid, lesson_id, entries, att, f"meet:{rec.get('name', '')}", (rec.get("startTime") or "")[:10])
    return {"session_id": sid, "job_id": orchestrator.start_job("process_class", cid,
                                                                orchestrator.job_process_class, sid)}


@app.post("/api/courses/{cid}/tests")
def make_test(cid: int, learner_id: int = Body(..., embed=True), topic_ids: list[int] = Body(..., embed=True)):
    _course(cid)
    targets = []
    for tid in topic_ids:
        t = db.one("SELECT * FROM topics WHERE id = ?", (tid,))
        m = db.one("SELECT level FROM mastery WHERE learner_id = ? AND topic_id = ?", (learner_id, tid))
        lvl = m["level"] if m else 2
        targets.append({"topic_id": tid, "topic": t["title"], "keywords": t["keywords"] or "", "mastery": lvl,
                        "level": min(5, lvl + 1)})
    return {"job_id": orchestrator.start_job("build_test", cid, orchestrator.build_test, cid, learner_id, targets)}


@app.post("/api/tests/{tid}/{action}")
def decide_test(tid: int, action: str):
    if action not in ("approve", "reject"):
        raise HTTPException(404)
    t = db.one("SELECT * FROM tests WHERE id = ?", (tid,))
    if not t:
        raise HTTPException(404, "Test not found")
    status = "Approved" if action == "approve" else "Rejected"
    db.update("tests", tid, status=status)
    events.emit(None, "Teacher", "pass" if action == "approve" else "reject",
                f"{t['title']} {status.lower()} by the teacher" + (": released to the learner" if action == "approve" else ""))
    course = db.one("SELECT * FROM courses WHERE id = ?", (t["course_id"],))
    if t["clickup_task_id"] and clickup.connected(course):
        cu, lists = clickup.client(), clickup.course_lists(course)
        st = clickup.pick_status(clickup.statuses(cu, lists["tests"]), "closed")
        try:
            cu.update_task(t["clickup_task_id"], status=st)
            cu.comment(t["clickup_task_id"], f"{status} in Staffroom by the teacher.")
        except Exception as e:  # don't fail the teacher's click on a sync problem
            events.emit(None, "ClickUp", "warn", f"Couldn't update ClickUp: {e}")
    return {"status": status}


@app.post("/api/lessons/{lid}/check")
def check_claim(lid: int, text: str = Body(..., embed=True)):
    """Try to trick the Examiner: check any statement against this lesson's passages."""
    l = db.one("SELECT passages_json FROM lessons WHERE id = ?", (lid,))
    passages = db.loads(l["passages_json"], []) if l else []
    if not passages:
        raise HTTPException(400, "Prepare the lesson first so the Examiner has its passages")
    from .agents import examiner
    from .events import Emitter
    return examiner.check_claim(text, passages, get_llm(), Emitter(None))


@app.post("/api/flags/{fid}/done")
def flag_done(fid: int):
    db.update("flags", fid, status="Done")
    return {"ok": True}


# ---------------------------------------------------------------- ClickUp

@app.post("/api/courses/{cid}/clickup/setup")
def clickup_setup(cid: int):
    _course(cid)
    try:
        out = clickup.setup_course(cid)
    except Exception as e:
        raise HTTPException(502, str(e))
    events.emit(None, "ClickUp", "sync", "Created the course Space with Lesson plan, Learner follow-ups and "
                "Tests: needs approval lists", out)
    return out


@app.get("/api/clickup/teams")
def clickup_teams():
    cu = clickup.client()
    if not cu:
        raise HTTPException(400, "Add a ClickUp token first")
    try:
        return [{"id": str(t["id"]), "name": t.get("name")} for t in cu.teams()]
    except Exception as e:
        raise HTTPException(502, str(e))


@app.post("/api/courses/{cid}/clickup/sync")
def clickup_sync(cid: int):
    _course(cid)
    return {"job_id": orchestrator.start_job("sync_clickup", cid, orchestrator.job_sync_clickup, cid)}


@app.post("/api/clickup/webhook")
def clickup_webhook(payload: dict = Body(...)):
    task_id = str(payload.get("task_id") or "")
    t = db.one("SELECT * FROM tests WHERE clickup_task_id = ?", (task_id,)) if task_id else None
    if t and t["status"] == "Needs approval":
        orchestrator.start_job("sync_clickup", t["course_id"], orchestrator.job_sync_clickup, t["course_id"])
    return {"ok": True}


# ---------------------------------------------------------------- settings

@app.get("/api/settings")
def get_settings():
    out = {}
    for k in sorted(SETTING_KEYS):
        v = db.get_setting(k)
        out[k] = _mask(v) if k in SECRET_KEYS else v
    return out


@app.post("/api/settings")
def save_settings(values: dict = Body(...)):
    _writable()
    for k, v in values.items():
        if k not in SETTING_KEYS:
            continue
        v = (v or "").strip()
        if k in SECRET_KEYS and (not v or "•" in v or "…" in v):
            continue                                  # unchanged masked value
        db.set_setting(k, v)
    return get_settings()


# The AI model the agents use. One source of truth: the same nebius_* settings /staffroom writes.
MODEL_PRESETS = {
    "deepseek": {"label": "DeepSeek", "base_url": "https://api.deepseek.com", "model": "deepseek-chat"},
    "openai": {"label": "OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    "nebius": {"label": "Nebius", "base_url": DEFAULT_BASE_URL, "model": DEFAULT_MODEL},
}


def _scrub(msg: str, key: str) -> str:
    """Remove a key (whole, or any long piece of it, or anything shaped like a key) from a provider message."""
    import re
    msg = str(msg or "")
    if key:
        for n in range(len(key), 7, -1):            # longest pieces first
            for i in range(0, len(key) - n + 1):
                if key[i:i + n] in msg:
                    msg = msg.replace(key[i:i + n], "…")
    return re.sub(r"(?:sk|gsk|pk|rk)[-_][A-Za-z0-9_\-]{6,}", "…", msg)


def _model_settings() -> dict:
    llm = get_llm()
    key = db.get_setting("nebius_api_key")
    provider = next((k for k, v in MODEL_PRESETS.items() if v["base_url"].rstrip("/") == llm.base_url.rstrip("/")), "custom")
    return {"provider": provider, "base_url": llm.base_url, "model": llm.model, "has_key": bool(key),
            "key_hint": _mask(key), "online": llm.online, "presets": MODEL_PRESETS, "read_only": mode.public()}


@app.get("/api/settings/model")
def model_settings():
    return _model_settings()


@app.post("/api/settings/model")
def save_model_settings(values: dict = Body(...)):
    _writable()
    preset = MODEL_PRESETS.get(values.get("provider") or "")
    base = (values.get("base_url") or (preset or {}).get("base_url") or "").strip()
    model = (values.get("model") or (preset or {}).get("model") or "").strip()
    if base:
        db.set_setting("nebius_base_url", base)
    if model:
        db.set_setting("nebius_model", model)
    key = (values.get("api_key") or "").strip()
    if key and "…" not in key and "•" not in key:
        db.set_setting("nebius_api_key", key)
    if values.get("clear_key"):
        db.set_setting("nebius_api_key", "")
    return _model_settings()


@app.post("/api/settings/model/test")
def test_model(values: dict = Body(default={})):
    """One tiny call to the model. Uses the values on the form if given, otherwise the saved ones.
    Errors come back as the provider's message with any key scrubbed out."""
    if mode.public():
        values = {}                     # public demo: only the server's own (env) key can be tested
    import time as _t
    from .llm import LLM
    saved = get_llm()
    key = (values.get("api_key") or "").strip()
    if not key or "…" in key or "•" in key:
        key = saved.api_key
    llm = LLM(api_key=key, base_url=(values.get("base_url") or saved.base_url).strip(),
              model=(values.get("model") or saved.model).strip())
    if not key:
        return {"ok": False, "error": "No API key saved yet."}
    t0 = _t.time()
    try:
        reply = llm.chat("Reply with the single word OK.", "Say OK.", max_tokens=5, temperature=0)
    except Exception as e:                                      # noqa: BLE001 - shown to the user
        return {"ok": False, "error": _scrub(getattr(e, "message", None) or e, key)[:400], "model": llm.model}
    return {"ok": True, "ms": round((_t.time() - t0) * 1000), "model": llm.model, "reply": (reply or "")[:40]}


# Known OpenAI-compatible providers, tried in this order by Detect (a key prefix moves its provider first).
DETECT_BASES = [("deepseek", "DeepSeek", "https://api.deepseek.com"), ("openai", "OpenAI", "https://api.openai.com/v1"),
                ("openrouter", "OpenRouter", "https://openrouter.ai/api/v1"), ("groq", "Groq", "https://api.groq.com/openai/v1"),
                ("nebius", "Nebius", DEFAULT_BASE_URL), ("nebius-studio", "Nebius AI Studio", "https://api.studio.nebius.com/v1")]
KEY_HINTS = [("sk-or-", "openrouter"), ("gsk_", "groq"), ("sk-proj-", "openai")]
PREFERRED = ["deepseek-chat", "gpt-4o-mini", "gpt-4.1-mini", "llama-3.3-70b-versatile", "llama-3.1-8b-instant",
             "deepseek/deepseek-chat", "meta-llama/Llama-3.3-70B-Instruct", DEFAULT_MODEL]
NOT_FOR_AGENTS = ("reasoner", "embed", "whisper", "tts", "dall-e", "moderation", "audio", "image", "transcribe", "realtime", "search")


def _rank_models(ids: list[str]) -> tuple[list[dict], str]:
    models = [{"id": m, "recommended": not any(x in m.lower() for x in NOT_FOR_AGENTS)} for m in sorted(set(ids))]
    for m in models:
        if not m["recommended"]:
            m["note"] = "not recommended: no JSON mode" if "reasoner" in m["id"].lower() else "not recommended: not a chat model"
    ok = [m["id"] for m in models if m["recommended"]]
    pick = next((p for p in PREFERRED if p in ok), None) or next((m for m in ok if "chat" in m or "instruct" in m.lower() or "mini" in m), None)
    return models, pick or (ok[0] if ok else (models[0]["id"] if models else ""))


@app.post("/api/settings/model/detect")
def detect_model(values: dict = Body(default={})):
    """Find which provider a key belongs to by listing its models (GET {base}/models, 5 s per probe).
    The key comes from the form or the saved setting and is never returned or logged."""
    import httpx
    key = (values.get("api_key") or "").strip()
    if not key or "…" in key or "•" in key or mode.public():
        key = get_llm().api_key
    if not key:
        return {"ok": False, "error": "Paste an API key first."}
    want = values.get("provider") or "auto"
    bases = DETECT_BASES
    if want not in ("auto", "custom", ""):
        bases = [b for b in DETECT_BASES if b[0] == want] or bases
    elif want == "custom" and values.get("base_url"):
        bases = [("custom", "Custom", values["base_url"].strip())]
    else:
        hint = next((p for pre, p in KEY_HINTS if key.startswith(pre)), None)
        if hint:
            bases = sorted(bases, key=lambda b: b[0] != hint)
    errors = []
    for pid, label, base in bases:
        try:
            r = httpx.get(base.rstrip("/") + "/models", headers={"Authorization": f"Bearer {key}"}, timeout=5)
        except httpx.HTTPError as e:
            errors.append(f"{label}: {type(e).__name__}")
            continue
        if r.status_code == 200:
            try:
                ids = [m.get("id") for m in (r.json().get("data") or []) if m.get("id")]
            except ValueError:
                ids = []
            if pid == "deepseek" and "deepseek-chat" not in ids:
                ids.append("deepseek-chat")     # DeepSeek's documented chat alias; not always listed
            models, pick = _rank_models(ids)
            return {"ok": True, "provider": pid if pid in MODEL_PRESETS else "custom", "label": label,
                    "base_url": base, "models": models, "default": pick}
        msg = ""
        try:
            body = r.json()
            msg = (body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else body.get("error") or body.get("message") or ""
        except ValueError:
            msg = r.text[:120]
        errors.append(f"{label}: {r.status_code} {_scrub(msg, key)[:140]}".strip())
    return {"ok": False, "error": "No provider accepted this key. " + "; ".join(errors)[:600]}


@app.post("/api/settings/clear/{key}")
def clear_setting(key: str):
    _writable()
    if key not in SETTING_KEYS:
        raise HTTPException(404)
    db.set_setting(key, "")
    return {"ok": True}


# ---------------------------------------------------------------- events

@app.get("/api/events")
def recent_events(limit: int = 200, job_id: int | None = None):
    return events.recent(limit, job_id)


@app.get("/api/jobs/{job_id}")
def job(job_id: int):
    j = db.one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if not j:
        raise HTTPException(404)
    j["result"] = db.loads(j.pop("result_json"), {})
    return j


@app.get("/api/events/stream")
def stream():
    qu = events.subscribe()

    def gen():
        try:
            yield "retry: 2000\n\n"
            while True:
                try:
                    ev = qu.get(timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            events.unsubscribe(qu)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- Fast Track (student game)

@app.get("/api/ft/courses")
def ft_courses():
    return db.q("SELECT c.id, c.title, COUNT(DISTINCT t.id) AS chapters FROM courses c "
                "JOIN topics t ON t.course_id = c.id WHERE EXISTS (SELECT 1 FROM passages p WHERE p.course_id = c.id) "
                "GROUP BY c.id ORDER BY c.id DESC")


@app.get("/api/ft/{cid}/chapters")
def ft_chapters(cid: int, learner_id: int | None = None):
    _course(cid)
    counts = {r["chapter"]: r["n"] for r in db.q("SELECT chapter, COUNT(*) AS n FROM passages WHERE course_id = ? "
                                                  "GROUP BY chapter", (cid,))}
    learners = db.q("SELECT id, name, email FROM learners WHERE course_id = ? ORDER BY id", (cid,))
    for l in learners:                      # the level each profile is on: floors cleared across chapters
        prog = fasttrack.chapter_progress(l["id"], cid)
        l["level"] = sum(max([n for n, v in lv.items() if v["passed"] and n <= 10] or [0]) for lv in prog.values())
        l["sample"] = (l.pop("email") or "").endswith("@sample.demo")
    if learner_id and not any(l["id"] == learner_id for l in learners):
        learner_id = None
    prog = fasttrack.chapter_progress(learner_id, cid) if learner_id else {}
    mastery = {m["topic_id"]: m["level"] for m in db.q("SELECT topic_id, level FROM mastery WHERE learner_id = ?",
                                                       (learner_id,))} if learner_id else {}
    chapters = [{"id": t["id"], "seq": t["seq"], "title": t["title"], "passages": counts.get(t["title"], 0),
                 "levels": prog.get(t["id"], {}), "mastery": mastery.get(t["id"])}
                for t in db.q("SELECT * FROM topics WHERE course_id = ? ORDER BY seq", (cid,))]
    return {"course": _course(cid)["title"], "learners": learners, "learner_id": learner_id,
            "stats": fasttrack.learner_stats(learner_id) if learner_id else None,
            "chapters": [c for c in chapters if c["passages"]], "skills": fasttrack.SKILLS,
            "blurbs": fasttrack.LEVEL_BLURB, "quiz_level": fasttrack.QUIZ_LEVEL}


@app.get("/api/ft/{cid}/board")
def ft_board(cid: int):
    """Class view for the facilitator and the LMS gradebook: each learner's climb, XP and quiz marks."""
    _course(cid)
    fasttrack.ensure_tables()
    topics = db.q("SELECT id, seq, title FROM topics WHERE course_id = ? ORDER BY seq", (cid,))
    out = []
    for l in db.q("SELECT id, name, email FROM learners WHERE course_id = ? ORDER BY id", (cid,)):
        prog = fasttrack.chapter_progress(l["id"], cid)
        st = fasttrack.learner_stats(l["id"])
        chapters = {}
        for tid, lv in prog.items():
            top = max([n for n, v in lv.items() if v["passed"] and n <= 10] or [0])
            q = lv.get(fasttrack.QUIZ_LEVEL)
            chapters[tid] = {"top": top, "quiz": round(100 * q["best"] / q["total"]) if q and q["total"] else None}
        out.append({"id": l["id"], "name": l["name"], "sample": (l["email"] or "").endswith("@sample.demo"),
                    "xp": st["xp"], "streak": st["streak"], "best_streak": st["best_streak"],
                    "answered": st["answered"], "correct": st["correct"], "sure_wrong": st["sure_wrong"],
                    "sure_right": st["sure_right"], "levels": sum(c["top"] for c in chapters.values()),
                    "chapters": chapters,
                    "mastery": {m["topic_id"]: m["level"] for m in db.q(
                        "SELECT topic_id, level FROM mastery WHERE learner_id = ?", (l["id"],))}})
    return {"topics": topics, "learners": out}


@app.get("/api/ft/{cid}/facilitator")
def ft_facilitator(cid: int):
    """Coverage, where the class stopped, the next lesson, and each learner's track plan."""
    _course(cid)
    return facilitate.summary(cid)


@app.get("/api/ft/{cid}/student/{lid}")
def ft_student(cid: int, lid: int):
    """The student landing: how far through, what was missed, what to do next, what is ready to test."""
    _course(cid)
    if not db.one("SELECT 1 FROM learners WHERE id = ? AND course_id = ?", (lid, cid)):
        raise HTTPException(404, "Learner not found")
    return facilitate.student_view(cid, lid)


@app.post("/api/lessons/{lid}/progress")
def lesson_progress(lid: int, stopped_section: str | None = Body(None, embed=True), finished: bool = Body(False, embed=True)):
    """Record where today's class stopped. A finished lesson counts as taught."""
    l = db.one("SELECT course_id FROM lessons WHERE id = ?", (lid,))
    if not l:
        raise HTTPException(404, "Lesson not found")
    return facilitate.record_progress(lid, stopped_section, finished, principal.today_for(l["course_id"]))


@app.post("/api/lessons/{lid}/approve")
def lesson_approve(lid: int):
    l = db.one("SELECT course_id FROM lessons WHERE id = ?", (lid,))
    if not l:
        raise HTTPException(404, "Lesson not found")
    try:
        return facilitate.approve_plan(lid, principal.today_for(l["course_id"]))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/ft/{cid}/actions")
def ft_action(cid: int, learner_id: int = Body(..., embed=True), kind: str = Body(..., embed=True),
              detail: dict = Body({}, embed=True)):
    """Queue a pace-based action (catch-up path or early release). It waits for teacher approval."""
    _course(cid)
    if not db.one("SELECT 1 FROM learners WHERE id = ? AND course_id = ?", (learner_id, cid)):
        raise HTTPException(404, "Learner not found")
    try:
        return {"action_id": facilitate.queue_action(cid, learner_id, kind, detail), "status": "Pending approval"}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/ft/{cid}/learner")
def ft_learner(cid: int, name: str = Body(..., embed=True)):
    _course(cid)
    name = name.strip()[:60]
    if not name:
        raise HTTPException(400, "Type your name")
    have = db.one("SELECT id FROM learners WHERE course_id = ? AND lower(name) = lower(?)", (cid, name))
    lid = have["id"] if have else db.insert("learners", course_id=cid, name=name, email="", consent=1)
    return {"learner_id": lid, "name": name}


@app.get("/api/ft/topic/{tid}/level/{level}")
def ft_level(tid: int, level: int, seed: int = 0):
    if not 1 <= level <= fasttrack.QUIZ_LEVEL:
        raise HTTPException(404, "No such level")
    out = fasttrack.build_level(tid, level, seed)
    if not out:
        raise HTTPException(404, "Chapter not found")
    if not out["questions"]:
        raise HTTPException(400, "This chapter is too short to build questions from")
    return out


@app.post("/api/ft/topic/{tid}/level/{level}/result")
def ft_result(tid: int, level: int, learner_id: int = Body(..., embed=True), answers: list[dict] = Body(..., embed=True)):
    t = db.one("SELECT * FROM topics WHERE id = ?", (tid,))
    l = db.one("SELECT * FROM learners WHERE id = ?", (learner_id,))
    if not t or not l or l["course_id"] != t["course_id"]:
        raise HTTPException(404, "Learner or chapter not found")
    if not 1 <= level <= fasttrack.QUIZ_LEVEL or not answers:
        raise HTTPException(400, "Nothing to save")
    return fasttrack.record(learner_id, tid, level, answers, principal.today_for(t["course_id"]))


# ---------------------------------------------------------------- demo

def _delete_course(cid: int) -> None:
    """Remove one course and everything that hangs off it. Other courses are left alone."""
    learners = "SELECT id FROM learners WHERE course_id = ?"
    db.run("DELETE FROM participation WHERE session_id IN (SELECT id FROM sessions WHERE course_id = ?)", (cid,))
    db.run(f"DELETE FROM scores WHERE learner_id IN ({learners})", (cid,))
    db.run(f"DELETE FROM mastery WHERE learner_id IN ({learners})", (cid,))
    db.run("DELETE FROM events WHERE job_id IN (SELECT id FROM jobs WHERE course_id = ?)", (cid,))
    for table in ("tests", "flags", "sessions", "lessons", "learners", "topics", "passages", "documents", "jobs"):
        db.run(f"DELETE FROM {table} WHERE course_id = ?", (cid,))
    db.run("DELETE FROM courses WHERE id = ?", (cid,))
    db.run("INSERT INTO passages_fts(passages_fts) VALUES ('rebuild')")


DEMO_TITLE = "Network Security Fundamentals"


@app.post("/api/demo/seed")
def demo_seed(reset: bool = False):
    """Load the demo course. reset=true rebuilds only the demo course; the school's own courses stay."""
    existing = db.q("SELECT id FROM courses WHERE title = ? ORDER BY id DESC", (DEMO_TITLE,))
    if existing and not reset:
        return {"course_id": existing[0]["id"], "created": False}
    for c in existing:
        _delete_course(c["id"])
    if reset:
        db.run("DELETE FROM events WHERE job_id IS NULL")
    return {"course_id": demo.seed(), "created": True}


@app.delete("/api/courses/{cid}")
def delete_course(cid: int):
    _course(cid)
    _delete_course(cid)
    return {"ok": True}


def _job_demo(emit, cid: int) -> dict:
    lesson = _next_lesson(cid)
    emit("Staffroom", "start", f"Demo: preparing today's lesson, then reading the recorded class "
         f"(“{lesson['title']}”)")
    orchestrator.job_prepare_lesson(emit, lesson["id"])
    vtt, csv_text = demo.demo_class()
    sid = _new_session(cid, lesson["id"], observer.parse_transcript(vtt), observer.parse_attendance(csv_text),
                       "demo upload", None)
    emit("Staffroom", "handoff", "Class finished. Transcript and register uploaded from Google Meet (demo file)")
    return orchestrator.job_process_class(emit, sid)


@app.post("/api/demo/run/{cid}")
def demo_run(cid: int):
    _course(cid)
    return {"job_id": orchestrator.start_job("demo", cid, _job_demo, cid)}


@app.post("/api/demo/class/{cid}")
def demo_class(cid: int):
    _course(cid)
    vtt, csv_text = demo.demo_class()
    sid = _new_session(cid, None, observer.parse_transcript(vtt), observer.parse_attendance(csv_text),
                       "demo upload", None)
    return {"session_id": sid, "job_id": orchestrator.start_job("process_class", cid,
                                                                orchestrator.job_process_class, sid)}


@app.get("/api/demo/files/{name}")
def demo_file(name: str):
    allowed = {"class-firewalls.vtt", "attendance-firewalls.csv", "syllabus.md"}
    if name not in allowed:
        raise HTTPException(404)
    return FileResponse(demo.DEMO / name, filename=name)


# --- dev notes: live feedback from the Note button --------------------------------------------
@app.get("/api/dev-notes")
def dev_notes_list():
    return {"enabled": devnotes.enabled() and not mode.public(), "notes": devnotes.list_notes()}


@app.post("/api/dev-notes")
def dev_notes_create(data: dict = Body(...)):
    if mode.public():
        raise HTTPException(403, "Notes are off on the public demo.")
    try:
        return devnotes.create(data)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/dev-notes/{nid}")
def dev_notes_get(nid: int):
    n = devnotes.get(nid)
    if not n:
        raise HTTPException(404, "No such note")
    return n


@app.patch("/api/dev-notes/{nid}")
def dev_notes_update(nid: int, data: dict = Body(...)):
    try:
        n = devnotes.update(nid, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not n:
        raise HTTPException(404, "No such note")
    return n


@app.get("/api/dev-notes/{nid}/shot.png")
def dev_notes_shot(nid: int):
    p = devnotes.shot_path(nid)
    if not p:
        raise HTTPException(404, "No screenshot")
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "no-cache"})
