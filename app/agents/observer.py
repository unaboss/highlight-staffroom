"""Class Observer: reads a class transcript and register and scores each learner's participation.

Counting (minutes present, turns, questions) is done in code. The model is only asked whether a
learner's contribution was on topic, and every score links back to the transcript lines behind it.
It never looks at faces, cameras or tone: a learner who was present but silent is "Quiet", not "Poor".
"""

import csv
import io
import re
import statistics
from datetime import datetime

from ..textutil import content_words, overlap

QUESTION_START = re.compile(r"^(what|why|how|when|where|who|which|is|are|can|could|does|do|should|would|will)\b", re.I)

ONTOPIC_SYSTEM = """You are a teaching assistant reviewing a live online class.
For each learner contribution, say whether it is on the lesson topic (a relevant question, answer
or comment) or not (chat, tech problems, unrelated). Judge relevance only, not correctness.
Reply: {"items": [{"id": <id>, "on_topic": true|false}]}"""


# ---------------------------------------------------------------- parsing

def _secs(ts: str) -> float:
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    parts = [float(p) for p in parts]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def parse_transcript(text: str) -> list[dict]:
    """WebVTT (Teams/Meet exports) or plain "[hh:mm:ss] Name: text" / "Name: text" lines."""
    entries = []
    text = text.replace("\r\n", "\n").lstrip("﻿")
    if text.strip().upper().startswith("WEBVTT"):
        for block in re.split(r"\n\s*\n", text):
            lines = [l for l in block.strip().splitlines() if l.strip()]
            tline = next((l for l in lines if "-->" in l), None)
            if not tline:
                continue
            start, end = [s.strip().split(" ")[0] for s in tline.split("-->")]
            body = " ".join(lines[lines.index(tline) + 1:])
            m = re.match(r"<v\s+([^>]+)>(.*?)(?:</v>)?$", body)
            if m:
                speaker, said = m.group(1).strip(), m.group(2).strip()
            elif ":" in body[:40]:
                speaker, said = body.split(":", 1)
            else:
                speaker, said = "Unknown", body
            entries.append({"start": _secs(start), "end": _secs(end), "speaker": speaker.strip(),
                            "text": re.sub(r"</?v[^>]*>", "", said).strip()})
    else:
        for line in text.splitlines():
            m = re.match(r"^\s*(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*)?([^:\[\]]{2,40}):\s+(.+)$", line)
            if m:
                t = _secs(m.group(1)) if m.group(1) else (entries[-1]["end"] + 1 if entries else 0.0)
                entries.append({"start": t, "end": t + 5, "speaker": m.group(2).strip(), "text": m.group(3).strip()})
    for i, e in enumerate(entries):
        e["i"] = i
    return entries


def _clock(value: str) -> float:
    value = value.strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            t = datetime.strptime(value, fmt)
            return t.hour * 60 + t.minute + t.second / 60
        except ValueError:
            pass
    t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return t.timestamp() / 60


def parse_attendance(text: str) -> list[dict]:
    """CSV with name, joined, left (clock times or ISO). Several rows per person are summed."""
    rows = list(csv.DictReader(io.StringIO(text.strip().lstrip("﻿"))))
    out: dict[str, dict] = {}
    for r in rows:
        r = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
        name = r.get("name") or r.get("full name") or r.get("participant")
        joined = r.get("joined") or r.get("join time") or r.get("first join")
        left = r.get("left") or r.get("leave time") or r.get("last leave")
        if not (name and joined and left):
            continue
        mins = max(0.0, _clock(left) - _clock(joined))
        rec = out.setdefault(name, {"name": name, "minutes": 0.0, "joined": joined, "left": left})
        rec["minutes"] += mins
        rec["left"] = left
    return list(out.values())


# ---------------------------------------------------------------- analysis

def _match(name: str, roster: list[dict]) -> dict | None:
    n = name.lower().strip()
    for r in roster:
        if r["name"].lower() == n:
            return r
    first = n.split()[0] if n.split() else n
    hits = [r for r in roster if r["name"].lower().split()[0] == first]
    return hits[0] if len(hits) == 1 else None


def statements(entries: list[dict], report: dict, lesson_text: str, limit: int = 12) -> list[dict]:
    """Learner lines worth fact-checking: on-topic statements (not questions or chat) with some substance."""
    who = {}
    for s in report.get("learners", []):
        for i in s.get("evidence", []):
            who[i] = s
    out = []
    for e in entries:
        s = who.get(e["i"])
        text = e["text"].strip()
        if not s or text.endswith("?") or QUESTION_START.match(text):
            continue
        if len(content_words(text)) < 4 or overlap(text, lesson_text) < 0.3:
            continue
        out.append({"line": e["i"], "learner_id": s["learner_id"], "name": s["name"], "text": text})
    return out[:limit]


