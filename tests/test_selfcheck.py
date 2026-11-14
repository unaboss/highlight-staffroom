"""Self-correction on stage: the citation check, the live agent run over SSE, and the streaming Principal chat.
Offline: no network, no keys."""

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import ai_gate, db, demo, orchestrator
from app.agents import examiner, teacher
from app.events import Emitter
from app.llm import LLM

TODAY = date(2026, 11, 13)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    for key in ("NEBIUS_API_KEY", "CLICKUP_TOKEN", "GOOGLE_ACCESS_TOKEN", "MOODLE_URL", "MOODLE_TOKEN", "AS_OF_DATE",
                "FASTTRACK_DATA", "FASTTRACK_PUBLIC", "FASTTRACK_PUBLIC_AI"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("FASTTRACK_DEMO_PACE", "0")
    monkeypatch.setenv("STAFFROOM_DB", str(tmp_path / "test.db"))
    db.reset_for_tests()
    db.set_setting("as_of_date", TODAY.isoformat())
    ai_gate.reset()
    yield
    db.reset_for_tests()


PASSAGES = [
    {"n": 1, "pid": 1, "where": "notes, 4.1", "section": "4.1 What a firewall does",
     "text": "A firewall is a security control that inspects network traffic and decides whether to allow "
             "or block it based on a set of rules."},
    {"n": 2, "pid": 2, "where": "notes, 4.2", "section": "4.2 Rules and default deny",
     "text": "A good rule set follows the principle of default deny: everything is blocked unless a rule "
             "specifically allows it."},
]


def noop(*a, **k):
    return {}


def _sse(text: str) -> list[dict]:
    out = []
    for block in text.split("\n\n"):
        data = [l[6:] for l in block.splitlines() if l.startswith("data: ")]
        if data and data[0] not in ("{}", "[DONE]"):
            out.append(json.loads(data[0]))
    return out


# ---------------------------------------------------------------- citation check

def test_citation_check_supported_vs_unsupported():
    good = examiner.citation_check("A firewall inspects network traffic and decides whether to allow or block it. [P1]", PASSAGES)
    assert good["supported"] and good["verdict"] == examiner.SUPPORTED and good["cites"] == [1]
    # Plausible, cites a real passage, but the passage doesn't say it.
    bad = examiner.citation_check("Firewalls block all viruses and stop every attack on the school. [P1]", PASSAGES)
    assert not bad["supported"] and bad["verdict"] in (examiner.MISSING, examiner.PARTLY)
    assert "viruses" in bad["reason"]
    # The right words, the wrong passage: default deny is P2, not P1.
    wrong = examiner.citation_check("Everything is blocked unless a rule specifically allows it. [P1]", PASSAGES)
    assert not wrong["supported"]
    assert examiner.citation_check("No citation here at all.", PASSAGES)["verdict"] == examiner.UNCITED
    assert examiner.citation_check("A firewall inspects traffic [P9]", PASSAGES)["bad_cites"] == [9]


def test_teacher_rewrites_a_caught_line_from_the_cited_passage():
    plan = teacher.seed_ungrounded({"objectives": [], "explanation": [
        "A firewall inspects network traffic and decides whether to allow or block it. [P1]"],
        "worked_example": "", "check_questions": [], "gaps": []}, "Firewalls", PASSAGES)
    review = examiner.check(teacher.lesson_items(plan), PASSAGES, LLM(), noop, "lesson statements")
    assert [i["id"] for i in review["issues"]] == [teacher.SEED_ID]
    events = []
    plan = teacher.rewrite_lines(plan, review["issues"], PASSAGES, LLM(), lambda *a: events.append(a),
                                 lambda line: examiner.citation_check(line, PASSAGES))
    rewritten = [e for e in events if e[1] == "rewritten"]
    assert rewritten and rewritten[0][3]["before"].startswith("Firewalls was first standardised")
    assert examiner.check(teacher.lesson_items(plan), PASSAGES, LLM(), noop, "x")["verdict"] == "pass"


# ---------------------------------------------------------------- the demo run: always caught, always fixed

def test_demo_run_guarantees_a_catch_and_a_fix():
    cid = demo.seed(TODAY)
    lesson = db.one("SELECT id FROM lessons WHERE course_id = ? AND status = 'Planned' ORDER BY seq LIMIT 1", (cid,))
    out = orchestrator.job_prepare_lesson(Emitter(None), lesson["id"], LLM(), True)
    assert out["verdict"] == "Passed" and out["caught"] >= 1 and out["fixed"] == out["caught"] and out["rounds"] == 1
    kinds = [e["kind"] for e in db.q("SELECT kind FROM events ORDER BY id")]
    for k in ("drafted", "checked", "caught", "handoff", "rewritten", "rechecked"):
        assert k in kinds, k
    assert kinds.index("caught") < kinds.index("rewritten") < kinds.index("rechecked")
    rewrite = next(e for e in db.q("SELECT data_json FROM events WHERE kind = 'rewritten'"))
    data = json.loads(rewrite["data_json"])
    assert "1987" in data["before"] and "1987" not in data["after"] and data["cites"]


def test_plain_offline_prep_is_not_seeded():
    cid = demo.seed(TODAY)
    lesson = db.one("SELECT id FROM lessons WHERE course_id = ? AND status = 'Planned' ORDER BY seq LIMIT 1", (cid,))
    out = orchestrator.job_prepare_lesson(Emitter(None), lesson["id"], LLM())
    assert "1987" not in json.dumps(out["plan"])


# ---------------------------------------------------------------- SSE: the run streams and then ends

def test_run_stream_yields_steps_and_ends():
    from app import main
    demo.seed(TODAY)
    c = TestClient(main.app)
    r = c.post("/api/agents/demo-run", json={}).json()
    assert r["job_id"] and r["demo"] is True and r["online"] is False
    with c.stream("GET", f"/api/agents/run/{r['job_id']}/stream") as resp:
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = "".join(resp.iter_text())
    evs = _sse(body)
    assert "event: end" in body
    kinds = [e["kind"] for e in evs]
    assert "caught" in kinds and "rewritten" in kinds and "rechecked" in kinds
    assert evs[-1]["agent"] == "Staffroom" and evs[-1]["kind"] == "done"
    assert evs[-1]["data"]["result"]["fixed"] >= 1
    assert all(e["job_id"] == r["job_id"] for e in evs)
    # A replay after the job finished gets the same steps and still ends.
    again = c.get(f"/api/agents/run/{r['job_id']}/stream").text
    assert len(_sse(again)) == len(evs) and "event: end" in again
    assert c.get("/api/agents/run/999999/stream").status_code == 404


def test_public_run_makes_no_model_calls_without_the_flag(monkeypatch):
    from app import llm as llm_mod, main, mode
    monkeypatch.setenv("FASTTRACK_DATA", "demo")
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    monkeypatch.setenv("NEBIUS_API_KEY", "sk-would-cost-money-0123456789")
    mode.bootstrap()

    def no_network(*a, **k):
        raise AssertionError("public mode must not call the model without FASTTRACK_PUBLIC_AI")
    for name in ("chat", "converse", "converse_stream"):
        monkeypatch.setattr(llm_mod.LLM, name, no_network)
    c = TestClient(main.app)
    r = c.post("/api/agents/run", json={}).json()
    assert r["online"] is False and r["demo"] is True
    body = c.get(f"/api/agents/run/{r['job_id']}/stream").text
    assert "rewritten" in body and "event: end" in body
    s = c.post("/api/principal/chat/stream", json={"messages": [
        {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "Who is behind?"}]}]})
    assert s.status_code == 200 and "text-delta" in s.text


