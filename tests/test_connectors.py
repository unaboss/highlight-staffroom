"""Connectors in demo mode (no credentials, no network): launch links, ClickUp follow-ups, grades, Meet."""

import time
from datetime import date
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app import connectors, db, demo, fasttrack

TODAY = date(2026, 11, 13)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    for key in ("NEBIUS_API_KEY", "CLICKUP_TOKEN", "GOOGLE_ACCESS_TOKEN", "MOODLE_URL", "MOODLE_TOKEN",
                "AS_OF_DATE", "FASTTRACK_PUBLIC"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("STAFFROOM_DB", str(tmp_path / "test.db"))
    db.reset_for_tests()
    db.set_setting("as_of_date", TODAY.isoformat())
    yield
    db.reset_for_tests()


def client():
    from app.main import app
    return TestClient(app)


def _course():
    cid = demo.seed(TODAY)
    lid = db.insert("learners", course_id=cid, name="Thandi", email="thandi@example.com", consent=1)
    topic = db.one("SELECT id FROM topics WHERE course_id = ? ORDER BY seq LIMIT 1", (cid,))["id"]
    return cid, lid, topic


def test_status_is_demo_without_credentials():
    _course()
    s = client().get("/api/connectors").json()
    assert {s["meet"]["mode"], s["moodle"]["mode"], s["clickup"]["mode"]} == {"demo"}
    assert client().post("/api/connectors/clickup/test").json()["mode"] == "demo"


def test_signed_launch_link_signs_in_and_rejects_tampering():
    cid, lid, topic = _course()
    c = client()
    url = c.get(f"/api/connectors/moodle/launch-link?learner_id={lid}&topic_id={topic}&course_id={cid}").json()["url"]
    u = urlparse(url)
    r = c.get(f"{u.path}?{u.query}", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == f"/fast-track/?role=student&learner={lid}#/play/chapter/{topic}"
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    q["l"] = str(lid + 1)
    assert c.get(u.path, params=q, follow_redirects=False).status_code == 403
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    q["exp"] = str(int(time.time()) - 10)
    assert c.get(u.path, params=q, follow_redirects=False).status_code == 403


def test_clickup_task_opens_for_flagged_learner_and_closes_on_final_quiz(monkeypatch):
    cid, lid, topic = _course()
    monkeypatch.setattr(connectors, "flagged", lambda c: [{"learner_id": lid, "name": "Thandi", "topic_id": topic,
                                                           "title": "x", "top": 0, "missed": 1}])
    out = client().post("/api/connectors/clickup/sync", json={"course_id": cid}).json()
    assert out["opened"] == 1 and out["tasks"][0]["status"] == "open" and out["tasks"][0]["mode"] == "demo"
    assert "/lms/launch?" in out["tasks"][0]["url"]
    again = client().post("/api/connectors/clickup/sync", json={"course_id": cid}).json()
    assert again["opened"] == 0                                   # one task per learner and chapter

    monkeypatch.setattr(connectors.threading, "Thread",
                        lambda target, daemon: type("T", (), {"start": lambda self: target()})())
    answers = [{"ok": True, "xp": 10}] * 5
    fasttrack.record(lid, topic, fasttrack.QUIZ_LEVEL, answers, TODAY)
    assert db.one("SELECT status FROM ft_tasks WHERE learner_id = ?", (lid,))["status"] == "closed"
    g = db.one("SELECT * FROM ft_grades WHERE learner_id = ?", (lid,))
    assert g["status"] == "sent" and g["mode"] == "demo" and g["score"] == 5


def test_meet_demo_import_creates_a_scored_session():
    cid, _, _ = _course()
    out = client().post("/api/connectors/meet/import", json={"course_id": cid}).json()
    assert out["mode"] == "demo" and out["attendees"] > 0 and out["lines"] > 0
    assert db.one("SELECT source FROM sessions WHERE id = ?", (out["session_id"],))["source"] == "meet:demo"


def test_public_demo_keeps_connector_config_read_only(monkeypatch):
    _course()
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    assert client().post("/api/connectors/config", json={"meet_code": "abc"}).status_code == 403
