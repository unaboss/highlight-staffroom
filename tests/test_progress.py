"""Show progress, the notes reader behind View plan, and Review classes (dev note 39). Offline only."""

import json

import pytest
from fastapi.testclient import TestClient

from app import db
from tests.test_prep import TODAY, course  # noqa: F401 - reuse the prep test course


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    for key in ("NEBIUS_API_KEY", "AS_OF_DATE", "FASTTRACK_PUBLIC", "FASTTRACK_DATA", "FASTTRACK_PUBLIC_AI", "PUBLIC_URL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("STAFFROOM_DB", str(tmp_path / "test.db"))
    db.reset_for_tests()
    db.set_setting("as_of_date", TODAY.isoformat())
    yield
    db.reset_for_tests()


def client():
    from app.main import app
    return TestClient(app)


def test_progress_has_three_lines_and_the_numbers_behind_them():
    cid, l1, l2, sid = course()
    r = client().get(f"/api/ft/{cid}/progress").json()
    assert r["total"] == 4
    assert r["needed"] == [{"date": "2026-11-02", "pct": 0.0}, {"date": "2026-12-11", "pct": 100.0}]
    assert r["class"][0]["pct"] == 0.0 and r["class"][-1] == {"date": TODAY.isoformat(), "pct": 50.0}   # 2 of 4 passages
    assert r["learners"] == []                                         # nobody on the register
    f = r["facts"]
    assert f["class_pct"] == 50.0 and f["passages_left"] == 2 and f["classes_held"] == 1


def test_counsellor_plan_offline_uses_the_numbers():
    cid, *_ = course()
    p = client().post(f"/api/ft/{cid}/progress/plan").json()
    assert p["online"] is False and p["headline"] and 2 <= len(p["steps"]) <= 5
    assert "50.0%" in p["facts"] and all(s["title"] and s["detail"] for s in p["steps"])


def test_counsellor_plan_with_a_model_keeps_only_well_formed_steps():
    from app.agents import counsellor

    class Fake:
        online, model = True, "fake"
        def json(self, *a, **k):
            return {"headline": "Speed up", "steps": [{"title": "One", "detail": "Do one."}, {"title": "Two", "detail": "Do two."}, {"bad": 1}]}

    facts = {"class_pct": 20.0, "should_be_pct": 40.0, "learner_pct": None, "passages_left": 8, "classes_left": 4,
             "classes_held": 2, "per_class": 1.0, "needed_per_class": 2.0, "learners": 0, "behind": [], "weak_topics": [],
             "days_to_exam": 10}
    p = counsellor.catch_up_plan(facts, Fake())
    assert p["online"] and [s["title"] for s in p["steps"]] == ["One", "Two"]


def test_notes_reader_opens_on_the_next_chapter_and_pages_back():
    cid, l1, l2, _ = course()
    c = client()
    n = c.get(f"/api/ft/{cid}/notes").json()
    assert n["chapter"]["title"] == "Chapter 1: Firewalls" and n["is_next"] and n["prev"] is None
    assert [s["name"] for s in n["sections"]] == ["1.1 What a firewall does", "1.2 Default deny", "1.3 Logging and alerts"]
    nxt = c.get(f"/api/ft/{cid}/notes", params={"topic_id": n["next"]}).json()
    assert nxt["chapter"]["title"] == "Chapter 2: Passwords" and nxt["prev"] == n["chapter"]["topic_id"] and nxt["next"] is None
    assert "passphrases" in nxt["sections"][0]["passages"][0]["text"]
    assert c.get(f"/api/ft/{cid}/notes", params={"topic_id": 99999}).status_code == 404


def test_class_list_and_detail():
    cid, l1, _, sid = course()
    c = client()
    r = c.get(f"/api/ft/{cid}/classes").json()
    assert [x["session_id"] for x in r["classes"]] == [sid] and r["classes"][0]["pct"] == 67
    assert r["timeline"]["lessons"][0]["id"] == l1
    d = c.get(f"/api/ft/{cid}/classes/{sid}").json()
    assert [n["taught"] for n in d["notes"]] == [True, True, False] and [n["n"] for n in d["notes"]] == [1, 2, 3]
    assert d["transcript"][1]["cites"] == [1] and d["transcript"][0]["cites"] == []
    assert d["caught_up"] == {"count": 0, "of": 0, "levels": 3}
    assert c.get(f"/api/ft/{cid}/classes/99999").status_code == 404


def test_demo_has_several_past_classes_with_only_placeholder_voices(monkeypatch):
    from app import mode
    monkeypatch.setenv("FASTTRACK_DATA", "demo")
    cid = mode.bootstrap()["course_id"]
    r = client().get(f"/api/ft/{cid}/classes").json()
    assert len(r["classes"]) >= 3
    past = db.q("SELECT entries_json FROM sessions WHERE course_id = ? AND source = 'sample class (past)'", (cid,))
    assert past
    for s in past:
        voices = {e["speaker"] for e in json.loads(s["entries_json"])}
        assert all(v == "Facilitator" or v.startswith("Sample ") for v in voices), voices


def test_public_mode_shows_only_the_demo_course(monkeypatch):
    from app import mode
    monkeypatch.setenv("FASTTRACK_DATA", "demo")
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    cid = mode.bootstrap()["course_id"]
    other, *_ = course()
    db.update("courses", other, title="Melsoft Network Security")
    db.set_setting("nebius_api_key", "sk-should-not-be-used")
    c = client()
    for path in ("progress", "notes", "classes"):
        assert c.get(f"/api/ft/{other}/{path}").status_code == 404
        page = c.get(f"/api/ft/{cid}/{path}")
        assert page.status_code == 200 and "melsoft" not in page.text.lower()
    assert c.post(f"/api/ft/{other}/progress/plan").status_code == 404
    plan = c.post(f"/api/ft/{cid}/progress/plan").json()
    assert plan["online"] is False                                     # public AI is off unless the gate is enabled
    first = c.get(f"/api/ft/{cid}/classes").json()["classes"][0]["session_id"]
    assert "melsoft" not in c.get(f"/api/ft/{cid}/classes/{first}").text.lower()
