"""Lesson prep (dev note 30): the page behind "View plan" on the facilitator dashboard.

Four parts, all computed from the course's own data:

- **Timeline.** Every lesson from here to the exam, grouped by chapter, on the dates the timetable
  will really give them (lessons that no longer fit land after the exam), with how much of each
  chapter the class transcripts covered.
- **Last class.** The latest recorded class with its register and length. Its thumbnail is the Meet
  recording's own (through Google Drive) when a live token can reach it; otherwise the page draws a
  class card from the register and transcript.
- **Coverage.** Which sections of the notes the class actually covered. Matching is done in code: a
  transcript line covers a passage when it shares enough of that passage's distinctive words (words
  that are rare across the course notes). Every match keeps its transcript line as evidence, and the
  furthest section reached is mapped onto the schedule as a pace projection.
- **Deck.** The next lesson as slides, built from the Examiner-checked plan, so every bullet keeps its
  [P#] citations; the recap slide cites the class transcript as [T#]. The facilitator cuts slides or
  bullets, adds slides from other passages of the chapter, and adds openly licensed images from
  Wikimedia Commons (downloaded to the server with their credit line). Slide text is never typed in
  by hand, so every line on a slide still traces back to a source.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import FileResponse, Response

from . import db, facilitate, fasttrack
from .agents import principal
from .agents.librarian import where as _where
from .integrations.meet import Meet, MeetError
from .textutil import CITE_RE, content_words, sentences

router = APIRouter()

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
IMAGE_HOSTS = {"upload.wikimedia.org", "thumb.wikimedia.org"}
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}
IMAGE_MAX_BYTES = 8 * 1024 * 1024
# Wikimedia refuses scripted clients without a contact in the User-Agent. The contact is this app's own
# address: the public_url setting when it is set, else the address the page was opened on.
USER_AGENT = "ClassroomFastTrack/1.0 (+{contact}; lesson prep images) httpx/" + httpx.__version__
IMAGE_NAME = re.compile(r"^[a-f0-9]{20}\.(jpg|png|gif|webp)$")

COVERED, TOUCHED = "covered", "touched"


def ensure_tables() -> None:
    facilitate.ensure_tables()
    db.run("CREATE TABLE IF NOT EXISTS ft_decks (lesson_id INTEGER PRIMARY KEY, deck_json TEXT, plan_sig TEXT, "
           "updated_at TEXT)")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")


def _store(kind: str) -> Path:
    """Files the prep page keeps (downloaded images, recording thumbnails) live beside the database."""
    p = Path(db.db_path()).resolve().parent / kind
    p.mkdir(parents=True, exist_ok=True)
    return p


def _sec(s: str | None) -> str:
    return fasttrack.section_name(s or "")


def _tidy(title: str) -> str:
    """A heading fit for a slide: notes sometimes leave a bracket open ("Firewalls (e.g. packet filters")."""
    return title + ")" * max(0, title.count("(") - title.count(")"))


def _day(iso: str | None) -> str:
    try:
        d = date.fromisoformat(iso or "")
    except ValueError:
        return iso or ""
    return f"{d.day} {d.strftime('%b %Y')}"


def _split(title: str) -> dict:
    m = re.match(r"^([A-Z]{2,4}-\d+)\s+([A-Z]{1,3}\d+):\s*(.*)$", title or "")
    if m:
        return {"mod": m.group(1), "kt": m.group(2), "name": m.group(3)}
    m = re.match(r"^(Chapter\s+\d+):\s*(.*)$", title or "")
    return {"mod": "", "kt": m.group(1) if m else "", "name": m.group(2) if m else (title or "")}


def _clock(secs: float) -> str:
    s = int(max(0, secs or 0))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def _teacher(course_id: int, entries: list[dict]) -> str:
    """Who ran the class: the course's teacher if set, else whoever spoke most."""
    name = (db.one("SELECT teacher FROM courses WHERE id = ?", (course_id,)) or {}).get("teacher") or ""
    talk = Counter(e.get("speaker", "") for e in entries)
    if name and name in talk:
        return name
    return talk.most_common(1)[0][0] if talk else name


def _topic_seq(topic_id: int) -> int | None:
    t = db.one("SELECT seq FROM topics WHERE id = ?", (topic_id,))
    return t["seq"] if t else None


# ---------------------------------------------------------------- transcript to notes matching

_DF: dict[tuple, tuple[Counter, int]] = {}


def _doc_freq(course_id: int) -> tuple[Counter, int]:
    """How many passages of the course each word appears in (cached until the notes change)."""
    stamp = db.one("SELECT COUNT(*) AS n, MAX(id) AS m FROM passages WHERE course_id = ?", (course_id,))
    key = (db.db_path(), course_id, stamp["n"], stamp["m"])
    if key not in _DF:
        df: Counter = Counter()
        for r in db.q("SELECT text FROM passages WHERE course_id = ?", (course_id,)):
            df.update(set(content_words(r["text"])))
        _DF.clear()
        _DF[key] = (df, stamp["n"] or 0)
    return _DF[key]


MATCH_MIN = 3              # shared distinctive words for a transcript line to count as teaching a passage
COVER_MIN = 5              # ... and to count as covering it rather than touching on it


def _distinctive(text: str, df: Counter, n: int) -> set[str]:
    """Words of a passage that are rare across the course notes (so "security" in a security course isn't)."""
    cutoff = max(3, int((0.05 if n >= 200 else 0.12) * n))
    return {w for w in content_words(text) if len(w) > 2 and df.get(w, 0) <= cutoff}


def _chapter_passages(course_id: int, chapter: str) -> list[dict]:
    return db.q("SELECT id, chapter, section, page, doc_title, text FROM passages WHERE course_id = ? AND chapter = ? "
                "ORDER BY id", (course_id, chapter))


