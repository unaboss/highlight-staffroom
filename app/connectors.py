"""Fast Track connectors: Google Meet, Moodle (LMS) and ClickUp, as one API for the Settings page.

Each connector runs **live** when its credentials are saved in Settings (or set as env vars), and in
**demo** mode otherwise, so a demo always shows the whole loop without real accounts:

- Google Meet: pull a class's register and transcript, then score participation (the Observer and
  Counsellor agents). Demo mode uses the recorded sample class in data/demo.
- Moodle: a signed launch link opens Fast Track already signed in as the learner, on the chapter.
  Final-quiz marks go back to the gradebook (Moodle web services when live, the outbox otherwise).
- ClickUp: a flagged learner (a class-taught chapter they haven't caught up on) gets one task,
  "Fast Track: <chapter>", with their launch link inside. The task closes itself when the learner
  clears that chapter's final quiz.

Keys never leave the server: tests and errors only ever report what happened, not the key.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import RedirectResponse

from . import db, events, fasttrack, mode
from .integrations import clickup as cu_mod
from .integrations.meet import Meet, MeetError
from .integrations.moodle import Moodle, MoodleError

router = APIRouter()

# Plain (non-secret) connector options, saved by this module. Secrets stay in main's SETTING_KEYS.
CONFIG_KEYS = {"meet_code", "moodle_course_id", "moodle_activity_id", "clickup_list_id", "public_url"}
LINK_DAYS = 14                       # a ClickUp task's launch link stays valid for two weeks
SPACE_NAME = "Staffroom Fast Track"
LIST_NAME = "Fast Track follow-ups"


def ensure_tables() -> None:
    db.run("CREATE TABLE IF NOT EXISTS ft_tasks (id INTEGER PRIMARY KEY, course_id INTEGER, learner_id INTEGER, "
           "topic_id INTEGER, mode TEXT, task_id TEXT, url TEXT, name TEXT, status TEXT DEFAULT 'open', "
           "created_at TEXT, closed_at TEXT)")
    db.run("CREATE TABLE IF NOT EXISTS ft_grades (id INTEGER PRIMARY KEY, learner_id INTEGER, topic_id INTEGER, "
           "score INTEGER, max INTEGER, mode TEXT, status TEXT, detail TEXT, sent_at TEXT)")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")


def _writable() -> None:
    if mode.public():
        raise HTTPException(403, "Settings are read-only on this public demo.")


def _scrub(msg, *keys: str) -> str:
    msg = str(msg or "")
    for k in keys:
        if k and len(k) >= 6:
            msg = msg.replace(k, "…")
    return msg[:300]


def live(name: str) -> bool:
    if name == "meet":
        return bool(db.get_setting("google_access_token"))
    if name == "moodle":
        return bool(db.get_setting("moodle_url") and db.get_setting("moodle_token"))
    if name == "clickup":
        return bool(db.get_setting("clickup_token"))
    return False


def ft_course() -> dict | None:
    """The course Fast Track opens on: the Melsoft one if loaded, else the newest course with notes."""
    cs = db.q("SELECT c.id, c.title FROM courses c WHERE EXISTS (SELECT 1 FROM passages p WHERE p.course_id = c.id) "
              "ORDER BY c.id DESC")
    return next((c for c in cs if "melsoft" in c["title"].lower()), None) or (cs[0] if cs else None)


def _cid(course_id: int | None) -> int:
    if course_id:
        return int(course_id)
    c = ft_course()
    if not c:
        raise HTTPException(400, "Load a course first")
    return c["id"]


# ---------------------------------------------------------------- signed launch links (Moodle)

def _secret() -> bytes:
    s = db.get_setting("launch_secret")
    if not s:
        s = secrets.token_hex(32)
        db.set_setting("launch_secret", s)
    return s.encode()


def _sign(*parts) -> str:
    return hmac.new(_secret(), ".".join(str(p) for p in parts).encode(), hashlib.sha256).hexdigest()[:40]


def base_url(request: Request | None = None) -> str:
    b = db.get_setting("public_url")
    if b:
        return b.rstrip("/")
    if request is not None:
        return str(request.base_url).rstrip("/")
    return "http://localhost:8001"


def launch_link(course_id: int, learner_id: int, topic_id: int | None = None, days: float = LINK_DAYS,
                request: Request | None = None) -> str:
    exp = int(time.time() + days * 86400)
    t = topic_id or 0
    q = {"c": course_id, "l": learner_id, "t": t, "exp": exp, "sig": _sign(course_id, learner_id, t, exp)}
    return f"{base_url(request)}/lms/launch?{urlencode(q)}"


@router.get("/lms/launch")
def lms_launch(c: int, l: int, t: int = 0, exp: int = 0, sig: str = ""):
    """The LMS (or a ClickUp task) opens this; Fast Track starts signed in as that learner."""
    if not hmac.compare_digest(sig, _sign(c, l, t, exp)):
        raise HTTPException(403, "This launch link isn't valid. Open Fast Track from the course page again.")
    if exp < time.time():
        raise HTTPException(403, "This launch link has expired. Open Fast Track from the course page again.")
    if not db.one("SELECT 1 FROM learners WHERE id = ? AND course_id = ?", (l, c)):
        raise HTTPException(404, "Learner not found")
    who = db.one("SELECT name FROM learners WHERE id = ?", (l,))["name"]
    events.emit(None, "Moodle", "launch", f"{who} launched Fast Track from the LMS")
    frag = f"#/play/chapter/{t}" if t else "#/play"
    return RedirectResponse(f"/fast-track/?{urlencode({'role': 'student', 'learner': l})}{frag}", status_code=303)


@router.get("/api/connectors/moodle/launch-link")
def get_launch_link(request: Request, learner_id: int | None = None, topic_id: int | None = None,
                    course_id: int | None = None, minutes: int = 60):
    cid = _cid(course_id)
    if not learner_id:
        first = db.one("SELECT id FROM learners WHERE course_id = ? ORDER BY id LIMIT 1", (cid,))
        if not first:
            raise HTTPException(400, "This course has no learners yet")
        learner_id = first["id"]
    if not db.one("SELECT 1 FROM learners WHERE id = ? AND course_id = ?", (learner_id, cid)):
        raise HTTPException(404, "Learner not found")
    minutes = max(5, min(int(minutes or 60), 60 * 24 * LINK_DAYS))
    return {"url": launch_link(cid, learner_id, topic_id, minutes / 1440, request), "minutes": minutes}


# ---------------------------------------------------------------- grade passback (Moodle)

def _moodle() -> Moodle:
    return Moodle(db.get_setting("moodle_url"), db.get_setting("moodle_token"))


def push_grade(learner_id: int, topic_id: int, score: int, total: int) -> dict:
    """Send one final-quiz mark to the LMS gradebook. Live: Moodle core_grades_update_grades."""
    ensure_tables()
    learner = db.one("SELECT * FROM learners WHERE id = ?", (learner_id,)) or {}
    topic = db.one("SELECT title FROM topics WHERE id = ?", (topic_id,)) or {}
    pct = round(100 * score / total) if total else 0
    if not live("moodle"):
        status, detail, m = "sent", f"{pct}% to the demo gradebook", "demo"
    else:
        m = "live"
        course, activity = db.get_setting("moodle_course_id"), db.get_setting("moodle_activity_id")
        if not (course and activity and learner.get("email")):
            status = "queued"
            detail = ("Set the Moodle course id and activity id in Settings" if not (course and activity)
                      else "Learner has no email to match in Moodle")
        else:
            try:
                md = _moodle()
                users = md.call("core_user_get_users_by_field", field="email", **{"values[0]": learner["email"]})
                if not users:
                    raise MoodleError(f"no Moodle user with that learner's email")
                md.call("core_grades_update_grades", source="fasttrack", courseid=int(course), component="mod_lti",
                        activityid=int(activity), itemnumber=0,
                        **{"grades[0][studentid]": users[0]["id"], "grades[0][grade]": pct,
                           "itemdetails[itemname]": "Fast Track", "itemdetails[grademax]": 100})
                status, detail = "sent", f"{pct}% to Moodle"
            except Exception as e:                       # noqa: BLE001 - recorded, never blocks the quiz
                status, detail = "failed", _scrub(e, db.get_setting("moodle_token"))
    db.insert("ft_grades", learner_id=learner_id, topic_id=topic_id, score=score, max=total, mode=m,
              status=status, detail=detail, sent_at=_now())
    events.emit(None, "Moodle", "grade" if status == "sent" else "warn",
                f"{learner.get('name', 'Learner')}: {topic.get('title', 'chapter')} final quiz {pct}%, {detail}")
    return {"status": status, "detail": detail}


# ---------------------------------------------------------------- ClickUp follow-ups

def _cu() -> cu_mod.ClickUp:
    return cu_mod.ClickUp(db.get_setting("clickup_token"))


def _target_list(cu: cu_mod.ClickUp) -> str:
    """The List flagged learners go to: the one set in Settings, or a Space and List we create once."""
    lid = db.get_setting("clickup_list_id")
    if lid:
        return lid
    team = db.get_setting("clickup_team_id")
    if not team:
        teams = cu.teams()
        if not teams:
            raise cu_mod.ClickUpError("This ClickUp token can't see any Workspace")
        team = str(teams[0]["id"])
    space = next((s for s in cu.spaces(team) if s.get("name") == SPACE_NAME), None) or cu.create_space(team, SPACE_NAME)
    lst = next((l for l in cu.space_lists(str(space["id"])) if l.get("name") == LIST_NAME), None) \
        or cu.create_list(str(space["id"]), LIST_NAME)
    if not mode.public():
        db.set_setting("clickup_list_id", str(lst["id"]))
    return str(lst["id"])


def flagged(course_id: int) -> list[dict]:
    """One row per flagged learner: the earliest class-taught chapter they haven't caught up on."""
    from . import facilitate
    out = []
    for l in db.q("SELECT id, name FROM learners WHERE course_id = ? ORDER BY id", (course_id,)):
        v = facilitate.student_view(course_id, l["id"])
        if v["missed"]:
            m = v["missed"][0]
            out.append({"learner_id": l["id"], "name": l["name"], "topic_id": m["topic_id"], "title": m["title"],
                        "top": m["top"], "missed": len(v["missed"])})
    return out


