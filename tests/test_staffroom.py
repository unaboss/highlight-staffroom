"""Offline tests: no network, no API keys. A fake OpenAI-style client stands in for the model."""

import json
import re
from datetime import date
from types import SimpleNamespace

import httpx
import pytest

from app import db, demo, orchestrator
from app.agents import examiner, observer, principal, teacher
from app.events import Emitter
from app.integrations.clickup import ClickUp
from app.integrations.meet import Meet
from app.llm import LLM, parse_json
from app.textutil import cites, overlap

TODAY = date(2026, 11, 13)          # a Friday: the demo story opens on a teaching day


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    for key in ("NEBIUS_API_KEY", "CLICKUP_TOKEN", "GOOGLE_ACCESS_TOKEN", "MOODLE_URL", "MOODLE_TOKEN", "AS_OF_DATE"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("STAFFROOM_DB", str(tmp_path / "test.db"))
    db.reset_for_tests()
    db.set_setting("as_of_date", TODAY.isoformat())
    yield
    db.reset_for_tests()


def noop(*a, **k):
    return {}


OFFLINE = LLM()                     # no key, no client: offline mode


def passages_firewall():
    return [
        {"n": 1, "pid": 1, "where": "notes, 4.1 What a firewall does, p. 8", "section": "4.1 What a firewall does",
         "text": "A firewall is a security control that inspects network traffic and decides whether to allow "
                 "or block it based on a set of rules."},
        {"n": 2, "pid": 2, "where": "notes, 4.2 Rules and default deny, p. 9", "section": "4.2 Rules and default deny",
         "text": "A good rule set follows the principle of default deny: everything is blocked unless a rule "
                 "specifically allows it."},
    ]


# ---------------------------------------------------------------- text and parsing

def test_overlap_and_cites():
    assert cites("A [P1] and [P12]") == [1, 12]
    assert overlap("Firewalls inspect network traffic", "A firewall inspects network traffic.") == 1.0
    assert overlap("Firewalls block all viruses", "A firewall inspects network traffic.") < 0.45


def test_parse_json_handles_think_and_fences():
    assert parse_json('<think>hmm {"x": 1}</think>```json\n{"a": {"b": 2}}\n```') == {"a": {"b": 2}}
    assert parse_json("no json here") == {}


def test_parse_transcript_vtt_and_plain():
    vtt = "WEBVTT\n\n00:00:05.000 --> 00:00:09.000\n<v Ms Dube>What is a firewall?</v>\n\n" \
          "00:00:10.000 --> 00:00:14.000\n<v Thabo Mokoena>It filters traffic.</v>\n"
    e = observer.parse_transcript(vtt)
    assert [x["speaker"] for x in e] == ["Ms Dube", "Thabo Mokoena"]
    assert e[1]["start"] == 10.0
    plain = observer.parse_transcript("Ms Dube: Hello class\nAyesha Patel: Morning")
    assert plain[1]["speaker"] == "Ayesha Patel"


def test_parse_attendance_minutes():
    rows = observer.parse_attendance("name,joined,left\nSipho Ndlovu,09:07,09:29\n")
    assert rows[0]["minutes"] == 22


def test_parse_syllabus_lines():
    topics = principal.parse_syllabus("1. The CIA triad (45 min) | keywords: confidentiality, integrity\n"
                                      "2. Firewalls (90 min) | keywords: rule, default deny")
    assert [t["minutes"] for t in topics] == [45, 90]
    assert topics[1]["keywords"].startswith("rule")


# ---------------------------------------------------------------- examiner

def test_examiner_passes_grounded_and_flags_made_up():
    ps = passages_firewall()
    items = [
        {"id": "e1", "text": "A firewall inspects network traffic and decides whether to allow or block it [P1]"},
        {"id": "e2", "text": "Firewalls block all viruses and stop every attack [P1]"},
        {"id": "e3", "text": "Default deny blocks everything unless a rule allows it [P7]"},
    ]
    out = examiner.check(items, ps, OFFLINE, noop, "statements")
    v = {r["id"]: r["verdict"] for r in out["items"]}
    assert v["e1"] == examiner.SUPPORTED
    assert v["e2"] in (examiner.PARTLY, examiner.MISSING)
    assert v["e3"] == examiner.UNCITED                     # P7 isn't a passage it was given
    assert out["verdict"] == "send_back" and len(out["issues"]) == 2


def test_check_statements_finds_the_misconception():
    found = examiner.check_statements([
        {"line": 3, "learner_id": 1, "name": "Thabo", "text": "Everything is blocked unless a rule specifically allows it."},
        {"line": 5, "learner_id": 2, "name": "Sipho", "text": "We don't need antivirus because firewalls block all viruses."},
    ], passages_firewall(), OFFLINE, noop)
    assert [f["name"] for f in found] == ["Sipho"]
    assert found[0]["notes_say"].startswith("A firewall is a security control")


# ---------------------------------------------------------------- the whole demo, offline

def run_demo():
    cid = demo.seed(TODAY)
    lesson = db.one("SELECT * FROM lessons WHERE course_id = ? AND status = 'Planned' ORDER BY seq LIMIT 1", (cid,))
    from app.main import _job_demo
    job = orchestrator.start_job("demo", cid, _job_demo, cid, wait=True)
    return cid, lesson, job


def test_demo_story_end_to_end():
    cid, lesson, job = run_demo()
    assert db.one("SELECT status FROM jobs WHERE id = ?", (job,))["status"] == "done"
    assert lesson["title"].startswith("Firewalls")

    taught = db.one("SELECT * FROM lessons WHERE id = ?", (lesson["id"],))
    assert taught["status"] == "Taught" and taught["verdict"] == "Passed"
    plan = json.loads(taught["plan_json"])
    assert all(cites(x) for x in plan["explanation"])       # every key idea cites a passage

    sess = db.one("SELECT * FROM sessions WHERE course_id = ?", (cid,))
    report = json.loads(sess["report_json"])
    labels = {s["name"]: s["label"] for s in report["learners"]}
    assert labels["Kagiso Molefe"] == "Absent"
    assert labels["Lerato Khumalo"] == "Quiet"
    assert labels["Sipho Ndlovu"] == "Left early"
    assert labels["Thabo Mokoena"] == "Active"
    assert [m["name"] for m in report["misconceptions"]] == ["Sipho Ndlovu"]

    flagged = {f["name"] for f in db.q("SELECT l.name FROM flags f JOIN learners l ON l.id = f.learner_id")}
    assert flagged == {"Sipho Ndlovu", "Lerato Khumalo", "Kagiso Molefe"}

    tests = db.q("SELECT t.*, l.name FROM tests t JOIN learners l ON l.id = t.learner_id")
    assert len(tests) == 3 and {t["status"] for t in tests} == {"Needs approval"}
    sipho = next(t for t in tests if t["name"] == "Sipho Ndlovu")
    first = json.loads(sipho["questions_json"])[0]
    assert first.get("from_class") and "viruses" in first["q"]

    pace = principal.pacing(cid, TODAY)
    assert pace["shortfall"] == 2 and len(pace["at_risk"]) == 2
    assert pace["eta"] > pace["exam_date"]


def test_replan_keeps_taught_lessons():
    cid, lesson, _ = run_demo()
    before = {l["id"]: l["planned_date"] for l in db.q("SELECT * FROM lessons WHERE status = 'Taught'")}
    principal.plan_course(cid, noop)
    after = {l["id"]: l["planned_date"] for l in db.q("SELECT * FROM lessons WHERE status = 'Taught'")}
    assert before == after
    planned = db.q("SELECT planned_date FROM lessons WHERE status = 'Planned' ORDER BY seq")
    assert planned[0]["planned_date"] > TODAY.isoformat()


def test_api_state_and_claim_check():
    from fastapi.testclient import TestClient
    from app.main import app
    cid, lesson, _ = run_demo()
    c = TestClient(app)
    st = c.get(f"/api/state/{cid}").json()
    assert st["pacing"]["total"] == 14 and len(st["tests"]) == 3
    r = c.post(f"/api/lessons/{lesson['id']}/check", json={"text": "Firewalls block all viruses"}).json()
    assert r["verdict"] != "Supported"
    ok = c.post(f"/api/lessons/{lesson['id']}/check",
                json={"text": "A firewall inspects network traffic and decides whether to allow or block it"}).json()
    assert ok["verdict"] == "Supported"
    t = st["tests"][0]["id"]
    assert c.post(f"/api/tests/{t}/approve").json()["status"] == "Approved"


def test_demo_reset_leaves_other_courses_alone():
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    mine = c.post("/api/courses", data={"title": "Ethical Hacking", "term_start": "2026-11-02",
                                        "exam_date": "2026-12-11", "syllabus": "1. Recon (45 min) | keywords: osint"}).json()
    c.post("/api/demo/seed")
    c.post("/api/demo/seed?reset=true")
    titles = [x["title"] for x in c.get("/api/courses").json()]
    assert "Ethical Hacking" in titles and titles.count(demo_title()) == 1
    assert db.one("SELECT id FROM courses WHERE id = ?", (mine["course_id"],))


def demo_title():
    return json.loads((demo.DEMO / "course.json").read_text())["title"]


# ---------------------------------------------------------------- with a model (fake client)

class FakeModel:
    """Answers like the model would, by prompt. The first draft slips in one claim the notes don't make."""

    def __init__(self):
        self.chat = SimpleNamespace(completions=self)
        self.prompts = []

    def create(self, model, temperature, max_tokens, messages):
        system, user = messages[0]["content"], messages[1]["content"]
        self.prompts.append(system[:60])
        reply = self.answer(system, user)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="<think>ok</think>" + json.dumps(reply)))])

    def answer(self, system, user):
        if "school librarian" in system:
            return {"action": "done", "reason": "the passages cover firewalls"}
        if "school examiner" in system:
            ids = re.findall(r"^(\w+): ", user.split("Items:", 1)[1], re.M)
            return {"items": [{"id": i, "verdict": "Supported", "reason": "P1 says so"} for i in ids]}
        plan = {
            "title": "Firewalls",
            "objectives": ["Learners can explain what a firewall does [P1]"],
            "explanation": ["A firewall inspects network traffic and decides whether to allow or block it based on a set of rules. [P1]",
                            "Firewalls block all viruses and stop every attack on the school. [P1]"],
            "worked_example": "", "activity": "Pairs explain default deny to each other.",
            "check_questions": [{"q": "What is default deny?", "answer": "Everything is blocked unless a rule specifically allows it. [P2]"}],
            "gaps": [],
        }
        if "sent some items back" in system:
            plan["explanation"] = plan["explanation"][:1]
            return plan
        if "ONE lesson plan" in system:
            return plan
        if "personalised test" in system:
            return {"questions": [{"topic": "Firewalls", "level": 3, "q": "A rule set allows only port 443. What happens to SSH?",
                                   "answer": "It is blocked: everything is blocked unless a rule specifically allows it. [P2]", "marks": 3}]}
        if "teaching assistant" in system:
            ids = re.findall(r"^(\d+): ", user, re.M)
            return {"items": [{"id": int(i), "on_topic": True} for i in ids]}
        return {}