_MATCH: dict[tuple, dict] = {}


def match_transcript(course_id: int, chapter: str, entries: list[dict]) -> dict:
    """Which passages of one chapter a class transcript covered (cached per transcript and notes)."""
    stamp = db.one("SELECT COUNT(*) AS n, MAX(id) AS m FROM passages WHERE course_id = ?", (course_id,))
    key = (db.db_path(), course_id, chapter, stamp["n"], stamp["m"],
           hashlib.sha1(json.dumps(entries, sort_keys=True).encode()).hexdigest())
    if key not in _MATCH:
        if len(_MATCH) > 64:
            _MATCH.clear()
        _MATCH[key] = _match(course_id, chapter, entries)
    return json.loads(json.dumps(_MATCH[key]))                      # callers may change their copy


def _match(course_id: int, chapter: str, entries: list[dict]) -> dict:
    """Each transcript line votes for the single passage it is most about (rare shared words weigh more),
    so one long sentence can't light up half the chapter. Short lines from the same speaker are also
    read as a pair, since Meet often splits a sentence across two transcript entries."""
    rows = _chapter_passages(course_id, chapter)
    df, n = _doc_freq(course_id)
    keys = {p["id"]: _distinctive(p["text"], df, n) for p in rows}
    idf = {w: math.log((n + 1) / (df.get(w, 0) + 1)) for k in keys.values() for w in k}
    lines = [(e.get("i", k), set(content_words(e.get("text", ""))), e.get("speaker"), len((e.get("text") or "").split()))
             for k, e in enumerate(entries)]
    windows = [(i, w) for i, w, _, _ in lines]
    windows += [(a[0], a[1] | b[1]) for a, b in zip(lines, lines[1:]) if a[2] == b[2] and min(a[3], b[3]) < 8]
    best: dict[int, dict] = {}
    for line, words in windows:
        if len(words) < MATCH_MIN:
            continue
        scored = []
        for pid, key in keys.items():
            shared = key & words
            if len(shared) >= MATCH_MIN:
                scored.append((sum(idf[w] for w in shared), len(shared), -pid))
        if not scored:
            continue
        score, hits, neg = max(scored)
        pid = -neg
        if pid not in best or score > best[pid]["score"]:
            best[pid] = {"pid": pid, "line": line, "hits": hits, "score": round(score, 1),
                         "level": COVERED if hits >= COVER_MIN else TOUCHED}

    order: list[str] = []
    for p in rows:
        s = _sec(p["section"])
        if s not in order:
            order.append(s)
    named: dict[str, int] = {}                                       # the facilitator says the section's name
    for s in order:
        sw = set(content_words(s))
        if not sw:
            continue
        for line, words, _, _ in lines:
            if sw <= words:
                named.setdefault(s, line)
                break

    sections = []
    for s in order:
        ps = [p for p in rows if _sec(p["section"]) == s]
        hits = [best[p["id"]] for p in ps if p["id"] in best]
        covered = [h for h in hits if h["level"] == COVERED]
        state = (COVERED if covered or len(hits) >= 2 else TOUCHED if hits or s in named else "not_reached")
        sections.append({"name": s, "passages": len(ps), "matched": len(hits), "state": state,
                         "named_at": named.get(s), "lines": sorted({h["line"] for h in hits})})
    reached = [i for i, s in enumerate(sections) if s["state"] != "not_reached"]
    furthest = sections[reached[-1]]["name"] if reached else None
    upto = sum(s["passages"] for s in sections[: reached[-1] + 1]) if reached else 0
    by_line = {e.get("i", k): e for k, e in enumerate(entries)}
    last = max(best.values(), key=lambda h: h["line"], default=None)
    return {
        "chapter": chapter, "passages_total": len(rows), "upto": upto,
        "pct": round(100 * upto / len(rows)) if rows else 0,
        "matched": len(best), "sections": sections, "furthest": furthest,
        "ended_on": ({"section": _sec(next(p["section"] for p in rows if p["id"] == last["pid"])), "line": last["line"],
                      "at": _clock(by_line.get(last["line"], {}).get("start", 0))} if last else None),
        "cells": [{"pid": p["id"], "section": _sec(p["section"]), **({k: best[p["id"]][k] for k in ("line", "hits", "level")}
                                                                    if p["id"] in best else {"level": None})}
                  for p in rows],
        "lines_total": len(entries), "lines_matched": len({h["line"] for h in best.values()}),
    }


def _sessions(course_id: int) -> list[dict]:
    return db.q("SELECT s.id, s.lesson_id, s.source, s.held_on, s.created_at, s.entries_json, s.attendance_json, "
                "s.report_json, l.title AS lesson, l.topic_id, t.title AS chapter, t.seq AS chapter_seq "
                "FROM sessions s JOIN lessons l ON l.id = s.lesson_id JOIN topics t ON t.id = l.topic_id "
                "WHERE s.course_id = ? AND s.entries_json IS NOT NULL ORDER BY s.held_on DESC, s.id DESC", (course_id,))


def session_coverage(course_id: int, s: dict) -> dict:
    entries = db.loads(s["entries_json"], []) or []
    cov = match_transcript(course_id, s["chapter"], entries)
    by_line = {e.get("i", k): e for k, e in enumerate(entries)}
    ev = []
    for c in cov["cells"]:
        if c["level"]:
            e = by_line.get(c["line"]) or {}
            ev.append({"line": c["line"], "at": _clock(e.get("start", 0)), "speaker": e.get("speaker", ""),
                       "text": e.get("text", ""), "pid": c["pid"], "section": c["section"], "level": c["level"]})
    seen, evidence = set(), []
    for x in sorted(ev, key=lambda x: (x["line"], x["pid"])):
        if (x["line"], x["section"]) not in seen:
            seen.add((x["line"], x["section"]))
            evidence.append(x)
    wheres = {p["id"]: p for p in db.q("SELECT id, doc_title, section, page FROM passages WHERE id IN (%s)"
                                       % ",".join("?" * len(evidence)), tuple(x["pid"] for x in evidence))} if evidence else {}
    for x in evidence:
        x["where"] = _where(wheres.get(x["pid"], {}))
    return {**cov, "session_id": s["id"], "lesson_id": s["lesson_id"], "held_on": s["held_on"], "evidence": evidence}