# ---------------------------------------------------------------- the Principal, streamed for the AI SDK

def test_principal_chat_stream_offline_speaks_the_ui_message_protocol():
    from app import main
    cid = demo.seed(TODAY)
    c = TestClient(main.app)
    r = c.post("/api/principal/chat/stream", json={"course_id": cid, "messages": [
        {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "Who is behind?"}]}]})
    assert r.status_code == 200 and r.headers["x-vercel-ai-ui-message-stream"] == "v1"
    assert r.text.rstrip().endswith("data: [DONE]")
    parts = _sse(r.text)
    types = [p["type"] for p in parts]
    assert types[0] == "start" and types[-1] == "finish"
    assert "tool-input-available" in types and "tool-output-available" in types
    tool = next(p for p in parts if p["type"] == "tool-output-available")
    assert tool["output"]["records"]
    text = "".join(p["delta"] for p in parts if p["type"] == "text-delta")
    assert types.count("text-delta") > 3                       # streamed, not one blob
    offline = c.post("/api/principal/chat", json={"course_id": cid, "messages": [
        {"role": "user", "content": "Who is behind?"}]}).json()
    assert text == offline["reply"]                            # the JSON endpoint still works, same answer


def test_converse_stream_hides_think_and_counts_tokens():
    class Chunk:
        def __init__(self, t):
            self.choices = [type("C", (), {"delta": type("D", (), {"content": t})()})()]
            self.usage = None

    class Fake:
        def __init__(self):
            self.chat = type("X", (), {"completions": self})()

        def create(self, **k):
            assert k["stream"] is True
            return iter([Chunk(x) for x in ["<thi", "nk>hidden</th", "ink>Hello", " there", ", <b>class</b>."]])

    llm = LLM(api_key="t", client=Fake())
    out = "".join(llm.converse_stream("s", [{"role": "user", "content": "hi"}]))
    assert out == "Hello there, <b>class</b>." and llm.tokens > 0
