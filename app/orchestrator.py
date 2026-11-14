"""Runs the agents as jobs. Each job is a chain of hand-offs, and every step is streamed as an event."""

import threading
import time
import traceback
from datetime import datetime, timezone

from . import db
from .agents import counsellor, examiner, librarian, observer, principal, teacher
from .events import Emitter
from .integrations import clickup
from .llm import get_llm
from .textutil import cites, strip_cites

MAX_SEND_BACKS = 2


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def start_job(kind: str, course_id: int | None, fn, *args, wait: bool = False) -> int:
    job_id = db.insert("jobs", kind=kind, course_id=course_id, status="running", started=_now())
    emit = Emitter(job_id)

    def runner():
        try:
            result = fn(emit, *args)
            db.update("jobs", job_id, status="done", finished=_now(), result_json=db.dumps(result or {}))
            emit("Staffroom", "done", "Job finished", {"kind": kind, "result": result or {}})
        except Exception as e:  # keep the app alive and tell the teacher what broke
            traceback.print_exc()
            db.update("jobs", job_id, status="error", finished=_now(), result_json=db.dumps({"error": str(e)}))
            emit("Staffroom", "error", f"Stopped: {e}")

    if wait:
        runner()
    else:
        threading.Thread(target=runner, daemon=True).start()
    return job_id


# ---------------------------------------------------------------- ClickUp sync (best effort)

def _cu(course: dict, emit):
    if not clickup.connected(course):
        return None, {}
    return clickup.client(), clickup.course_lists(course)


def _safe(emit, what: str, fn):
    try:
        out = fn()
        emit("ClickUp", "sync", what)
        return out
    except Exception as e:
        emit("ClickUp", "warn", f"Couldn't sync to ClickUp ({what}): {e}")
        return None


def clickup_due(iso: str) -> int:
    d = datetime.fromisoformat(iso).replace(hour=8, tzinfo=timezone.utc)
    return int(d.timestamp() * 1000)


def plan_markdown(plan: dict, passages: list[dict], review: dict | None = None) -> str:
    lines = [f"# {plan.get('title', '')}", "", "## Objectives"] + [f"- {o}" for o in plan.get("objectives", [])]
    lines += ["", "## Key ideas"] + [f"- {e}" for e in plan.get("explanation", [])]
    if plan.get("worked_example"):
        lines += ["", "## Worked example", plan["worked_example"]]
    if plan.get("activity"):
        lines += ["", "## Class activity", plan["activity"]]
    if plan.get("check_questions"):
        lines += ["", "## Check for understanding"]
        lines += [f"{i}. {c['q']}\n   Answer: {c['answer']}" for i, c in enumerate(plan["check_questions"], 1)]
    if plan.get("gaps"):
        lines += ["", "## Gaps in the notes"] + [f"- {g}" for g in plan["gaps"]]
    lines += ["", "## Sources"] + [f"- [P{p['n']}] {p['where']}" for p in passages]
    if review:
        lines += ["", f"_Examiner: {review.get('summary', '')}_"]
    return "\n".join(lines)


# ---------------------------------------------------------------- jobs

def job_plan_course(emit, course_id: int) -> dict:
    lessons = principal.plan_course(course_id, emit)
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    cu, lists = _cu(course, emit)
    if cu and lists.get("lessons"):
        sts = clickup.statuses(cu, lists["lessons"])
        for l in db.q("SELECT * FROM lessons WHERE course_id = ? AND status = 'Planned' ORDER BY seq", (course_id,)):
            if l["clickup_task_id"]:
                if l["planned_date"]:
                    _safe(emit, f"Moved {l['title']} to {l['planned_date']}", lambda l=l: cu.update_task(
                        l["clickup_task_id"], due_date=clickup_due(l["planned_date"])))
                continue
            task = _safe(emit, f"Lesson task: {l['title']}", lambda l=l: cu.create_task(
                lists["lessons"], f"Lesson {l['seq']}: {l['title']}", "Plan not written yet.",
                status=clickup.pick_status(sts, "open"), tags=["staffroom", "lesson"], due=l["planned_date"]))
            if task:
                db.update("lessons", l["id"], clickup_task_id=str(task.get("id")))
    pace = principal.pacing(course_id)
    emit("Principal", "done", f"Term planned. Forecast finish {pace.get('eta')}, exam {pace.get('exam_date')}",
         {"pacing": pace})
    return {"lessons": len(lessons)}