def _chapter_name(title: str) -> str:
    return title.split(":", 1)[1].strip() if ":" in title else title


def open_task(course_id: int, learner_id: int, topic_id: int, request: Request | None = None) -> dict | None:
    ensure_tables()
    if db.one("SELECT 1 FROM ft_tasks WHERE learner_id = ? AND topic_id = ? AND status = 'open'", (learner_id, topic_id)):
        return None
    learner = db.one("SELECT name FROM learners WHERE id = ?", (learner_id,))
    topic = db.one("SELECT title FROM topics WHERE id = ?", (topic_id,))
    who = learner["name"].replace(" (sample)", "")
    name = f"Fast Track: {_chapter_name(topic['title'])} ({who})"
    link = launch_link(course_id, learner_id, topic_id, request=request)
    md = (f"**{who}** missed **{topic['title']}** in class and hasn't caught up in Fast Track yet.\n\n"
          f"[Open the chapter in Fast Track]({link}) (signed in as {who}, link valid {LINK_DAYS} days)\n\n"
          f"This task closes itself when {who} clears the chapter's final quiz.")
    if live("clickup"):
        cu = _cu()
        task = cu.create_task(_target_list(cu), name, md, tags=["fast-track"])
        tid, url, m = str(task["id"]), task.get("url") or f"https://app.clickup.com/t/{task['id']}", "live"
    else:
        tid = "demo-" + secrets.token_hex(3)
        url, m = link, "demo"
    db.insert("ft_tasks", course_id=course_id, learner_id=learner_id, topic_id=topic_id, mode=m, task_id=tid,
              url=url, name=name, status="open", created_at=_now())
    events.emit(None, "ClickUp", "sync", f"Opened task “{name}”" + (" (demo)" if m == "demo" else ""))
    return {"task_id": tid, "name": name, "url": url, "mode": m}


