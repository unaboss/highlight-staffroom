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


# ---------------------------------------------------------------- catch-up plan (dev note 39)

PLAN_SYSTEM = """You are the Counsellor in a school staffroom. A facilitator is behind (or ahead of) the pace
needed to finish the course notes before the exam. Using ONLY the facts given, write a short, practical plan
for what to do next to move forward. Name real numbers from the facts. Never invent learners, topics or dates.
JSON shape: {"headline": "one sentence", "steps": [{"title": "a few words", "detail": "one or two sentences"}]}
Give 3 to 5 steps."""


def _fact_lines(f: dict) -> str:
    lines = [f"Class is {f['class_pct']}% through the notes; by the straight pace to the exam it should be {f['should_be_pct']}%.",
             f"{f['passages_left']} passages of notes left, {f['classes_left']} class slots before the exam "
             f"({f.get('days_to_exam')} days).",
             f"Classes so far averaged {f['per_class']} passages; finishing needs "
             f"{f['needed_per_class'] if f['needed_per_class'] is not None else 'more than the slots left allow'} a class."]
    if f.get("learner_pct") is not None:
        lines.append(f"The average learner is {f['learner_pct']}% through the notes on their own Fast Track ({f['learners']} learners).")
    if f.get("behind"):
        lines.append("Learners behind the class: " + ", ".join(f"{b['name']} ({b['pct']}%)" for b in f["behind"]) + ".")
    if f.get("weak_topics"):
        lines.append("Topics where most learners are weak: " + ", ".join(f["weak_topics"]) + ".")
    return "\n".join(lines)


def _offline_plan(f: dict) -> dict:
    gap = round(f["should_be_pct"] - f["class_pct"], 1)
    need, per = f["needed_per_class"], f["per_class"]
    steps = []
    if need is None:
        steps.append({"title": "Ask for extra slots", "detail": f"{f['passages_left']} passages are left and no class "
                      "slots remain before the exam. Book catch-up sessions or move revision into self-study now."})
    elif per and need > per:
        steps.append({"title": f"Teach {need} passages a class", "detail": f"Classes have averaged {per}. Cover "
                      f"{need} a class for the {f['classes_left']} slots left, or the notes won't be finished by the exam."})
    else:
        steps.append({"title": f"Hold {need} passages a class", "detail": f"That finishes the notes in the "
                      f"{f['classes_left']} slots left; the class has averaged {per or 0}."})
    if gap > 0:
        steps.append({"title": "Trim the next decks", "detail": f"The class is {gap} points behind the straight pace. "
                      "Cut slides on sections the transcript shows were already covered, and set the rest as reading."})
    else:
        steps.append({"title": "Use the time you've gained", "detail": f"The class is {abs(gap)} points ahead of the "
                      "straight pace. Spend it on the chapters learners find hardest."})
    lp = f.get("learner_pct")
    if lp is not None and lp < f["class_pct"]:
        steps.append({"title": "Close the learner gap", "detail": f"The average learner is at {lp}% on Fast Track while "
                      f"the class is at {f['class_pct']}%. Give ten minutes at the end of each class to the ladder."})
    if f.get("behind"):
        names = ", ".join(b["name"] for b in f["behind"][:3])
        steps.append({"title": "Check in with who's behind", "detail": f"Start with {names}: they are furthest behind "
                      "the class. Approve a personal test for each from the class page."})
    if f.get("weak_topics"):
        steps.append({"title": "Revise the weak chapters", "detail": "Most learners are weak on "
                      + ", ".join(f["weak_topics"][:2]) + ". Open the next lesson with a short recap of these."})
    head = (f"The class is {gap} points behind the pace it needs." if gap > 0
            else f"The class is on pace ({f['class_pct']}% of the notes, {f['should_be_pct']}% needed by today).")
    return {"headline": head, "steps": steps[:5]}


def catch_up_plan(facts: dict, llm) -> dict:
    """What to do next to move forward. With a model the Counsellor writes it from the facts; without one
    (or when the reply is unusable) it is worked out in code from the same numbers."""
    if llm.online:
        out = llm.json(PLAN_SYSTEM, _fact_lines(facts), max_tokens=900)
        steps = [s for s in (out.get("steps") or []) if isinstance(s, dict) and s.get("title") and s.get("detail")]
        if out.get("headline") and len(steps) >= 2:
            return {"headline": str(out["headline"]), "steps": [{"title": str(s["title"]), "detail": str(s["detail"])}
                                                                 for s in steps[:5]],
                    "facts": _fact_lines(facts), "online": True, "model": llm.model}
    return {**_offline_plan(facts), "facts": _fact_lines(facts), "online": False}
