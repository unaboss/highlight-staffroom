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


def test_fast_track_ladder_cites_and_saves_mastery():
    from app import fasttrack
    from app.agents import librarian
    cid = db.insert("courses", title="FT", subject="", grade="", curriculum="", teacher="", term_start="2026-11-01",
                    exam_date="2027-03-01", slot_days="[0]", slot_minutes=45)
    text = (demo.DEMO / "notes" / "network-security-fundamentals.md").read_text(encoding="utf-8")
    chapter = text.splitlines()[0].lstrip("# ").strip()
    librarian.ingest_file(cid, "notes.md", text.encode("utf-8"))
    tid = db.insert("topics", course_id=cid, seq=1, title=chapter, minutes=45, keywords="")
    lid = db.insert("learners", course_id=cid, name="Test", email="", consent=1)
    _, passages = fasttrack.chapter_passages(tid)
    texts = {p["n"]: p["text"] for p in passages}
    for level in range(1, fasttrack.QUIZ_LEVEL + 1):
        out = fasttrack.build_level(tid, level, seed=1)
        assert out["questions"], level
        for q in out["questions"]:
            assert q["cites"]
            for c in q["cites"]:
                assert c["sentence"] in texts[c["n"]]
    res = fasttrack.record(lid, tid, 1, [{"ok": True, "xp": 10, "sure": "certain"}] * 5, TODAY)
    assert res["passed"] and res["stars"] == 3
    assert db.one("SELECT level FROM mastery WHERE learner_id = ? AND topic_id = ?", (lid, tid))["level"] == 1


def test_fast_track_serves_react_build_and_classic_fallback():
    from fastapi.testclient import TestClient
    from app import main
    client = TestClient(main.app)
    if not (main.WEB_DIST / "index.html").is_file():
        pytest.skip("React build missing: run `npm run build` in web/")
    for path in ("/fast-track", "/fast-track/login"):
        r = client.get(path)
        assert r.status_code == 200 and 'id="root"' in r.text and "/fast-track/assets/" in r.text
    asset = re.search(r'/fast-track/assets/[^"]+\.js', client.get("/fast-track").text).group(0)
    js = client.get(asset).text
    assert "Sign out" in js                      # one way out, back to the login
    assert '"aria-label":"View"' not in js        # no in-page role switcher
    classic = client.get("/fast-track-classic")
    assert classic.status_code == 200 and "Staffroom Fast Track" in classic.text
    assert client.get("/fast-track-classic/login").status_code == 200
    assert client.get("/", follow_redirects=False).headers["location"] == "/fast-track/login"