def job_prepare_lesson(emit, lesson_id: int, llm=None, seed: bool = False, pace: float = 0) -> dict:
    """Librarian -> Subject Teacher -> Examiner, with line-by-line self-correction.

    seed=True (the demo run) slips one plausible but ungrounded line into the first draft so the
    Examiner always has a real catch to show: caught -> sent back -> rewritten -> re-checked.
    pace > 0 waits that many seconds after each step so an offline run can be watched live."""
    if pace > 0:
        inner = emit

        def emit(*a, **k):                                 # noqa: F811 - same emitter, slowed for the stage
            ev = inner(*a, **k)
            time.sleep(pace)
            return ev
    llm = llm or get_llm()
    lesson = db.one("SELECT l.*, t.title AS topic, t.keywords FROM lessons l LEFT JOIN topics t ON t.id = l.topic_id "
                    "WHERE l.id = ?", (lesson_id,))
    course = db.one("SELECT * FROM courses WHERE id = ?", (lesson["course_id"],))
    emit("Principal", "handoff", f"Lesson {lesson['seq']} “{lesson['title']}” goes to the Subject Teacher. "
         f"Model: {llm.label}", {"lesson_id": lesson_id})
    found = librarian.gather(course["id"], lesson["topic"], lesson["keywords"], llm, emit)
    passages = librarian.focus(found, lesson["part"] or 1, lesson["parts"] or 1)
    if passages and len(passages) < len(found):
        emit("Librarian", "work", f"Kept {len(passages)} passages for this lesson"
             + (f" (part {lesson['part']} of {lesson['parts']} of the topic)" if (lesson["parts"] or 1) > 1 else "")
             + ": " + "; ".join(p["where"].split(", ", 1)[-1] for p in passages))
    if not passages:
        emit("Librarian", "warn", "No course material matches this topic. Upload notes for it first.")
        return {"lesson_id": lesson_id, "verdict": "no material"}
    plan = teacher.write_lesson(lesson["topic"], lesson["title"], passages, llm, emit)
    if seed:
        plan = teacher.seed_ungrounded(plan, lesson["topic"] or lesson["title"], passages)
    for it in teacher.lesson_items(plan):                 # the plan document, line by line, as it is written
        emit("Subject Teacher", "drafted", strip_cites(it["text"])[:140],
             {"id": it["id"], "section": it["kind"], "line": it["text"], "cites": cites(it["text"])})
    review, rounds, caught, fixed, pending = None, 0, 0, 0, {}
    while True:
        review = examiner.check(teacher.lesson_items(plan), passages, llm, emit, "lesson statements")
        verdicts = {r["id"]: r for r in review["items"]}
        if rounds == 0:
            for r in review["items"]:
                emit("Examiner", "checked", f"{r['id']}: {r['verdict']} ({int(r['grounding'] * 100)}% grounded)",
                     {"id": r["id"], "line": r["text"], "verdict": r["verdict"], "supported": r["verdict"] == examiner.SUPPORTED,
                      "grounding": r["grounding"], "reason": r["reason"], "cites": r["cites"]})
        for item_id, before in pending.items():          # the Examiner re-checks every rewritten line
            r = verdicts.get(item_id)
            ok = bool(r and r["verdict"] == examiner.SUPPORTED)
            fixed += ok
            emit("Examiner", "rechecked", f"{item_id}: {r['verdict'] if r else 'removed'} on re-check",
                 {"id": item_id, "line": r["text"] if r else None, "before": before,
                  "verdict": r["verdict"] if r else "Removed", "supported": ok,
                  "grounding": r["grounding"] if r else None, "reason": r["reason"] if r else ""})
        pending = {}
        if review["verdict"] == "pass" or rounds >= MAX_SEND_BACKS:
            break
        rounds += 1
        for r in review["issues"]:
            caught += 1
            emit("Examiner", "caught", f"Caught {r['id']}: {r['reason']}",
                 {"id": r["id"], "line": r["text"], "verdict": r["verdict"], "reason": r["reason"],
                  "grounding": r["grounding"], "cites": r["cites"]})
            pending[r["id"]] = r["text"]
        emit("Examiner", "handoff", f"Sending {len(review['issues'])} item(s) back to the Subject Teacher "
             f"(round {rounds} of {MAX_SEND_BACKS})", {"ids": [r["id"] for r in review["issues"]], "round": rounds,
                                                       "sent_back": True})
        plan = teacher.rewrite_lines(plan, review["issues"], passages, llm, emit,
                                     lambda line: examiner.citation_check(line, passages))
    verdict = "Passed" if review["verdict"] == "pass" else "Flagged for teacher"
    if verdict != "Passed":
        emit("Examiner", "warn", f"Still {len(review['issues'])} issue(s) after {MAX_SEND_BACKS} rounds: "
             "flagged for the teacher instead of being hidden")
    db.update("lessons", lesson_id, plan_json=db.dumps(plan), passages_json=db.dumps(passages),
              review_json=db.dumps(review), verdict=verdict, examiner_rounds=rounds)

    cu, lists = _cu(course, emit)
    if cu and lists.get("lessons"):
        md = plan_markdown(plan, passages, review)
        if lesson["clickup_task_id"]:
            tid = lesson["clickup_task_id"]
            _safe(emit, "Lesson plan written to its task", lambda: cu.update_task(tid, markdown_description=md))
        else:
            task = _safe(emit, "Lesson task created", lambda: cu.create_task(
                lists["lessons"], f"Lesson {lesson['seq']}: {lesson['title']}", md, tags=["staffroom", "lesson"],
                due=lesson["planned_date"]))
            tid = str(task["id"]) if task else None
            if tid:
                db.update("lessons", lesson_id, clickup_task_id=tid)
        if tid:
            _safe(emit, "Examiner verdict posted as a comment",
                  lambda: cu.comment(tid, f"Examiner: {review['summary']} ({rounds} send-back round(s))."))
            _safe(emit, "Verdict field", lambda: cu.set_field(lists["lessons"], tid, "verdict", verdict))
    emit("Staffroom", "pass" if verdict == "Passed" else "warn",
         f"Lesson plan {verdict.lower()}: ready for the teacher", {"lesson_id": lesson_id})
    return {"lesson_id": lesson_id, "verdict": verdict, "rounds": rounds, "caught": caught, "fixed": fixed,
            "plan": plan}