def close_tasks(learner_id: int, topic_id: int) -> int:
    """The learner cleared the chapter's final quiz: close its follow-up task(s)."""
    ensure_tables()
    n = 0
    for t in db.q("SELECT * FROM ft_tasks WHERE learner_id = ? AND topic_id = ? AND status = 'open'", (learner_id, topic_id)):
        if t["mode"] == "live":
            try:
                cu = _cu()
                lst = (cu.get_task(t["task_id"]).get("list") or {}).get("id")
                st = cu_mod.pick_status(cu_mod.statuses(cu, str(lst)), "closed") if lst else None
                cu.update_task(t["task_id"], **({"status": st} if st else {}))
                cu.comment(t["task_id"], "Cleared the final quiz in Fast Track. Closed automatically.")
            except Exception as e:                       # noqa: BLE001 - keep the local state honest
                events.emit(None, "ClickUp", "warn", f"Couldn't close “{t['name']}”: "
                            f"{_scrub(e, db.get_setting('clickup_token'))}")
                continue
        db.run("UPDATE ft_tasks SET status = 'closed', closed_at = ? WHERE id = ?", (_now(), t["id"]))
        events.emit(None, "ClickUp", "sync", f"Closed “{t['name']}”: final quiz cleared")
        n += 1
    return n