# ---------------------------------------------------------------- timeline

def timeline(course_id: int, summary: dict | None = None) -> dict:
    summary = summary or facilitate.summary(course_id)
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    pace = principal.pacing(course_id)
    exam = course["exam_date"]
    forecast = pace.get("forecast") or {}
    nxt = (summary.get("next") or {}).get("lesson_id")
    partial = summary["stopped"]["lesson_id"] if summary.get("stopped") and not summary["stopped"]["finished"] else None
    rows = db.q("SELECT l.id, l.seq, l.title, l.topic_id, l.part, l.parts, l.planned_date, l.status, l.taught_on, "
                "l.verdict, (l.plan_json IS NOT NULL) AS has_plan, t.title AS chapter FROM lessons l "
                "JOIN topics t ON t.id = l.topic_id WHERE l.course_id = ? ORDER BY l.seq", (course_id,))
    counts: Counter = Counter()
    sections: dict[str, list[str]] = {}
    for r in db.q("SELECT chapter, section FROM passages WHERE course_id = ? ORDER BY id", (course_id,)):
        counts[r["chapter"]] += 1
        s = _sec(r["section"])
        if s not in sections.setdefault(r["chapter"], []):
            sections[r["chapter"]].append(s)
    # how much of each chapter the class transcripts covered (all recorded classes)
    seen: dict[str, int] = {}
    for s in _sessions(course_id):
        cov = match_transcript(course_id, s["chapter"], db.loads(s["entries_json"], []) or [])
        seen[s["chapter"]] = max(seen.get(s["chapter"], 0), cov["upto"])

    lessons, chapters = [], []
    for l in rows:
        taught = l["status"] in ("Taught", "Reviewed")
        when = l["taught_on"] if taught else forecast.get(str(l["id"])) or l["planned_date"]
        state = ("taught" if taught else "partial" if l["id"] == partial else "next" if l["id"] == nxt
                 else "after_exam" if (not when or when > exam) else "planned")
        lessons.append({"id": l["id"], "seq": l["seq"], "title": l["title"], "topic_id": l["topic_id"],
                        "part": l["part"] or 1, "parts": l["parts"] or 1, "date": when, "planned_date": l["planned_date"],
                        "state": state, "has_plan": bool(l["has_plan"]), "verdict": l["verdict"]})
        if not chapters or chapters[-1]["topic_id"] != l["topic_id"]:
            chapters.append({"topic_id": l["topic_id"], "title": l["chapter"], **_split(l["chapter"]),
                             "passages": counts.get(l["chapter"], 0), "lessons": []})
        chapters[-1]["lessons"].append(l["id"])
    by_id = {l["id"]: l for l in lessons}
    for c in chapters:
        ls = [by_id[i] for i in c["lessons"]]
        states = {l["state"] for l in ls}
        c["start"], c["end"] = ls[0]["date"], ls[-1]["date"]
        c["state"] = ("taught" if states == {"taught"} else "partial" if "partial" in states else "next" if "next" in states
                      else "after_exam" if states <= {"after_exam", "taught"} else "planned")
        c["transcript_pct"] = round(100 * seen.get(c["title"], 0) / c["passages"]) if c["passages"] else 0
        c["sections"] = sections.get(c["title"], [])
    left = [l for l in lessons if l["state"] != "taught"]
    return {"today": pace.get("today"), "exam_date": exam, "lessons": lessons, "chapters": chapters,
            "lessons_left": len(left), "before_exam": sum(1 for l in left if l["state"] != "after_exam"),
            "after_exam": sum(1 for l in left if l["state"] == "after_exam"),
            "chapters_left": sum(1 for c in chapters if c["state"] != "taught"), "eta": pace.get("eta"),
            "days_to_exam": pace.get("days_to_exam")}


# ---------------------------------------------------------------- the last class

def last_class(course_id: int) -> dict | None:
    ss = _sessions(course_id)
    return class_card(course_id, ss[0]) if ss else None


def class_card(course_id: int, s: dict) -> dict:
    """One recorded class as a card: who was there, how long, what was said last."""
    entries = db.loads(s["entries_json"], []) or []
    attendance = db.loads(s["attendance_json"], []) or []
    report = db.loads(s["report_json"], {}) or {}
    talk = Counter(e.get("speaker", "") for e in entries)
    teacher = _teacher(course_id, entries)
    t_lines = [e for e in entries if e.get("speaker") == teacher]
    span = (entries[-1].get("end", 0) - entries[0].get("start", 0)) / 60 if entries else 0
    minutes = max([a.get("minutes", 0) or 0 for a in attendance] or [report.get("class_minutes") or round(span)])
    labels = Counter(p["label"] for p in db.q("SELECT label FROM participation WHERE session_id = ?", (s["id"],)))
    src = s["source"] or ""
    kind = ("meet" if src.startswith("meet:conferenceRecords/") else "meet_demo" if src == "meet:demo"
            else "sample" if src.startswith("sample class") else "upload")
    return {
        "session_id": s["id"], "lesson_id": s["lesson_id"], "lesson": s["lesson"], "chapter": s["chapter"],
        "held_on": s["held_on"], "source": kind, "minutes": round(minutes or 0),
        "people": [{"name": a.get("name", ""), "minutes": round(a.get("minutes", 0))} for a in attendance][:24],
        "present": sum(1 for a in attendance if (a.get("minutes") or 0) > 0), "register": len(attendance),
        "lines": len(entries), "speakers": len(talk), "teacher": teacher,
        "caption": (t_lines[-1]["text"] if t_lines else (entries[-1]["text"] if entries else ""))[:180],
        "participation": dict(labels), "thumbnail": f"/api/ft/sessions/{s['id']}/thumbnail" if kind == "meet" else None,
    }


