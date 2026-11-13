"""Counsellor: joins participation and past marks into one picture per learner.

It keeps a mastery level of 1 to 5 per topic, flags who needs the teacher's attention (always
with evidence), and asks for a targeted test pitched one level above each weak topic.
"""

from .. import db

CHECK_LABELS = ("Absent", "Left early", "Quiet", "Off topic")


def level_from_pct(pct: float) -> int:
    if pct < 0.4:
        return 1
    if pct < 0.55:
        return 2
    if pct < 0.7:
        return 3
    if pct < 0.85:
        return 4
    return 5


def update_mastery(course_id: int, session_report: dict, lesson_topic_id: int | None) -> None:
    learners = db.q("SELECT * FROM learners WHERE course_id = ?", (course_id,))
    by_id = {s["learner_id"]: s for s in session_report.get("learners", [])}
    for l in learners:
        for row in db.q("SELECT topic_id, AVG(score / max) AS pct, COUNT(*) AS n FROM scores "
                        "WHERE learner_id = ? GROUP BY topic_id", (l["id"],)):
            db.run("INSERT INTO mastery (learner_id, topic_id, level, basis) VALUES (?, ?, ?, ?) "
                   "ON CONFLICT(learner_id, topic_id) DO UPDATE SET level = excluded.level, basis = excluded.basis",
                   (l["id"], row["topic_id"], level_from_pct(row["pct"] or 0),
                    f"{row['n']} quiz result(s), average {round(100 * (row['pct'] or 0))}%"))
        s = by_id.get(l["id"])
        if s and lesson_topic_id:
            has_quiz = db.one("SELECT 1 FROM scores WHERE learner_id = ? AND topic_id = ?", (l["id"], lesson_topic_id))
            if not has_quiz:
                share = s["on_topic"] / s["turns"] if s["turns"] else 0
                level = 3 if (s["label"] == "Active" and share >= 0.7) else 2 if s["turns"] else 1
                db.run("INSERT INTO mastery (learner_id, topic_id, level, basis) VALUES (?, ?, ?, ?) "
                       "ON CONFLICT(learner_id, topic_id) DO UPDATE SET level = excluded.level, basis = excluded.basis",
                       (l["id"], lesson_topic_id, level,
                        f"From class participation ({s['label'].lower()}, {s['on_topic']} on-topic contributions)"))


def review(course_id: int, session_id: int, session_report: dict, lesson: dict, emit) -> list[dict]:
    emit("Counsellor", "start", "Combining today's participation with past quiz marks")
    update_mastery(course_id, session_report, lesson.get("topic_id"))
    topics = {t["id"]: t for t in db.q("SELECT * FROM topics WHERE course_id = ?", (course_id,))}
    prev_session = db.one("SELECT id FROM sessions WHERE course_id = ? AND id < ? ORDER BY id DESC LIMIT 1",
                          (course_id, session_id))
    flags = []
    for s in session_report.get("learners", []):
        reasons, evidence = [], list(s.get("evidence", []))[:6]
        if s["label"] in CHECK_LABELS:
            reasons.append(s["why"] if s["label"] != "Quiet" else "Present but silent in today's class")
            if s["label"] == "Quiet" and prev_session:
                before = db.one("SELECT label FROM participation WHERE session_id = ? AND learner_id = ?",
                                (prev_session["id"], s["learner_id"]))
                if before and before["label"] == "Quiet":
                    reasons[-1] = "Quiet in the last 2 classes"
        for m in [m for m in session_report.get("misconceptions", []) if m["learner_id"] == s["learner_id"]][:2]:
            short = m["text"] if len(m["text"]) <= 90 else m["text"][:87] + "…"
            reasons.append(f"Said in class: “{short}” (the notes don't support it)")
            evidence.append(m["line"])
        weak = db.q("SELECT topic_id, level, basis FROM mastery WHERE learner_id = ? AND level <= 2 "
                    "ORDER BY level, topic_id", (s["learner_id"],))
        weak = [w for w in weak if w["topic_id"] in topics]
        for w in weak[:2]:
            if "quiz" in (w["basis"] or ""):
                reasons.append(f"Struggling with {topics[w['topic_id']]['title']} ({w['basis']})")
        if not reasons:
            continue
        # Test targets: today's topic plus the weakest earlier topics, one level above mastery.
        target_ids = []
        if lesson.get("topic_id"):
            target_ids.append(lesson["topic_id"])
        target_ids += [w["topic_id"] for w in weak if w["topic_id"] not in target_ids]
        targets = []
        for tid in target_ids[:3]:
            m = db.one("SELECT level FROM mastery WHERE learner_id = ? AND topic_id = ?", (s["learner_id"], tid))
            current = m["level"] if m else 2
            targets.append({"topic_id": tid, "topic": topics[tid]["title"],
                            "keywords": topics[tid]["keywords"] or "", "mastery": current,
                            "level": min(5, current + 1)})
        flag = {"learner_id": s["learner_id"], "name": s["name"], "reason": "; ".join(reasons),
                "targets": targets, "evidence": evidence}
        fid = db.insert("flags", course_id=course_id, learner_id=s["learner_id"], session_id=session_id,
                        reason=flag["reason"], topics_json=db.dumps(targets), evidence_json=db.dumps(evidence))
        flag["id"] = fid
        flags.append(flag)
        emit("Counsellor", "work", f"Flagged {s['name']}: {flag['reason']}", {"learner_id": s["learner_id"]})
        emit("Counsellor", "handoff",
             f"Asking for a test for {s['name']}: " + ", ".join(f"{t['topic']} at level {t['level']}" for t in targets),
             {"learner_id": s["learner_id"], "targets": targets})
    if not flags:
        emit("Counsellor", "done", "Nobody needs a follow-up after this class")
    return flags