def test_send_back_loop_with_a_model():
    fake = FakeModel()
    llm = LLM(api_key="test", client=fake)
    ps = passages_firewall()
    plan = teacher.write_lesson("Firewalls", "Firewalls part 1", ps, llm, noop)
    review = examiner.check(teacher.lesson_items(plan), ps, llm, noop, "lesson statements")
    # The model said "Supported" for everything, but code found too few of the virus claim's words in P1.
    assert review["verdict"] == "send_back"
    assert [i["id"] for i in review["issues"]] == ["e2"]
    plan = teacher.revise_lesson(plan, review["issues"], ps, llm, noop)
    again = examiner.check(teacher.lesson_items(plan), ps, llm, noop, "lesson statements")
    assert again["verdict"] == "pass"
    assert any("sent some items back" in p for p in fake.prompts) or len(fake.prompts) >= 4


def test_prepare_lesson_job_with_a_model(monkeypatch):
    cid = demo.seed(TODAY)
    lesson = db.one("SELECT * FROM lessons WHERE course_id = ? AND status = 'Planned' ORDER BY seq LIMIT 1", (cid,))
    monkeypatch.setattr(orchestrator, "get_llm", lambda: LLM(api_key="test", client=FakeModel()))
    out = orchestrator.job_prepare_lesson(Emitter(None), lesson["id"])
    assert out["rounds"] == 1 and out["verdict"] == "Passed"
    kinds = [e["kind"] for e in db.q("SELECT kind FROM events WHERE agent = 'Examiner'")]
    assert "reject" in kinds and "pass" in kinds