@router.get("/api/ft/sessions/{sid}/thumbnail")
def session_thumbnail(sid: int):
    """The Meet recording's thumbnail (Google Drive), cached beside the database. 404 when there is none,
    and the page draws its class card instead."""
    s = db.one("SELECT source FROM sessions WHERE id = ?", (sid,))
    src = (s or {}).get("source") or ""
    if not src.startswith("meet:conferenceRecords/"):
        raise HTTPException(404, "This class has no Meet recording")
    cached = _store("prep-thumbs") / f"session-{sid}.jpg"
    if cached.is_file():
        return FileResponse(cached, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})
    from . import google_auth
    try:
        token = google_auth.access_token()
    except google_auth.GoogleAuthError:
        token = ""
    if not token:
        raise HTTPException(404, "Meet is not connected")
    try:
        img = Meet(token).recording_thumbnail(src[len("meet:"):])
    except (MeetError, httpx.HTTPError):
        img = None
    if not img:
        raise HTTPException(404, "No recording thumbnail for this class")
    cached.write_bytes(img)
    return Response(img, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


# ---------------------------------------------------------------- pace: the transcript on the schedule

def pace_projection(course_id: int, cov: dict | None, session: dict | None) -> dict | None:
    """Map how far the last class got onto the timetable: at that pace, when would the notes be done?"""
    if not cov or not session:
        return None
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    pace = principal.pacing(course_id)
    earlier = [s for s in _sessions(course_id) if s["chapter"] == session["chapter"] and s["id"] != session["id"]
               and (s["held_on"] or "", s["id"]) < (session["held_on"] or "", session["id"])]
    start = max([match_transcript(course_id, s["chapter"], db.loads(s["entries_json"], []) or [])["upto"]
                 for s in earlier] + [0])
    advanced = max(0, cov["upto"] - start)
    totals = {r["chapter"]: r["n"] for r in db.q("SELECT chapter, COUNT(*) AS n FROM passages WHERE course_id = ? "
                                                  "GROUP BY chapter", (course_id,))}
    open_chapters = {r["chapter"] for r in db.q(
        "SELECT DISTINCT t.title AS chapter FROM lessons l JOIN topics t ON t.id = l.topic_id "
        "WHERE l.course_id = ? AND l.status NOT IN ('Taught', 'Reviewed')", (course_id,))}
    remaining = sum(totals.get(c, 0) for c in open_chapters if c != cov["chapter"]) + (cov["passages_total"] - cov["upto"])
    n_lessons = db.one("SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?", (course_id,))["n"] or 1
    plan_avg = round(sum(totals.values()) / n_lessons, 1)
    needed = math.ceil(remaining / advanced) if advanced else None
    finish = None
    if needed:
        today = principal.today_for(course_id)
        days = principal.course_days(course)
        future = principal.slots(today + timedelta(days=1), today + timedelta(days=4000), days)
        finish = future[needed - 1].isoformat() if len(future) >= needed else None
    return {"advanced": advanced, "plan_avg": plan_avg, "remaining": remaining, "classes_needed": needed,
            "slots_left": pace.get("slots_left"), "finish": finish, "exam_date": course["exam_date"],
            "fits": bool(finish and finish <= course["exam_date"])}


# ---------------------------------------------------------------- the deck

def _plan_sig(lesson: dict) -> str:
    return hashlib.sha1(((lesson.get("plan_json") or "") + (lesson.get("passages_json") or "")).encode()).hexdigest()[:16]


def _cites(text: str) -> list[int]:
    return [int(n) for n in CITE_RE.findall(text or "")]


def _bullets(prefix: str, paragraph: str) -> list[dict]:
    """A paragraph becomes one bullet per sentence. A sentence without its own citation takes the
    nearest one from the same paragraph, so no bullet is left unsourced."""
    parts = [s for s in sentences(paragraph) if len(re.sub(CITE_RE, "", s).split()) >= 3] or [paragraph]
    own = [_cites(s) for s in parts]
    out = []
    for k, s in enumerate(parts):
        c = own[k] or next((own[j] for j in range(k + 1, len(parts)) if own[j]), None) \
            or next((own[j] for j in range(k - 1, -1, -1) if own[j]), None) or []
        c = list(dict.fromkeys(c))[:2]
        text = s if own[k] else (s.rstrip() + " " + "".join(f"[P{n}]" for n in c)).strip()
        out.append({"id": f"{prefix}b{k + 1}", "text": text, "cut": False})
    return out


def _session_for(lesson: dict) -> dict | None:
    """The class this lesson follows on from: its own last session, else the latest one in its chapter."""
    ss = _sessions(lesson["course_id"])
    return next((s for s in ss if s["lesson_id"] == lesson["id"]), None) or \
        next((s for s in ss if s["topic_id"] == lesson["topic_id"]), None)


def build_deck(lesson_id: int) -> dict | None:
    l = db.one("SELECT l.*, t.title AS chapter FROM lessons l JOIN topics t ON t.id = l.topic_id WHERE l.id = ?",
               (lesson_id,))
    if not l or not l["plan_json"]:
        return None
    plan = db.loads(l["plan_json"], {}) or {}
    passages = db.loads(l["passages_json"], []) or []
    st = db.one("SELECT * FROM ft_lesson_state WHERE lesson_id = ?", (lesson_id,)) or {}
    sources = [{"n": p["n"], "pid": p.get("pid"), "where": p.get("where", ""), "section": _sec(p.get("section")),
                "text": p.get("text", "")} for p in passages]
    by_n = {s["n"]: s for s in sources}
    order = facilitate.chapter_sections(l["course_id"], l["chapter"])
    sess = _session_for(l)
    cov = session_coverage(l["course_id"], sess) if sess else None
    stop = st.get("stopped_section") or None
    stop_from = "recorded" if stop else None
    if not stop and cov and sess and sess["lesson_id"] == lesson_id and l["status"] == "Planned":
        stop, stop_from = cov["furthest"], "transcript"
    done = set(order[: order.index(stop)]) if stop in order else set()
    # The recap follows the class this lesson continues from; a new chapter recaps the class before it.
    recap = sess
    if not recap:
        prev = [s for s in _sessions(l["course_id"]) if (s["chapter_seq"] or 0) < (_topic_seq(l["topic_id"]) or 0)]
        recap = prev[0] if prev else None
    rcov = cov if recap is sess else (session_coverage(l["course_id"], recap) if recap else None)

    transcript: list[dict] = []

    def tcite(line: int) -> str:
        entries = {e.get("i", k): e for k, e in enumerate(db.loads(recap["entries_json"], []) or [])}
        e = entries.get(line)
        if not e:
            return ""
        have = next((t for t in transcript if t["line"] == line), None)
        if not have:
            have = {"n": len(transcript) + 1, "line": line, "at": _clock(e.get("start", 0)),
                    "speaker": e.get("speaker", ""), "text": e.get("text", "")}
            transcript.append(have)
        return f"[T{have['n']}]"

    def where_of(ns: list[int]) -> str:
        return next((by_n[n]["section"] for n in ns if n in by_n), "")

    meta = _split(l["chapter"])
    slides: list[dict] = [{
        "id": "title", "kind": "title", "title": _split(l["title"])["name"] or l["title"],
        "subtitle": " · ".join(x for x in [f"{meta['mod']} {meta['kt']}".strip(), f"{l['minutes'] or 45} min",
                                           f"Picks up from {_tidy(stop)}" if stop else ""] if x),
        "bullets": [], "cut": False}]

    if rcov and recap and any(s["state"] != "not_reached" for s in rcov["sections"]):
        bl = []
        for s in rcov["sections"]:
            if s["state"] == "not_reached":
                continue
            lines = (s["lines"] or ([s["named_at"]] if s["named_at"] is not None else []))[:2]
            marks = "".join(tcite(i) for i in lines)
            word = "covered" if s["state"] == COVERED else "started"
            bl.append({"id": f"recapb{len(bl) + 1}", "text": f"{_tidy(s['name'])}: {word} in class {marks}".strip(), "cut": False})
        entries = db.loads(recap["entries_json"], []) or []
        who = _teacher(l["course_id"], entries)
        last_t = next((e for e in reversed(entries) if e.get("speaker") == who), None)
        mark = tcite(last_t.get("i", entries.index(last_t))) if last_t else ""
        if stop and recap is sess:
            bl.append({"id": f"recapb{len(bl) + 1}", "cut": False,
                       "text": f"We stopped part-way through {_tidy(stop)}, so today starts there. {mark}".strip()})
        elif recap is not sess:
            bl.append({"id": f"recapb{len(bl) + 1}", "cut": False,
                       "text": f"That finished {_split(recap['chapter'])['name'] or recap['chapter']}; today is a new chapter. {mark}".strip()})
        slides.append({"id": "recap", "kind": "recap", "title": "Last class",
                       "subtitle": f"Class of {_day(recap['held_on'])}, matched against the notes", "bullets": bl, "cut": False})

    fixes = []
    for m in ((db.loads(recap["report_json"], {}) or {}).get("misconceptions") or [] if recap else [])[:2]:
        entries = {e.get("i", k): e for k, e in enumerate(db.loads(recap["entries_json"], []) or [])}
        src = (m.get("source") or {})
        p = db.one("SELECT * FROM passages WHERE id = ? AND course_id = ?", (src.get("pid"), l["course_id"])) if src else None
        said = entries.get(m.get("line"))
        if not p or not said or said.get("text", "").strip() != str(m.get("text", "")).strip():
            continue                                              # stale report: never cite what wasn't said
        have = next((s for s in sources if s["pid"] == p["id"]), None)
        if not have:
            have = {"n": max([s["n"] for s in sources] + [0]) + 1, "pid": p["id"], "where": _where(p),
                    "section": _sec(p["section"]), "text": p["text"]}
            sources.append(have)
            by_n[have["n"]] = have
        notes_say = next((s for s in sentences(p["text"]) if len(s.split()) >= 6), p["text"][:220])
        fixes += [{"id": f"fixb{len(fixes) + 1}", "text": f"Said in class: “{said['text']}” {tcite(m['line'])}", "cut": False},
                  {"id": f"fixb{len(fixes) + 2}", "text": f"The notes say: {notes_say} [P{have['n']}]", "cut": False}]
    if fixes:
        slides.append({"id": "fix", "kind": "fix", "title": "Put right from last class",
                       "subtitle": "The Examiner checked this against the notes", "bullets": fixes, "cut": False})

    objectives = [re.sub(r"^\s*(learners|students)\s+(can|will)\s+", "", o, flags=re.I) for o in plan.get("objectives") or []]
    if objectives:
        slides.append({"id": "objectives", "kind": "objectives", "title": "By the end of this lesson you can",
                       "subtitle": "", "cut": False,
                       "bullets": [{"id": f"objb{k + 1}", "text": o[:1].upper() + o[1:], "cut": False}
                                   for k, o in enumerate(objectives)]})

    titles: Counter = Counter()
    for k, para in enumerate(plan.get("explanation") or [], 1):
        ns = _cites(para)
        sec = where_of(ns) or plan.get("title") or "Key idea"
        titles[sec] += 1
        slide = {"id": f"idea{k}", "kind": "idea", "title": _tidy(sec) + (" (continued)" if titles[sec] > 1 else ""),
                 "subtitle": "", "bullets": _bullets(f"idea{k}", para), "cut": False}
        secs = {by_n[n]["section"] for n in ns if n in by_n}
        if secs and secs <= done:
            slide["cut"] = True
            slide["cut_reason"] = f"Taught before the stop point ({stop})"
        slides.append(slide)

    if plan.get("worked_example"):
        slides.append({"id": "example", "kind": "example", "title": "Worked example", "subtitle": "", "cut": False,
                       "bullets": _bullets("example", plan["worked_example"])})
    if plan.get("activity"):
        slides.append({"id": "activity", "kind": "activity", "title": "Class activity",
                       "subtitle": "Suggested by the Subject Teacher: a teaching activity, not a fact from the notes",
                       "cut": False, "bullets": [{"id": "activityb1", "text": plan["activity"], "cut": False}]})
    qs = [q for q in plan.get("check_questions") or [] if isinstance(q, dict) and q.get("q")]
    if qs:
        slides.append({"id": "check", "kind": "check", "title": "Check for understanding", "subtitle": "", "cut": False,
                       "bullets": [{"id": f"checkb{k + 1}", "text": q["q"], "answer": q.get("answer", ""), "cut": False}
                                   for k, q in enumerate(qs)]})
    if plan.get("gaps"):
        slides.append({"id": "gaps", "kind": "gaps", "title": "Not in the notes",
                       "subtitle": "The Subject Teacher found no passage for these. Bring your own material or skip them.",
                       "cut": False, "bullets": [{"id": f"gapsb{k + 1}", "text": g, "cut": False}
                                                 for k, g in enumerate(plan["gaps"])]})
    slides.append({"id": "sources", "kind": "sources", "title": "Sources", "subtitle": "Every [P#] on these slides",
                   "bullets": [], "cut": False})
    for s in slides:
        s.setdefault("image", None)
        s.setdefault("notes", "")
    return {"lesson_id": lesson_id, "title": l["title"], "chapter": l["chapter"], "verdict": l["verdict"],
            "examiner_rounds": l["examiner_rounds"] or 0, "minutes": l["minutes"] or 45, "stop": stop,
            "stop_from": stop_from, "session_id": recap["id"] if recap else None,
            "class_date": recap["held_on"] if recap else None, "sources": sources, "transcript": transcript,
            "slides": slides}


def load_deck(lesson_id: int) -> dict:
    ensure_tables()
    l = db.one("SELECT * FROM lessons WHERE id = ?", (lesson_id,))
    if not l:
        raise HTTPException(404, "Lesson not found")
    fresh = build_deck(lesson_id)
    if not fresh:
        return {"deck": None, "edited": False, "outdated": False}
    saved = db.one("SELECT * FROM ft_decks WHERE lesson_id = ?", (lesson_id,))
    if saved and saved["plan_sig"] == _plan_sig(l):
        deck = db.loads(saved["deck_json"], None)
        if deck:
            return {"deck": deck, "edited": True, "outdated": False, "updated_at": saved["updated_at"]}
    return {"deck": fresh, "edited": False, "outdated": bool(saved)}


def _save(lesson_id: int, deck: dict) -> dict:
    l = db.one("SELECT * FROM lessons WHERE id = ?", (lesson_id,))
    db.run("INSERT INTO ft_decks (lesson_id, deck_json, plan_sig, updated_at) VALUES (?, ?, ?, ?) "
           "ON CONFLICT(lesson_id) DO UPDATE SET deck_json = excluded.deck_json, plan_sig = excluded.plan_sig, "
           "updated_at = excluded.updated_at", (lesson_id, db.dumps(deck), _plan_sig(l), _now()))
    return {"deck": deck, "edited": True, "outdated": False, "updated_at": _now()}


def _image_meta(src: str | None) -> dict | None:
    """An image on a slide must be one this server downloaded; its credit comes from our own record."""
    if not src or not isinstance(src, str):
        return None
    name = src.rsplit("/", 1)[-1]
    if not src.startswith("/api/prep/images/") or not IMAGE_NAME.match(name):
        return None
    side = _store("prep-images") / (name + ".json")
    if not (_store("prep-images") / name).is_file() or not side.is_file():
        return None
    return json.loads(side.read_text(encoding="utf-8"))


def update_deck(lesson_id: int, slides: list) -> dict:
    """The facilitator's edits: slide order, cuts, images and their own notes. Slide text always comes
    from the server's copy, so a slide can't gain a line that doesn't trace to a source."""
    current = load_deck(lesson_id)["deck"]
    if not current:
        raise HTTPException(400, "Prepare the lesson first")
    known = {s["id"]: s for s in current["slides"]}
    for s in build_deck(lesson_id)["slides"]:
        known.setdefault(s["id"], s)                              # a reset slide can come back
    out, seen = [], set()
    for c in slides if isinstance(slides, list) else []:
        if not isinstance(c, dict) or c.get("id") not in known or c["id"] in seen:
            continue
        seen.add(c["id"])
        base = json.loads(json.dumps(known[c["id"]]))
        cut_b = {b.get("id") for b in c.get("bullets") or [] if isinstance(b, dict) and b.get("cut")}
        for b in base["bullets"]:
            b["cut"] = b["id"] in cut_b
        base["cut"] = bool(c.get("cut"))
        if not base["cut"]:
            base.pop("cut_reason", None)
        img = c.get("image")
        base["image"] = _image_meta(img.get("src")) if isinstance(img, dict) else None
        base["notes"] = str(c.get("notes") or "")[:1500]
        out.append(base)
    if not any(s["kind"] == "title" for s in out):
        out.insert(0, known["title"])
    current["slides"] = out
    return _save(lesson_id, current)


def add_slide(lesson_id: int, pid: int, after: str | None) -> dict:
    """A new slide from one passage of the notes: its key sentences, each cited."""
    l = db.one("SELECT l.*, t.title AS chapter FROM lessons l JOIN topics t ON t.id = l.topic_id WHERE l.id = ?",
               (lesson_id,))
    deck = load_deck(lesson_id)["deck"]
    if not l or not deck:
        raise HTTPException(400, "Prepare the lesson first")
    p = db.one("SELECT * FROM passages WHERE id = ? AND course_id = ?", (pid, l["course_id"]))
    if not p:
        raise HTTPException(404, "Passage not found")
    src = next((s for s in deck["sources"] if s.get("pid") == pid), None)
    if not src:
        src = {"n": max([s["n"] for s in deck["sources"]] + [0]) + 1, "pid": pid, "where": _where(p),
               "section": _sec(p["section"]), "text": p["text"]}
        deck["sources"].append(src)
    picked = [s for s in sentences(p["text"]) if 6 <= len(s.split()) <= 60][:3] or [p["text"][:300]]
    sid = f"add{pid}"
    if any(s["id"] == sid for s in deck["slides"]):
        raise HTTPException(400, "That passage already has a slide")
    slide = {"id": sid, "kind": "added", "title": _tidy(src["section"]), "subtitle": "Added from the notes", "cut": False,
             "image": None, "notes": "",
             "bullets": [{"id": f"{sid}b{k + 1}", "text": f"{s} [P{src['n']}]", "cut": False} for k, s in enumerate(picked)]}
    idx = next((k for k, s in enumerate(deck["slides"]) if s["id"] == after), None)
    if idx is None:
        idx = next((k for k, s in enumerate(deck["slides"]) if s["kind"] == "sources"), len(deck["slides"])) - 1
    deck["slides"].insert(idx + 1, slide)
    return _save(lesson_id, deck)


# ---------------------------------------------------------------- images (Wikimedia Commons)

def _plain(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html or "")).strip()