def test_facilitator_summary_progress_approval_and_actions():
    from fastapi.testclient import TestClient
    from app import main, fasttrack
    from app.agents import librarian
    client = TestClient(main.app)
    text = (demo.DEMO / "notes" / "network-security-fundamentals.md").read_text(encoding="utf-8")
    cid = db.insert("courses", title="FT2", subject="", grade="", curriculum="", teacher="", term_start="2026-11-01",
                    exam_date="2027-03-01", slot_days="[0,2,4]", slot_minutes=45)
    librarian.ingest_file(cid, "notes.md", text.encode("utf-8"))
    chapters = [r["chapter"] for r in db.q("SELECT DISTINCT chapter FROM passages WHERE course_id = ? ORDER BY id", (cid,))]
    tids = [db.insert("topics", course_id=cid, seq=i, title=c, minutes=45, keywords="") for i, c in enumerate(chapters[:3], 1)]
    lids = [db.insert("lessons", course_id=cid, seq=i, topic_id=t, part=1, parts=1, title=chapters[i - 1],
                      planned_date="2026-11-16", minutes=45, status="Planned") for i, t in enumerate(tids, 1)]
    lid = db.insert("learners", course_id=cid, name="Test", email="", consent=1)

    s = client.get(f"/api/ft/{cid}/facilitator").json()
    assert s["coverage"]["pct"] == 0 and s["stopped"] is None and s["next"]["lesson_id"] == lids[0]

    sec = s["next"]["sections"][0]
    client.post(f"/api/lessons/{lids[0]}/progress", json={"stopped_section": sec, "finished": False})
    s = client.get(f"/api/ft/{cid}/facilitator").json()
    assert s["stopped"]["section"] == sec and not s["stopped"]["finished"]
    assert s["next"]["lesson_id"] == lids[0] and s["next"]["continues_from"] == sec
    assert 0 < s["coverage"]["pct"] < 100
    assert tids[0] in [r["topic_id"] for r in s["tracks"][0]["ready"]]          # covered in class -> ready to test

    client.post(f"/api/lessons/{lids[0]}/progress", json={"finished": True})
    s = client.get(f"/api/ft/{cid}/facilitator").json()
    assert s["stopped"]["finished"] and s["next"]["lesson_id"] == lids[1]

    assert client.post(f"/api/lessons/{lids[1]}/approve").status_code == 400  # no plan yet
    db.update("lessons", lids[1], plan_json=db.dumps({"objectives": []}))
    assert client.post(f"/api/lessons/{lids[1]}/approve").json()["approved"]
    assert client.get(f"/api/ft/{cid}/facilitator").json()["next"]["approved"]

    fasttrack.record(lid, tids[1], 1, [{"ok": True, "xp": 10, "sure": "fair"}] * 5, TODAY)
    fasttrack.record(lid, tids[1], 2, [{"ok": True, "xp": 10, "sure": "fair"}] * 5, TODAY)
    tr = client.get(f"/api/ft/{cid}/facilitator").json()["tracks"][0]
    assert tr["pace_per_week"] > 0 and tr["eta"] and tr["status"] in ("ok", "risk", "late")
    assert tids[1] in [r["topic_id"] for r in tr["ready"]]                      # floors 1-2 cleared -> ready to test
    assert tids[2] not in [r["topic_id"] for r in tr["ready"]]                  # not covered -> locked

    r = client.post(f"/api/ft/{cid}/actions", json={"learner_id": lid, "kind": "catch_up", "detail": {"due": "2026-12-01"}})
    assert r.json()["status"] == "Pending approval"
    assert client.get(f"/api/ft/{cid}/facilitator").json()["tracks"][0]["actions"][0]["kind"] == "catch_up"
    assert client.post(f"/api/ft/{cid}/actions", json={"learner_id": lid, "kind": "nope"}).status_code == 400

    v = client.get(f"/api/ft/{cid}/student/{lid}").json()
    assert v["state"] in ("behind", "ahead", "on_track", "done") and len(v["chapters"]) == 3
    assert {c["state"] for c in v["chapters"]} <= {"mastered", "covered", "missed", "started", "taught", "untaught"}
    assert any(c["topic_id"] == tids[0] and c["state"] == "missed" for c in v["chapters"])   # taught in class, not done
    assert v["missed"] and v["missed"][0]["minutes"] > 0 and v["path"][0]["topic_id"] == tids[0]
    assert client.get(f"/api/ft/{cid}/student/999999").status_code == 404