# ---------------------------------------------------------------- integrations: request shapes

def test_clickup_create_task_request():
    seen = []

    def handler(req: httpx.Request):
        seen.append(req)
        return httpx.Response(200, json={"id": "abc123"})

    cu = ClickUp("pk_test", transport=httpx.MockTransport(handler))
    task = cu.create_task("901", "Lesson 5: Firewalls", "# Plan", status="to do", tags=["staffroom"], due="2026-11-16")
    assert task["id"] == "abc123"
    req = seen[0]
    assert req.method == "POST" and req.url.path.endswith("/list/901/task")
    assert req.headers["Authorization"] == "pk_test"
    body = json.loads(req.content)
    assert body["markdown_description"] == "# Plan" and body["tags"] == ["staffroom"] and body["due_date"] > 0


def test_meet_class_data_builds_entries_and_register():
    def handler(req: httpx.Request):
        p = req.url.path
        if p.endswith("/conferenceRecords"):
            assert "abc-defg-hij" in str(req.url)
            return httpx.Response(200, json={"conferenceRecords": [{"name": "conferenceRecords/r1",
                                                                     "startTime": "2026-11-13T07:00:00Z"}]})
        if p.endswith("/participants"):
            return httpx.Response(200, json={"participants": [
                {"name": "conferenceRecords/r1/participants/p1", "signedinUser": {"displayName": "Thabo Mokoena"}}]})
        if p.endswith("/participantSessions"):
            return httpx.Response(200, json={"participantSessions": [
                {"startTime": "2026-11-13T07:00:00Z", "endTime": "2026-11-13T07:40:00Z"}]})
        if p.endswith("/transcripts"):
            return httpx.Response(200, json={"transcripts": [{"name": "conferenceRecords/r1/transcripts/t1"}]})
        if p.endswith("/entries"):
            return httpx.Response(200, json={"transcriptEntries": [
                {"participant": "conferenceRecords/r1/participants/p1", "text": "It filters traffic.",
                 "startTime": "2026-11-13T07:01:00Z", "endTime": "2026-11-13T07:01:05Z"}]})
        return httpx.Response(404, json={})

    meet = Meet("ya29.test", transport=httpx.MockTransport(handler))
    entries, attendance, rec = meet.class_data("abc-defg-hij")
    assert entries[0]["speaker"] == "Thabo Mokoena" and entries[0]["start"] == 60.0
    assert attendance[0]["minutes"] == 40.0