def _test_passages(course_id: int, targets: list[dict], llm, emit) -> tuple[list[dict], list[dict]]:
    """Gather passages per target topic, then renumber them into one list."""
    combined, seen = [], {}
    for t in targets:
        found = librarian.focus(librarian.gather(course_id, t["topic"], t.get("keywords", ""), llm, emit))
        t["passages"] = []
        for p in found[:6]:
            if p["pid"] not in seen:
                q = {**p, "n": len(combined) + 1}
                combined.append(q)
                seen[p["pid"]] = q
            t["passages"].append(seen[p["pid"]])
    return combined, targets


def _class_question(learner: str, m: dict, targets: list[dict], passages: list[dict], emit) -> dict | None:
    """Turn something the learner got wrong in class into a question, answered from the notes."""
    src = m.get("source")
    if not src:
        return None
    if not any(x.get("pid") == src.get("pid") for x in passages):
        passages.append({**src, "n": len(passages) + 1})
    best, p = examiner.corrective(m["text"], passages)
    if not best:
        return None
    level = max(2, targets[0]["level"]) if targets else 2
    emit("Subject Teacher", "work", f"Added a question on what {learner} said in class: “{m['text'][:90]}”")
    return {"topic": targets[0]["topic"] if targets else "", "level": level, "marks": 3, "from_class": True,
            "q": f"In class you said: “{m['text']}” Is that right? Explain, using what you learned.",
            "answer": f"{best.strip()} [P{p['n']}]"}