def sync_clickup(course_id: int, request: Request | None = None) -> dict:
    ensure_tables()
    fasttrack.ensure_tables()
    opened, errors = [], []
    for f in flagged(course_id):
        try:
            t = open_task(course_id, f["learner_id"], f["topic_id"], request)
            if t:
                opened.append(t)
        except Exception as e:                           # noqa: BLE001 - one failure shouldn't stop the rest
            errors.append(_scrub(e, db.get_setting("clickup_token")))
            if len(errors) >= 2:
                break
    closed = 0
    passed = {(r["learner_id"], r["topic_id"]) for r in db.q(
        "SELECT learner_id, topic_id FROM fast_track WHERE level = ? AND passed", (fasttrack.QUIZ_LEVEL,))}
    for t in db.q("SELECT learner_id, topic_id FROM ft_tasks WHERE course_id = ? AND status = 'open'", (course_id,)):
        if (t["learner_id"], t["topic_id"]) in passed:
            closed += close_tasks(t["learner_id"], t["topic_id"])
    return {"opened": len(opened), "closed": closed, "errors": errors, "tasks": tasks(course_id)}


def tasks(course_id: int) -> list[dict]:
    ensure_tables()
    return db.q("SELECT t.id, t.learner_id, l.name AS learner, t.topic_id, t.name, t.mode, t.url, t.status, "
                "t.created_at, t.closed_at FROM ft_tasks t JOIN learners l ON l.id = t.learner_id "
                "WHERE t.course_id = ? ORDER BY (t.status = 'open') DESC, t.id DESC LIMIT 50", (course_id,))


# ---------------------------------------------------------------- hooks from the game

def on_result(learner_id: int, topic_id: int, level: int, correct: int, total: int, passed: bool) -> None:
    """Called after every saved Fast Track level. Only the final quiz talks to the connectors.
    Runs in the background so a slow LMS or ClickUp never holds up the student's result screen."""
    if level != fasttrack.QUIZ_LEVEL:
        return

    def work():
        try:
            push_grade(learner_id, topic_id, correct, total)
            if passed:
                close_tasks(learner_id, topic_id)
        except Exception as e:                           # noqa: BLE001
            events.emit(None, "Connectors", "warn", f"After the final quiz: {type(e).__name__}")

    threading.Thread(target=work, daemon=True).start()


# ---------------------------------------------------------------- Google Meet

def import_meet(course_id: int, meeting_code: str = "") -> dict:
    from . import demo, main, orchestrator
    from .agents import observer
    code = (meeting_code or db.get_setting("meet_code") or "").strip()
    if live("meet"):
        if not code:
            raise HTTPException(400, "Type the class's Meet code (like abc-defg-hij)")
        try:
            entries, att, rec = Meet(db.get_setting("google_access_token")).class_data(code)
        except MeetError as e:
            raise HTTPException(502, _scrub(e, db.get_setting("google_access_token")))
        source, held = f"meet:{rec.get('name', '')}", (rec.get("startTime") or "")[:10] or None
    else:
        vtt, csv_text = demo.demo_class()
        entries, att = observer.parse_transcript(vtt), observer.parse_attendance(csv_text)
        source, held = "meet:demo", None
    sid = main._new_session(course_id, None, entries, att, source, held)
    events.emit(None, "Google Meet", "handoff", f"Pulled {len(att)} attendees and {len(entries)} transcript lines"
                + (" (demo class)" if source == "meet:demo" else f" from Meet {code}"))
    job = orchestrator.start_job("process_class", course_id, orchestrator.job_process_class, sid)
    return {"session_id": sid, "job_id": job, "attendees": len(att), "lines": len(entries),
            "mode": "demo" if source == "meet:demo" else "live"}


# ---------------------------------------------------------------- tests