def analyse(entries: list[dict], attendance: list[dict], roster: list[dict], lesson_text: str,
            llm, emit, teacher: str = "") -> dict:
    emit("Class Observer", "start",
         f"Reading the class transcript: {len(entries)} lines, {len(attendance)} people on the register")
    class_minutes = max([a["minutes"] for a in attendance] + [((entries[-1]["end"] - entries[0]["start"]) / 60)
                                                             if entries else 0] + [1])
    stats = {r["id"]: {"learner_id": r["id"], "name": r["name"], "minutes": 0.0, "turns": 0, "questions": 0,
                       "answers": 0, "on_topic": 0, "evidence": [], "lines": []} for r in roster}
    for a in attendance:
        r = _match(a["name"], roster)
        if r:
            stats[r["id"]]["minutes"] = round(min(a["minutes"], class_minutes), 1)

    contributions = []
    for idx, e in enumerate(entries):
        r = _match(e["speaker"], roster)
        if not r:
            continue
        s = stats[r["id"]]
        s["turns"] += 1
        s["evidence"].append(e["i"])
        is_q = e["text"].rstrip().endswith("?") or bool(QUESTION_START.match(e["text"]))
        if is_q:
            s["questions"] += 1
        prev = entries[idx - 1] if idx else None
        if prev and not _match(prev["speaker"], roster) and prev["text"].rstrip().endswith("?") and not is_q:
            s["answers"] += 1
        contributions.append({"id": e["i"], "learner": r["id"], "text": e["text"]})

    judged = {}
    if llm.online and contributions:
        listing = "\n".join(f"{c['id']}: {c['text']}" for c in contributions)
        out = llm.json(ONTOPIC_SYSTEM, f"Lesson material:\n{lesson_text[:4000]}\n\nContributions:\n{listing}",
                       max_tokens=1500)
        for it in out.get("items") or []:
            try:
                judged[int(it["id"])] = bool(it["on_topic"])
            except (KeyError, TypeError, ValueError):
                continue
    for c in contributions:
        if c["id"] in judged:
            on = judged[c["id"]]
        else:
            words = content_words(c["text"])
            on = len(words) >= 2 and overlap(c["text"], lesson_text) >= 0.3
        if on:
            stats[c["learner"]]["on_topic"] += 1

    active_turns = [s["turns"] for s in stats.values() if s["turns"]]
    median = statistics.median(active_turns) if active_turns else 1
    report = []
    for s in stats.values():
        presence = min(1.0, s["minutes"] / class_minutes) if class_minutes else 0
        turns_n = min(1.0, s["turns"] / max(1.0, median * 1.5))
        on_share = s["on_topic"] / s["turns"] if s["turns"] else 0.0
        s["score"] = round(100 * (0.4 * presence + 0.3 * turns_n + 0.3 * on_share))
        if presence < 0.05:
            s["label"], s["why"] = "Absent", "Not on the register for this class"
        elif presence < 0.6:
            s["label"], s["why"] = "Left early", f"Present {s['minutes']:.0f} of {class_minutes:.0f} minutes"
        elif s["turns"] == 0:
            s["label"], s["why"] = "Quiet", f"Present {s['minutes']:.0f} min but didn't speak"
        elif s["turns"] >= 2 and on_share < 0.5:
            s["label"], s["why"] = "Off topic", f"{s['on_topic']} of {s['turns']} contributions on topic"
        elif s["score"] >= 65:
            s["label"], s["why"] = "Active", f"{s['turns']} contributions, {s['on_topic']} on topic"
        else:
            s["label"], s["why"] = "Participating", f"{s['turns']} contribution(s), {s['on_topic']} on topic"
        report.append(s)
        emit("Class Observer", "work", f"{s['name']}: {s['label']} (score {s['score']}). {s['why']}",
             {"learner_id": s["learner_id"], "label": s["label"], "score": s["score"]})
    report.sort(key=lambda s: -s["score"])
    emit("Class Observer", "handoff",
         f"Class report ready: {sum(1 for s in report if s['label'] == 'Active')} active, "
         f"{sum(1 for s in report if s['label'] in ('Quiet', 'Absent', 'Left early', 'Off topic'))} to check",
         {"class_minutes": round(class_minutes)})
    return {"class_minutes": round(class_minutes, 1), "learners": report,
            "judge": "model" if judged else "word overlap"}
