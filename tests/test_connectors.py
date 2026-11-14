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
                "AS_OF_DATE", "FASTTRACK_PUBLIC", "FASTTRACK_PUBLIC_CONNECTORS", "GOOGLE_CLIENT_ID",
                "GOOGLE_CLIENT_SECRET"):
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


def test_public_site_keeps_connectors_in_demo_even_with_keys(monkeypatch):
    _course()
    db.set_setting("clickup_token", "pk_owner_token_123456")
    db.set_setting("google_refresh_token", "1//owner-refresh")
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    s = client().get("/api/connectors").json()
    assert {s["meet"]["mode"], s["moodle"]["mode"], s["clickup"]["mode"]} == {"demo"}
    assert s["google"]["signed_in"] is False and s["google"]["account"] == ""
    assert client().get("/api/connectors/google/start", follow_redirects=False).status_code == 403
    monkeypatch.setenv("FASTTRACK_PUBLIC_CONNECTORS", "1")
    assert connectors.live("clickup")


def test_test_connection_is_remembered_and_goes_stale_when_mode_changes():
    _course()
    c = client()
    assert c.get("/api/connectors").json()["checks"]["clickup"] is None
    c.post("/api/connectors/clickup/test")
    chk = c.get("/api/connectors").json()["checks"]["clickup"]
    assert chk["ok"] and chk["mode"] == "demo" and chk["at"]
    db.set_setting("clickup_token", "pk_now_live_123456")
    assert c.get("/api/connectors").json()["checks"]["clickup"] is None


def test_google_sign_in_redirects_and_refreshes_token(monkeypatch):
    from app import google_auth
    _course()
    c = client()
    assert c.get("/api/connectors/google/start", follow_redirects=False).status_code == 400
    db.set_setting("google_client_id", "id.apps.googleusercontent.com")
    db.set_setting("google_client_secret", "GOCSPX-secret")
    r = c.get("/api/connectors/google/start", follow_redirects=False)
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert r.status_code == 303 and q["access_type"] == ["offline"]
    assert q["redirect_uri"][0].endswith("/api/connectors/google/callback")
    assert "https://www.googleapis.com/auth/meetings.space.readonly" in q["scope"][0]
    assert c.get("/api/connectors/google/callback?code=x&state=wrong", follow_redirects=False).status_code == 400

    calls = []

    class Resp:
        status_code = 200
        def json(self):
            return {"access_token": "ya29.fresh", "expires_in": 3600}

    monkeypatch.setattr(google_auth.httpx, "post", lambda url, **kw: calls.append(kw["data"]) or Resp())
    db.set_setting("google_refresh_token", "1//refresh")
    assert connectors.live("meet")
    assert google_auth.access_token() == "ya29.fresh"
    assert google_auth.access_token() == "ya29.fresh" and len(calls) == 1      # cached until near expiry
    assert calls[0]["grant_type"] == "refresh_token"