def build_test(emit, course_id: int, learner_id: int, targets: list[dict], llm=None,
               misconceptions: list[dict] | None = None) -> dict:
    llm = llm or get_llm()
    learner = db.one("SELECT * FROM learners WHERE id = ?", (learner_id,))
    passages, targets = _test_passages(course_id, targets, llm, emit)
    questions = teacher.draft_test(learner["name"], targets, passages, llm, emit)
    for m in (misconceptions or [])[:1]:
        q = _class_question(learner["name"], m, targets, passages, emit)
        if q:
            questions.insert(0, q)
    review, rounds = None, 0
    while True:
        review = examiner.check(teacher.test_items(questions), passages, llm, emit, "test questions")
        if review["verdict"] == "pass" or rounds >= MAX_SEND_BACKS:
            break
        rounds += 1
        questions = teacher.revise_test(questions, review["issues"], emit)
        if not questions:
            break
    status = "Needs approval"
    title = f"Personal test: {learner['name']}"
    clean_targets = [{k: v for k, v in t.items() if k != "passages"} for t in targets]
    test_id = db.insert("tests", course_id=course_id, learner_id=learner_id, title=title,
                        plan_json=db.dumps(clean_targets), questions_json=db.dumps(questions),
                        passages_json=db.dumps(passages), review_json=db.dumps(review),
                        verdict="Passed" if review and review["verdict"] == "pass" else "Flagged",
                        examiner_rounds=rounds, status=status)
    emit("Examiner", "handoff", f"Test for {learner['name']} ({len(questions)} questions) is waiting for "
         "the teacher's approval. Nothing is sent to the learner until then.", {"test_id": test_id})
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    cu, lists = _cu(course, emit)
    if cu and lists.get("tests"):
        md = "\n".join([f"# {title}", "", "Targets: " + ", ".join(
            f"{t['topic']} (level {t['level']})" for t in clean_targets), ""] +
            [f"{i}. [{q['topic']}, level {q['level']}] {q['q']}\n   Memo: {q['answer']}"
             for i, q in enumerate(questions, 1)] +
            ["", "## Sources"] + [f"- [P{p['n']}] {p['where']}" for p in passages] +
            ["", "Move this task to Approved (or complete) to release it."])
        sts = clickup.statuses(cu, lists["tests"])
        task = _safe(emit, f"Test task for {learner['name']}", lambda: cu.create_task(
            lists["tests"], title, md, status=clickup.pick_status(sts, "open"), tags=["staffroom", "test"]))
        if task:
            db.update("tests", test_id, clickup_task_id=str(task["id"]))
            lv = max((t["level"] for t in clean_targets), default=2)
            _safe(emit, "Difficulty field", lambda: cu.set_field(lists["tests"], str(task["id"]), "difficulty", lv))
    return {"test_id": test_id, "questions": len(questions)}