def _ua(contact: str) -> dict:
    return {"User-Agent": USER_AGENT.format(contact=re.sub(r"[^\w:/.@\-]", "", contact or "")[:120] or "localhost")}


def _commons(params: dict, contact: str, transport: httpx.BaseTransport | None = None) -> dict:
    with httpx.Client(timeout=12, transport=transport, headers=_ua(contact)) as c:
        r = c.get(COMMONS_API, params={"format": "json", "formatversion": 2, **params})
        r.raise_for_status()
        return r.json()


def _info(page: dict) -> dict | None:
    ii = (page.get("imageinfo") or [{}])[0]
    if ii.get("mime") not in IMAGE_TYPES and ii.get("thumbmime") not in IMAGE_TYPES:
        return None
    meta = ii.get("extmetadata") or {}
    lic = _plain((meta.get("LicenseShortName") or {}).get("value", ""))
    if not lic:
        return None
    artist = _plain((meta.get("Artist") or {}).get("value", "")) or "Unknown author"
    return {"title": page.get("title", ""), "thumb": ii.get("thumburl") or ii.get("url"),
            "width": ii.get("thumbwidth"), "height": ii.get("thumbheight"), "license": lic, "artist": artist[:120],
            "page": ii.get("descriptionurl", ""),
            "description": _plain((meta.get("ImageDescription") or {}).get("value", ""))[:200]}


