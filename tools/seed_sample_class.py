"""Add clearly-labelled sample learners with Fast Track progress, plus one "sample class" on the
first lesson, so the facilitator page, the race lanes and the LMS gradebook have a class to show.
Real learners and real lessons are never touched beyond the first lesson's "where we stopped".

    python -m tools.seed_sample_class --course Melsoft          # add (or rebuild) the sample class
    python -m tools.seed_sample_class --course Melsoft --remove # take everything sample out again

The sample class is a Google Meet-style transcript built from sentences in the course's own notes.
It runs through the normal pipeline (Class Observer, Examiner, Counsellor, Subject Teacher), so the
participation report, the flagged misconception and the personal test all come from app logic.
"""

import argparse
import itertools
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db, facilitate, fasttrack, orchestrator  # noqa: E402
from app.agents import observer, principal  # noqa: E402
from app.textutil import sentences  # noqa: E402

# Ten profiles at different levels: (name, how often they answer right, how far they push)
SAMPLE = [("Sample 1", 0.90, 10), ("Sample 2", 0.86, 9), ("Sample 3", 0.82, 8), ("Sample 4", 0.78, 7),
          ("Sample 5", 0.74, 6), ("Sample 6", 0.70, 5), ("Sample 7", 0.64, 4), ("Sample 8", 0.58, 3),
          ("Sample 9", 0.52, 2), ("Sample 10", 0.45, 1)]
DOMAIN = "@sample.demo"
SOURCE = "sample class"
TEACHER = "Facilitator"
# A common wrong idea about the first chapter. The Examiner should not find it in the notes.
MISCONCEPTION = "Biometric authentication is weak, so companies should rely on simple passwords that never change."


def remove(cid: int) -> int:
    facilitate.ensure_tables()
    for s in db.q("SELECT id, lesson_id FROM sessions WHERE course_id = ? AND source = ?", (cid, SOURCE)):
        db.run("DELETE FROM participation WHERE session_id = ?", (s["id"],))
        db.run("DELETE FROM flags WHERE session_id = ?", (s["id"],))
        db.run("DELETE FROM ft_lesson_state WHERE lesson_id = ?", (s["lesson_id"],))
        db.update("lessons", s["lesson_id"], status="Planned", taught_on=None)
        db.run("DELETE FROM sessions WHERE id = ?", (s["id"],))
    rows = db.q("SELECT id FROM learners WHERE course_id = ? AND email LIKE ?", (cid, "%" + DOMAIN))
    for r in rows:
        for t in ("scores", "mastery", "fast_track", "fast_track_learner", "participation", "flags", "tests"):
            db.run(f"DELETE FROM {t} WHERE learner_id = ?", (r["id"],))
        db.run("DELETE FROM ft_actions WHERE learner_id = ?", (r["id"],))
        db.run("DELETE FROM learners WHERE id = ?", (r["id"],))
    return len(rows)


def seed(cid: int) -> int:
    remove(cid)
    rng = random.Random(7)
    topics = db.q("SELECT id FROM topics WHERE course_id = ? ORDER BY seq LIMIT 4", (cid,))
    today = principal.today_for(cid)
    for name, skill, reach in SAMPLE:
        lid = db.insert("learners", course_id=cid, name=name, email=name.lower().replace(" ", "") + DOMAIN, consent=1)
        budget = reach
        for i, t in enumerate(topics):
            climb = budget if i == 0 else max(0, budget - 3 * i)
            for level in range(1, min(10, climb) + 1):
                answers = []
                for _ in range(5):
                    ok = rng.random() < skill - level * 0.015
                    sure = rng.choice(["guess", "fair", "certain"])
                    answers.append({"ok": ok, "sure": sure, "xp": (10 + level) * ok})
                res = fasttrack.record(lid, t["id"], level, answers, today)
                if not res["passed"]:
                    break
    seed_class(cid)
    return len(SAMPLE)


def _clock(t0: int) -> str:
    return f"{t0 // 3600:02d}:{t0 % 3600 // 60:02d}:{t0 % 60:02d}.000"