def test(name: str) -> dict:
    t0 = time.time()
    ms = lambda: round((time.time() - t0) * 1000)      # noqa: E731
    if not live(name):
        return {"ok": True, "mode": "demo", "message": "No credentials saved, so this runs in demo mode with sample data."}
    try:
        if name == "meet":
            tok = db.get_setting("google_access_token")
            r = httpx.get("https://meet.googleapis.com/v2/conferenceRecords", params={"pageSize": 1},
                          headers={"Authorization": f"Bearer {tok}"}, timeout=10)
            if r.status_code >= 400:
                msg = (r.json().get("error") or {}).get("message", "") if r.headers.get("content-type", "").startswith("application/json") else ""
                return {"ok": False, "mode": "live", "message": f"Google said {r.status_code}. {_scrub(msg, tok)}".strip()}
            n = len(r.json().get("conferenceRecords", []))
            return {"ok": True, "mode": "live", "ms": ms(),
                    "message": "Token works. " + ("Found recent Meet calls." if n else "No finished calls yet.")}
        if name == "moodle":
            info = _moodle().call("core_webservice_get_site_info")
            fns = {f.get("name") for f in info.get("functions", [])}
            need = [f for f in ("core_enrol_get_enrolled_users", "core_grades_update_grades") if fns and f not in fns]
            return {"ok": True, "mode": "live", "ms": ms(),
                    "message": f"Connected to {info.get('sitename', 'Moodle')} as {info.get('fullname', 'the token user')}."
                    + (f" Missing permission for: {', '.join(need)}." if need else "")}
        if name == "clickup":
            teams = _cu().teams()
            return {"ok": True, "mode": "live", "ms": ms(),
                    "message": f"Token works. Workspace: {teams[0]['name'] if teams else 'none visible'}."}
    except Exception as e:                               # noqa: BLE001 - shown to the user
        keys = [db.get_setting(k) for k in ("google_access_token", "moodle_token", "clickup_token")]
        return {"ok": False, "mode": "live", "message": _scrub(e, *keys)}
    raise HTTPException(404, "Unknown connector")


# ---------------------------------------------------------------- API

def status(course_id: int | None = None) -> dict:
    ensure_tables()
    c = ft_course() if not course_id else db.one("SELECT id, title FROM courses WHERE id = ?", (course_id,))
    cid = c["id"] if c else None
    tk = tasks(cid) if cid else []
    grades = db.q("SELECT g.*, l.name AS learner, t.title AS chapter FROM ft_grades g "
                  "JOIN learners l ON l.id = g.learner_id JOIN topics t ON t.id = g.topic_id ORDER BY g.id DESC LIMIT 8")
    last_meet = db.one("SELECT id, source, held_on, created_at FROM sessions WHERE source LIKE 'meet:%' "
                       "ORDER BY id DESC LIMIT 1")
    return {
        "read_only": mode.public(),
        "course": c,
        "config": {k: db.get_setting(k) for k in sorted(CONFIG_KEYS)},
        "meet": {"mode": "live" if live("meet") else "demo", "last": last_meet},
        "moodle": {"mode": "live" if live("moodle") else "demo", "grades": grades,
                   "learners": db.q("SELECT id, name FROM learners WHERE course_id = ? ORDER BY id", (cid,)) if cid else [],
                   "chapters": db.q("SELECT id, title FROM topics WHERE course_id = ? ORDER BY seq", (cid,)) if cid else []},
        "clickup": {"mode": "live" if live("clickup") else "demo", "tasks": tk,
                    "open": sum(1 for t in tk if t["status"] == "open"),
                    "closed": sum(1 for t in tk if t["status"] == "closed"),
                    "flagged": len(flagged(cid)) if cid else 0},
    }


@router.get("/api/connectors")
def api_status(course_id: int | None = None):
    return status(course_id)


@router.post("/api/connectors/config")
def api_config(values: dict = Body(...)):
    _writable()
    for k, v in values.items():
        if k in CONFIG_KEYS:
            db.set_setting(k, str(v or "").strip())
    return status()


@router.post("/api/connectors/{name}/test")
def api_test(name: str):
    if name not in ("meet", "moodle", "clickup"):
        raise HTTPException(404, "Unknown connector")
    return test(name)


@router.post("/api/connectors/meet/import")
def api_meet_import(meeting_code: str = Body("", embed=True), course_id: int | None = Body(None, embed=True)):
    return import_meet(_cid(course_id), meeting_code)


@router.post("/api/connectors/clickup/sync")
def api_clickup_sync(request: Request, course_id: int | None = Body(None, embed=True)):
    return sync_clickup(_cid(course_id), request)