def search_images(q: str, contact: str = "", transport: httpx.BaseTransport | None = None) -> list[dict]:
    q = re.sub(r"\s+", " ", q or "").strip()[:120]
    if not q:
        return []
    data = _commons({"action": "query", "generator": "search", "gsrnamespace": 6, "gsrlimit": 16,
                     "gsrsearch": f"{q} filetype:bitmap", "prop": "imageinfo", "iiprop": "url|mime|thumbmime|extmetadata",
                     "iiurlwidth": 480, "iiextmetadatafilter": "LicenseShortName|Artist|ImageDescription"}, contact, transport)
    pages = sorted((data.get("query") or {}).get("pages") or [], key=lambda p: p.get("index", 0))
    return [x for x in (_info(p) for p in pages) if x][:12]


def save_image(title: str, contact: str = "", transport: httpx.BaseTransport | None = None) -> dict:
    """Download one Commons image (a rendered copy at most 1280 px wide) and keep its credit line."""
    if not re.match(r"^File:[^\n<>{}|]{1,240}$", title or ""):
        raise HTTPException(400, "Pick an image from the search results")
    data = _commons({"action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url|mime|thumbmime|extmetadata",
                     "iiurlwidth": 1280, "iiextmetadatafilter": "LicenseShortName|Artist|ImageDescription"}, contact, transport)
    pages = (data.get("query") or {}).get("pages") or []
    info = _info(pages[0]) if pages else None
    if not info:
        raise HTTPException(404, "That image isn't on Wikimedia Commons with a licence")
    url = (pages[0].get("imageinfo") or [{}])[0].get("thumburl") or info["thumb"]
    if httpx.URL(url).host not in IMAGE_HOSTS:
        raise HTTPException(400, "Images can only come from Wikimedia Commons")
    with httpx.Client(timeout=20, transport=transport, headers=_ua(contact), follow_redirects=False) as c:
        r = c.get(url)
    kind = r.headers.get("content-type", "").split(";")[0].strip()
    if r.status_code != 200 or kind not in IMAGE_TYPES or len(r.content) > IMAGE_MAX_BYTES:
        raise HTTPException(502, "Couldn't download that image")
    name = hashlib.sha1(title.encode()).hexdigest()[:20] + "." + IMAGE_TYPES[kind]
    folder = _store("prep-images")
    (folder / name).write_bytes(r.content)
    meta = {"src": f"/api/prep/images/{name}", "title": title.removeprefix("File:"), "license": info["license"],
            "artist": info["artist"], "page": info["page"],
            "credit": f"{info['artist']}, {info['license']}, via Wikimedia Commons"}
    (folder / (name + ".json")).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