def test_dev_notes_roundtrip(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import devnotes, main
    monkeypatch.setattr(devnotes, "ROOT", tmp_path / "dev-notes")
    c = TestClient(main.app)
    assert b"/static/dev-notes.js" in c.get("/lms").content          # the Note button is on every page
    png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    n = c.post("/api/dev-notes", json={"note": "Make the heading bigger", "url": "http://x/lms", "image": png,
                                        "rect": {"x": 1, "y": 2, "width": 3, "height": 4}, "selector": "h1"}).json()
    assert n["id"] == 1 and n["status"] == "new" and n["has_shot"]
    assert (tmp_path / "dev-notes" / "001" / "shot.png").exists()
    assert c.post("/api/dev-notes", json={"note": "  "}).status_code == 400
    assert c.patch("/api/dev-notes/1", json={"status": "nope"}).status_code == 400
    done = c.patch("/api/dev-notes/1", json={"status": "done", "summary": "Bigger now"}).json()
    assert done["status"] == "done" and done["summary"] == "Bigger now"
    assert [x["id"] for x in c.get("/api/dev-notes").json()["notes"]] == [1]
    assert c.get("/api/dev-notes/1/shot.png").headers["content-type"] == "image/png"
    monkeypatch.setenv("STAFFROOM_DEV_NOTES", "0")
    assert b"dev-notes.js" not in c.get("/lms").content               # presentation mode


def test_model_settings_never_return_the_key(monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    store = {}
    monkeypatch.setattr(main.db, "get_setting", lambda k, d="": store.get(k) or d)
    monkeypatch.setattr(main.db, "set_setting", lambda k, v: store.__setitem__(k, v))
    c = TestClient(main.app)
    secret = "sk-test-0123456789abcdefa1b2"
    out = c.post("/api/settings/model", json={"provider": "deepseek", "api_key": secret}).json()
    assert store["nebius_base_url"] == "https://api.deepseek.com" and store["nebius_model"] == "deepseek-chat"
    assert store["nebius_api_key"] == secret and out["provider"] == "deepseek" and out["online"]
    for body in (out, c.get("/api/settings/model").json(), c.get("/api/settings").json()):
        assert secret not in str(body)
    assert out["key_hint"] == "sk-…a1b2"
    # the masked hint sent back unchanged never overwrites the real key
    c.post("/api/settings/model", json={"api_key": "sk-…a1b2"})
    c.post("/api/settings", json={"nebius_api_key": "sk-…a1b2"})
    assert store["nebius_api_key"] == secret
    # a failing test call reports the provider's error without the key
    class Boom(Exception):
        pass
    def boom(self, *a, **k):
        raise Boom(f"401 bad key {secret}")
    monkeypatch.setattr(main.__dict__["get_llm"]().__class__, "chat", boom)
    r = c.post("/api/settings/model/test", json={}).json()
    assert r["ok"] is False and secret not in r["error"] and "401" in r["error"]


def test_demo_mode_bootstrap_and_public_lockdown(monkeypatch):
    from fastapi.testclient import TestClient
    from app import db, main, mode
    monkeypatch.setenv("FASTTRACK_DATA", "demo")
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    out = mode.bootstrap()
    cid = out["course_id"]
    titles = [t["title"] for t in db.q("SELECT title FROM topics WHERE course_id = ? ORDER BY seq", (cid,))]
    assert titles[0].startswith("NS-01 T01: ") and len(titles) == 10
    c = TestClient(main.app)
    chapters = c.get(f"/api/ft/{cid}/chapters").json()
    assert len(chapters["chapters"]) == 10                                  # every chapter has passages
    assert sum(1 for l in chapters["learners"] if l["sample"]) == 10
    assert mode.bootstrap()["course_id"] == cid                             # runs again without duplicating
    assert c.post("/api/settings/model", json={"api_key": "x"}).status_code == 403
    assert c.post("/api/settings", json={"clickup_token": "x"}).status_code == 403
    assert b"dev-notes.js" in c.get("/lms").content                              # the public notes demo shows the Note button
    h = c.get("/api/health").json()
    assert h["mode"] == {"demo": True, "public": True} and h["course"] == "Network Security Fundamentals"


def test_detect_model_finds_provider_and_never_returns_key(monkeypatch):
    import httpx
    from fastapi.testclient import TestClient
    from app import main
    secret = "sk-test-detect-0123456789wxyz"
    seen = []

    def fake_get(url, headers=None, timeout=None):
        seen.append((url, timeout))
        assert headers["Authorization"] == f"Bearer {secret}"
        if url.startswith("https://api.deepseek.com"):
            return httpx.Response(200, json={"data": [{"id": "deepseek-reasoner"}, {"id": "deepseek-chat"}]})
        return httpx.Response(401, json={"error": {"message": f"Incorrect API key {secret}"}})
    monkeypatch.setattr(httpx, "get", fake_get)
    c = TestClient(main.app)
    d = c.post("/api/settings/model/detect", json={"provider": "auto", "api_key": secret}).json()
    assert d["ok"] and d["label"] == "DeepSeek" and d["base_url"] == "https://api.deepseek.com"
    assert d["default"] == "deepseek-chat" and seen[0][1] == 5
    reasoner = next(m for m in d["models"] if m["id"] == "deepseek-reasoner")
    assert not reasoner["recommended"] and "not recommended" in reasoner["note"]
    assert secret not in str(d)
    # an OpenRouter-style key is tried on OpenRouter first; failures report the provider without the key
    seen.clear()
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: (seen.append(url), httpx.Response(401, json={"error": {"message": f"bad key {secret}"}}))[1])
    r = c.post("/api/settings/model/detect", json={"provider": "auto", "api_key": "sk-or-" + secret}).json()
    assert not r["ok"] and seen[0].startswith("https://openrouter.ai") and secret not in r["error"]


def test_principal_chat_offline_and_with_a_model(monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    from app.agents import principal_chat
    cid = demo.seed(TODAY)
    c = TestClient(main.app)
    assert c.post("/api/principal/chat", json={"messages": []}).status_code == 400

    r = c.post("/api/principal/chat", json={"course_id": cid, "messages": [{"role": "user", "content": "Are we on track?"}]}).json()
    assert not r["online"] and r["course_id"] == cid and "exam" in r["reply"].lower()
    r = c.post("/api/principal/chat", json={"course_id": cid, "messages": [{"role": "user", "content": "Any tests waiting?"}]}).json()
    assert "test" in r["reply"].lower()

    seen = {}

    class Talker:
        def __init__(self):
            self.chat = SimpleNamespace(completions=self)

        def create(self, model, temperature, max_tokens, messages):
            seen["messages"] = messages
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="<think>x</think>All good."))])

    monkeypatch.setattr(main, "get_llm", lambda: LLM(api_key="test", client=Talker()))
    from app import ai_gate
    monkeypatch.setattr(ai_gate, "get_llm", lambda public_ok=False: LLM(api_key="test", client=Talker()))
    hist = [{"role": "assistant", "content": "hello"}, {"role": "user", "content": "How is the class?"}]
    r = c.post("/api/principal/chat", json={"course_id": cid, "messages": hist}).json()
    assert r == {"reply": "All good.", "online": True, "course_id": cid, "model": "nvidia/Llama-3_3-Nemotron-Super-49B-v1_5"}
    sys_msg = seen["messages"][0]["content"]
    assert "Principal" in sys_msg and "SCHOOL BRIEF" in sys_msg and "Days to exam" in sys_msg
    assert seen["messages"][1] == {"role": "user", "content": "How is the class?"}     # leading assistant turn dropped
    assert "Learner track plans" in principal_chat.brief(principal_chat.facts(cid))

    class Broken(Talker):
        def create(self, *a, **k):
            raise RuntimeError("bad key sk-secret123456789")

    monkeypatch.setattr(main, "get_llm", lambda: LLM(api_key="sk-secret123456789", client=Broken()))
    monkeypatch.setattr(ai_gate, "get_llm", lambda public_ok=False: LLM(api_key="sk-secret123456789", client=Broken()))
    r = c.post("/api/principal/chat", json={"course_id": cid, "messages": hist}).json()
    assert not r["online"] and r["reply"] and "secret" not in r["error"]