def job_process_class(emit, session_id: int) -> dict:
    llm = get_llm()
    sess = db.one("SELECT * FROM sessions WHERE id = ?", (session_id,))
    course = db.one("SELECT * FROM courses WHERE id = ?", (sess["course_id"],))
    lesson = db.one("SELECT l.*, t.title AS topic, t.keywords FROM lessons l LEFT JOIN topics t ON t.id = l.topic_id "
                    "WHERE l.id = ?", (sess["lesson_id"],))
    roster = db.q("SELECT * FROM learners WHERE course_id = ?", (course["id"],))
    entries = db.loads(sess["entries_json"], [])
    attendance = db.loads(sess["attendance_json"], [])
    passages = db.loads(lesson["passages_json"], []) or librarian.gather(
        course["id"], lesson["topic"], lesson["keywords"], llm, emit)
    lesson_text = " ".join(p["text"] for p in passages)
    report = observer.analyse(entries, attendance, roster, lesson_text, llm, emit, course.get("teacher") or "")
    statements = observer.statements(entries, report, lesson_text)
    if statements and passages:
        emit("Class Observer", "handoff", f"Passing {len(statements)} things learners said about the topic to the "
             "Examiner, to check them against the notes")
        report["misconceptions"] = examiner.check_statements(statements, passages, llm, emit)
    else:
        report["misconceptions"] = []
    db.run("DELETE FROM participation WHERE session_id = ?", (session_id,))
    for s in report["learners"]:
        db.insert("participation", session_id=session_id, learner_id=s["learner_id"], minutes=s["minutes"],
                  turns=s["turns"], questions=s["questions"], answers=s["answers"], on_topic=s["on_topic"],
                  score=s["score"], label=s["label"], evidence_json=db.dumps(s["evidence"]))
    db.update("sessions", session_id, report_json=db.dumps(report))
    db.update("lessons", lesson["id"], status="Taught", taught_on=sess["held_on"])

    cu, lists = _cu(course, emit)
    if cu and lists.get("lessons") and lesson["clickup_task_id"]:
        tid = lesson["clickup_task_id"]
        sts = clickup.statuses(cu, lists["lessons"])
        st = clickup.pick_status(sts, "middle")
        if st:
            _safe(emit, "Lesson marked as taught", lambda: cu.update_task(tid, status=st))
        summary = "Class report:\n" + "\n".join(f"- {s['name']}: {s['label']} (score {s['score']}). {s['why']}"
                                                for s in report["learners"])
        _safe(emit, "Class report posted on the lesson", lambda: cu.comment(tid, summary))

    flags = counsellor.review(course["id"], session_id, report, lesson, emit)
    for f in flags:
        if cu and lists.get("followups"):
            md = f"**Why:** {f['reason']}\n\n**Suggested test:** " + ", ".join(
                f"{t['topic']} at level {t['level']}" for t in f["targets"]) + \
                f"\n\nEvidence: transcript lines {', '.join(str(i + 1) for i in f['evidence']) or 'none (silent)'}"
            task = _safe(emit, f"Follow-up task for {f['name']}", lambda md=md, f=f: cu.create_task(
                lists["followups"], f"Check in with {f['name']}", md, tags=["staffroom", "follow-up"]))
            if task:
                db.update("flags", f["id"], clickup_task_id=str(task["id"]))
        if f["targets"]:
            mine = [m for m in report.get("misconceptions", []) if m["learner_id"] == f["learner_id"]]
            build_test(emit, course["id"], f["learner_id"], f["targets"], llm, mine)

    pace = principal.pacing(course["id"])
    if pace.get("total"):
        msg = (f"Pacing: {pace['taught']} of {pace['total']} lessons taught. Forecast finish {pace['eta']} "
               f"vs exam {pace['exam_date']}. ")
        msg += (f"{pace['shortfall']} lesson(s) won't fit before the exam." if pace["shortfall"]
                else "On track to finish before the exam.")
        emit("Principal", "warn" if pace["shortfall"] else "pass", msg, {"pacing": pace})
    return {"session_id": session_id, "flags": len(flags)}


def job_sync_clickup(emit, course_id: int) -> dict:
    """Poll ClickUp for tests the teacher approved there (no public webhook URL needed)."""
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    cu, lists = _cu(course, emit)
    if not cu:
        emit("ClickUp", "warn", "ClickUp isn't connected for this course")
        return {"approved": 0}
    approved = 0
    for t in db.q("SELECT * FROM tests WHERE course_id = ? AND status = 'Needs approval' AND clickup_task_id IS NOT NULL",
                  (course_id,)):
        task = _safe(emit, f"Checked {t['title']}", lambda t=t: cu.get_task(t["clickup_task_id"]))
        if task and clickup.is_approved(task):
            db.update("tests", t["id"], status="Approved")
            approved += 1
            emit("Staffroom", "pass", f"{t['title']} approved in ClickUp: released to the learner")
    return {"approved": approved}