# ---------------------------------------------------------------- API

def _contact(request: Request) -> str:
    from .connectors import base_url
    return base_url(request)


@router.get("/api/ft/{cid}/prep")
def api_prep(cid: int, lesson_id: int | None = None):
    course = db.one("SELECT * FROM courses WHERE id = ?", (cid,))
    if not course:
        raise HTTPException(404, "Course not found")
    ensure_tables()
    summary = facilitate.summary(cid)
    lid = lesson_id or (summary.get("next") or {}).get("lesson_id")
    lesson = None
    if lid:
        row = db.one("SELECT l.id, l.seq, l.title, l.topic_id, l.planned_date, l.minutes, l.status, l.verdict, "
                     "l.examiner_rounds, (l.plan_json IS NOT NULL) AS has_plan, t.title AS chapter FROM lessons l "
                     "JOIN topics t ON t.id = l.topic_id WHERE l.id = ? AND l.course_id = ?", (lid, cid))
        if not row:
            raise HTTPException(404, "Lesson not found")
        st = db.one("SELECT * FROM ft_lesson_state WHERE lesson_id = ?", (lid,)) or {}
        nxt = summary.get("next") or {}
        lesson = {**row, "has_plan": bool(row["has_plan"]), "is_next": nxt.get("lesson_id") == lid,
                  "continues_from": st.get("stopped_section") if row["status"] == "Planned" else None,
                  "approved": bool(st.get("approved")), "approved_at": st.get("approved_at"),
                  "sections": facilitate.chapter_sections(cid, row["chapter"]),
                  "date": (principal.pacing(cid).get("forecast") or {}).get(str(lid)) or row["planned_date"]}
    last = last_class(cid)
    sess = next((s for s in _sessions(cid) if last and s["id"] == last["session_id"]), None)
    cov = session_coverage(cid, sess) if sess else None
    return {"course": {"id": cid, "title": course["title"], "subject": course["subject"]},
            "summary": {"stopped": summary.get("stopped"), "next": summary.get("next"), "coverage": summary.get("coverage")},
            "timeline": timeline(cid, summary), "last_class": last, "coverage": cov,
            "pace": pace_projection(cid, cov, sess), "lesson": lesson}