def test_principal_chat_never_uses_a_key_in_public_mode(monkeypatch):
    from fastapi.testclient import TestClient
    from app import llm as llm_mod, main, mode
    monkeypatch.setenv("FASTTRACK_DATA", "demo")
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    monkeypatch.setenv("NEBIUS_API_KEY", "sk-would-cost-money-0123456789")
    cid = mode.bootstrap()["course_id"]
    def no_network(*a, **k):
        raise AssertionError("public chat must not call the model")
    monkeypatch.setattr(llm_mod.LLM, "converse", no_network)
    monkeypatch.setattr(llm_mod.LLM, "chat", no_network)
    r = TestClient(main.app).post("/api/principal/chat", json={"course_id": cid, "messages": [{"role": "user", "content": "Who is behind?"}]})
    assert r.status_code == 200 and r.json()["reply"] and not r.json().get("online")


def _public_ai_env(monkeypatch, **caps):
    from app import ai_gate
    monkeypatch.setenv("FASTTRACK_DATA", "demo")
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    monkeypatch.setenv("FASTTRACK_PUBLIC_AI", "1")
    monkeypatch.setenv("NEBIUS_API_KEY", "sk-test-public-ai-0123456789")
    for k, v in caps.items():
        monkeypatch.setenv(k, str(v))
    ai_gate.reset()


def test_public_ai_counts_actions_and_falls_back_calmly_at_the_cap(monkeypatch):
    from fastapi.testclient import TestClient
    from app import ai_gate, llm as llm_mod, main, mode
    _public_ai_env(monkeypatch, FASTTRACK_AI_PER_IP_HOUR=2)
    cid = mode.bootstrap()["course_id"]
    calls = []

    def fake_converse(self, system, messages, max_tokens=800, temperature=0.3):
        calls.append(max_tokens); self.tokens += 50
        return "Live answer from the model."
    monkeypatch.setattr(llm_mod.LLM, "converse", fake_converse)
    c = TestClient(main.app)
    ask = lambda: c.post("/api/principal/chat", json={"course_id": cid, "messages": [{"role": "user", "content": "Who is behind?"}]}).json()
    a, b, third = ask(), ask(), ask()
    assert a["online"] and b["online"] and len(calls) == 2            # one question = one action
    assert not third["online"] and third["notice"] == ai_gate.LIMIT_NOTICE and third["reply"]   # calm offline fallback
    assert ai_gate.usage()["actions_today"] == 2 and ai_gate.usage()["tokens_today"] == 100