def seed_class(cid: int) -> dict:
    """One taught lesson (stopped part-way through a section), read through the normal pipeline."""
    # the first lesson still to teach whose chapter has passages (the very first lesson on a new course)
    lesson = next((l for l in db.q("SELECT l.*, t.title AS chapter FROM lessons l JOIN topics t ON t.id = l.topic_id "
                                   "WHERE l.course_id = ? AND l.status = 'Planned' ORDER BY l.seq", (cid,))
                   if facilitate.chapter_sections(cid, l["chapter"])), None)
    if not lesson:
        return {}
    if not lesson["passages_json"]:
        orchestrator.job_prepare_lesson(lambda *a, **k: None, lesson["id"])
        lesson = db.one("SELECT * FROM lessons WHERE id = ?", (lesson["id"],))
    chapter = db.one("SELECT title FROM topics WHERE id = ?", (lesson["topic_id"],))["title"]
    sections = facilitate.chapter_sections(cid, chapter)
    stop = sections[min(2, len(sections) - 1)]          # the class stops part-way into the third section
    passages = db.loads(lesson["passages_json"], [])
    said = [s for p in passages if fasttrack.section_name(p.get("section")) in sections[:sections.index(stop) + 1]
            for s in sentences(p["text"]) if 8 <= len(s.split()) <= 26]
    rng = random.Random(11)
    rng.shuffle(said)
    # short demo notes may have only a few lines: reuse them rather than run out
    pick = itertools.cycle(said or [s for p in passages for s in sentences(p["text"])] or ["I read the notes for this part."])

    lines = [(TEACHER, f"Good morning everyone. Today we start {chapter.split(':', 1)[-1].strip()}. Can you all hear me?"),
             ("Sample 1", "Yes, loud and clear."), ("Sample 2", "Morning, yes."),
             (TEACHER, f"Let's begin with {sections[0]}. Who can tell me something from the notes?"),
             ("Sample 1", next(pick)), (TEACHER, "Good. Anyone else?"), ("Sample 2", next(pick)),
             (TEACHER, f"Now {sections[1]}. " + next(pick)), ("Sample 1", next(pick)),
             ("Sample 2", "Can you explain why that matters for a small company?"),
             (TEACHER, next(pick)), ("Sample 10", "Sorry, my connection keeps dropping."),
             (TEACHER, f"Let's move to {stop}. What do you think about biometrics?"),
             ("Sample 8", MISCONCEPTION), (TEACHER, "Let's check that against the notes. " + next(pick)),
             ("Sample 1", next(pick)), ("Sample 8", "Okay, I'll read that part again."),
             (TEACHER, f"We'll stop here, part-way through {stop}, and pick up from this point next time.")]
    vtt, t = ["WEBVTT", ""], 5
    for who, text in lines:
        vtt += [f"{_clock(t)} --> {_clock(t + 20)}", f"<v {who}>{text}</v>", ""]
        t += rng.randint(90, 300)
    attendance = "name,joined,left\nFacilitator,09:00,10:30\n" + "".join(
        f"{n},09:0{i % 3},{'09:31' if n == 'Sample 10' else '10:30'}\n" for i, (n, _, _) in enumerate(SAMPLE))
    db.update("courses", cid, teacher=db.one("SELECT teacher FROM courses WHERE id = ?", (cid,))["teacher"] or TEACHER)
    sid = db.insert("sessions", course_id=cid, lesson_id=lesson["id"], source=SOURCE,
                    held_on=principal.today_for(cid).isoformat(),
                    entries_json=db.dumps(observer.parse_transcript("\n".join(vtt))),
                    attendance_json=db.dumps(observer.parse_attendance(attendance)))
    result = orchestrator.job_process_class(lambda *a, **k: None, sid)
    # The class did not finish the chapter: keep the lesson open and record where it stopped.
    db.update("lessons", lesson["id"], status="Planned", taught_on=None)
    facilitate.record_progress(lesson["id"], stop, False, principal.today_for(cid))
    return {"session_id": sid, "stopped_at": stop, **result}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="Melsoft")
    ap.add_argument("--remove", action="store_true")
    a = ap.parse_args()
    c = db.one("SELECT id FROM courses WHERE title = ?", (a.course,))
    if not c:
        raise SystemExit(f"No course called {a.course}")
    print(f"Removed {remove(c['id'])} sample learners and the sample class" if a.remove
          else f"Added {seed(c['id'])} sample learners and one sample class")


if __name__ == "__main__":
    main()