@router.get("/api/lessons/{lid}/deck")
def api_deck(lid: int):
    return load_deck(lid)


@router.post("/api/lessons/{lid}/deck")
def api_deck_save(lid: int, slides: list = Body(..., embed=True)):
    return update_deck(lid, slides)


@router.delete("/api/lessons/{lid}/deck")
def api_deck_reset(lid: int):
    ensure_tables()
    db.run("DELETE FROM ft_decks WHERE lesson_id = ?", (lid,))
    return load_deck(lid)


@router.post("/api/lessons/{lid}/deck/slides")
def api_deck_add(lid: int, pid: int = Body(..., embed=True), after: str | None = Body(None, embed=True)):
    return add_slide(lid, pid, after)


@router.get("/api/lessons/{lid}/deck/passages")
def api_deck_passages(lid: int):
    """Passages of the lesson's chapter the facilitator can add as slides."""
    l = db.one("SELECT l.course_id, t.title AS chapter FROM lessons l JOIN topics t ON t.id = l.topic_id WHERE l.id = ?",
               (lid,))
    if not l:
        raise HTTPException(404, "Lesson not found")
    deck = load_deck(lid)["deck"] or {"sources": [], "slides": []}
    used = {s["pid"] for s in deck["sources"]}
    added = {s["id"] for s in deck["slides"]}
    return [{"pid": p["id"], "section": _sec(p["section"]), "preview": p["text"][:240], "words": len(p["text"].split()),
             "cited": p["id"] in used, "has_slide": f"add{p['id']}" in added}
            for p in _chapter_passages(l["course_id"], l["chapter"])]


def _no_web_images() -> None:
    """The public demo never fetches from the internet on a visitor's behalf."""
    from . import mode
    if mode.public():
        raise HTTPException(403, "Image search is off on the public demo. Run Classroom Fast Track yourself to add images.")


@router.get("/api/prep/images")
def api_images(request: Request, q: str = ""):
    _no_web_images()
    try:
        return {"results": search_images(q, _contact(request)), "source": "Wikimedia Commons"}
    except httpx.HTTPError:
        raise HTTPException(502, "Image search needs an internet connection (Wikimedia Commons didn't answer)")


@router.post("/api/prep/images")
def api_image_save(request: Request, title: str = Body(..., embed=True)):
    _no_web_images()
    try:
        return save_image(title, _contact(request))
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach Wikimedia Commons to download the image")


@router.get("/api/prep/images/{name}")
def api_image(name: str):
    path = _store("prep-images") / name
    if not IMAGE_NAME.match(name) or not path.is_file():
        raise HTTPException(404, "No such image")
    ext = name.rsplit(".", 1)[-1]
    media = {v: k for k, v in IMAGE_TYPES.items()}[ext]
    return FileResponse(path, media_type=media, headers={"Cache-Control": "max-age=86400",
                                                         "X-Content-Type-Options": "nosniff"})