def test_public_ai_day_and_token_caps(monkeypatch):
    from app import ai_gate
    _public_ai_env(monkeypatch, FASTTRACK_AI_PER_DAY=1)
    llm, note = ai_gate.for_action("1.1.1.1")
    assert llm.online and note is None
    llm, note = ai_gate.for_action("2.2.2.2")                         # another visitor, but the day is used up
    assert not llm.online and note == ai_gate.LIMIT_NOTICE
    _public_ai_env(monkeypatch, FASTTRACK_AI_TOKENS_PER_DAY=10)
    ai_gate._day.update(date=ai_gate._today(), actions=0, tokens=10)
    llm, note = ai_gate.for_action("3.3.3.3")
    assert not llm.online and note == ai_gate.LIMIT_NOTICE


def test_public_ai_off_never_calls_the_model_and_clamps_tokens_when_on(monkeypatch):
    from app import ai_gate, llm as llm_mod
    _public_ai_env(monkeypatch, FASTTRACK_AI_MAX_TOKENS=300)
    monkeypatch.setenv("FASTTRACK_PUBLIC_AI", "0")
    assert not ai_gate.for_action("1.1.1.1")[0].online and not llm_mod.get_llm().online   # no path spends the key
    monkeypatch.setenv("FASTTRACK_PUBLIC_AI", "1")
    seen = []
    monkeypatch.setattr(llm_mod.LLM, "chat", lambda self, s, u, max_tokens=1500, temperature=0.2: seen.append(max_tokens) or "ok")
    llm, _ = ai_gate.for_action("1.1.1.1")
    llm.chat("sys", "user", max_tokens=4000)
    assert seen == [300]


def test_public_notes_demo_is_safe(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from pathlib import Path
    from app import devnotes, main
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    monkeypatch.setenv("STAFFROOM_DEV_NOTES_DIR", str(tmp_path / "public-notes"))
    devnotes._recent.clear()
    c = TestClient(main.app)
    assert b"/static/dev-notes.js" in c.get("/lms").content                      # the Note button shows on the demo
    assert devnotes.root() != devnotes.ROOT                                       # visitor notes never reach the laptop's watcher
    n = c.post("/api/dev-notes", json={"note": "<b>make it pink</b>", "type": "feature"}).json()
    assert n["id"] >= devnotes.PUBLIC_FIRST_ID and n["status"] == "new" and n["visitor"]
    assert n["reply"] == devnotes.QUEUED and n["note"] == "<b>make it pink</b>" and n["type"] == "feature"
    assert c.patch(f"/api/dev-notes/{n['id']}", json={"status": "done"}).status_code == 403
    assert c.post("/api/dev-notes", json={"note": "x" * 1001}).status_code == 400  # text cap
    big = "data:image/png;base64," + "A" * (3 * 1024 * 1024)
    assert c.post("/api/dev-notes", json={"note": "big", "image": big}).status_code == 400   # 2 MB image cap
    codes = [c.post("/api/dev-notes", json={"note": f"n{i}"}).status_code for i in range(5)]
    assert 429 in codes                                                           # 5 a minute per IP
    js = (Path(main.STATIC) / "dev-notes.js").read_text(encoding="utf-8")
    assert "${esc(n.note)}" in js and "esc(d)" in js                              # rendered as plain text
    ids = [x["id"] for x in c.get("/api/dev-notes").json()["notes"]]
    assert n["id"] in ids


def test_public_notes_keep_at_most_200(tmp_path, monkeypatch):
    from app import devnotes
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    monkeypatch.setenv("STAFFROOM_DEV_NOTES_DIR", str(tmp_path / "pn"))
    monkeypatch.setattr(devnotes, "PUBLIC_KEEP", 3)
    monkeypatch.setattr(devnotes, "_rate_ok", lambda ip: True)
    made = [devnotes.create({"note": f"n{i}"}, "1.2.3.4")["id"] for i in range(5)]
    kept = sorted(int(f.name) for f in (tmp_path / "pn").iterdir())
    assert kept == made[-3:]                                                      # the oldest go first


def test_real_mode_installs_the_shipped_course(tmp_path, monkeypatch):
    from app import db, mode
    if not mode.REAL_DB.exists():
        import pytest
        pytest.skip("no shipped real course")
    monkeypatch.setenv("FASTTRACK_DATA", "real")
    monkeypatch.setenv("STAFFROOM_DB", str(tmp_path / "live.db"))
    db.reset_for_tests()
    assert mode.bootstrap()["seeded"] is True
    assert db.q("SELECT COUNT(*) AS n FROM courses")[0]["n"] >= 1
    assert db.q("SELECT COUNT(*) AS n FROM settings")[0]["n"] == 0          # no keys shipped
    assert mode.bootstrap()["seeded"] is False                                # runs once
