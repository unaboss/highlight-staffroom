"""Lesson prep (dev note 30): transcript-to-notes coverage, the timeline, the cited deck and its edits,
Wikimedia images and the Meet recording thumbnail. Offline: every outside call goes to a mock transport."""

import json
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient

from app import db, prep
from app.agents import librarian
from app.integrations.meet import Meet

TODAY = date(2026, 11, 13)

NOTES = """# Chapter 1: Firewalls
## 1.1 What a firewall does
A firewall inspects network traffic and decides whether to allow or block packets, using rules about the source address, the destination port and the protocol.

## 1.2 Default deny
A default deny rule set blocks everything unless an explicit rule allows the traffic, which keeps forgotten services closed to attackers.

## 1.3 Logging and alerts
Firewall logs record dropped connections so administrators can spot scanning, brute force attempts and misconfigured clients early.

# Chapter 2: Passwords
## 2.1 Strong passwords
Long passphrases made of several random words resist guessing and dictionary attacks better than short complex passwords.
"""

TRANSCRIPT = [
    {"start": 5, "end": 20, "speaker": "Ms Dlamini", "text": "Good morning. Can everyone hear me?"},
    {"start": 60, "end": 90, "speaker": "Ms Dlamini", "text": "A firewall inspects traffic and decides to allow or block packets using rules about the source address and the destination port."},
    {"start": 120, "end": 140, "speaker": "Thabo", "text": "So with default deny it blocks everything unless an explicit rule allows the traffic?"},
    {"start": 150, "end": 170, "speaker": "Ms Dlamini", "text": "Exactly, and forgotten services stay closed. We'll stop there for today."},
]


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    for key in ("NEBIUS_API_KEY", "CLICKUP_TOKEN", "GOOGLE_ACCESS_TOKEN", "MOODLE_URL", "MOODLE_TOKEN", "AS_OF_DATE",
                "FASTTRACK_PUBLIC", "PUBLIC_URL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("STAFFROOM_DB", str(tmp_path / "test.db"))
    db.reset_for_tests()
    db.set_setting("as_of_date", TODAY.isoformat())
    yield
    db.reset_for_tests()


def client():
    from app.main import app
    return TestClient(app)


def course(with_session=True):
    cid = db.insert("courses", title="Prep test", subject="Network security", grade="", curriculum="", teacher="Ms Dlamini",
                    term_start="2026-11-02", exam_date="2026-12-11", slot_days="[0,2,4]", slot_minutes=45)
    librarian.ingest_file(cid, "notes.md", NOTES.encode())
    t1 = db.insert("topics", course_id=cid, seq=1, title="Chapter 1: Firewalls", minutes=45, keywords="firewall")
    t2 = db.insert("topics", course_id=cid, seq=2, title="Chapter 2: Passwords", minutes=45, keywords="passwords")
    l1 = db.insert("lessons", course_id=cid, seq=1, topic_id=t1, part=1, parts=1, title="Chapter 1: Firewalls",
                   planned_date="2026-11-13", minutes=45, status="Planned")
    l2 = db.insert("lessons", course_id=cid, seq=2, topic_id=t2, part=1, parts=1, title="Chapter 2: Passwords",
                   planned_date="2026-11-16", minutes=45, status="Planned")
    sid = None
    if with_session:
        entries = [{**e, "i": i} for i, e in enumerate(TRANSCRIPT)]
        att = [{"name": "Ms Dlamini", "minutes": 45}, {"name": "Thabo", "minutes": 44}, {"name": "Lerato", "minutes": 12}]
        sid = db.insert("sessions", course_id=cid, lesson_id=l1, source="upload", held_on="2026-11-13",
                        entries_json=json.dumps(entries), attendance_json=json.dumps(att))
    return cid, l1, l2, sid


def plan_lesson(lid: int, cid: int) -> None:
    rows = db.q("SELECT * FROM passages WHERE course_id = ? AND chapter = 'Chapter 1: Firewalls' ORDER BY id", (cid,))
    passages = librarian.number(rows)
    plan = {"title": "Firewalls", "objectives": ["Learners can explain what a firewall does [P1]"],
            "explanation": ["A firewall inspects traffic and allows or blocks packets by rules [P1]. Rules look at addresses and ports.",
                            "Default deny blocks everything unless a rule allows it [P2].",
                            "Logs record dropped connections [P3]. Administrators read them to spot scanning [P3]."],
            "worked_example": "", "activity": "Pairs sketch a rule table.",
            "check_questions": [{"q": "What does default deny mean?", "answer": "Everything is blocked unless a rule allows it [P2]"}],
            "gaps": []}
    db.update("lessons", lid, plan_json=json.dumps(plan), passages_json=json.dumps(passages), verdict="Passed")


def test_transcript_lines_map_to_the_sections_they_teach():
    cid, l1, _, sid = course()
    entries = json.loads(db.one("SELECT entries_json FROM sessions WHERE id = ?", (sid,))["entries_json"])
    cov = prep.match_transcript(cid, "Chapter 1: Firewalls", entries)
    states = {s["name"]: s["state"] for s in cov["sections"]}
    assert states["1.1 What a firewall does"] == "covered"
    assert states["1.2 Default deny"] != "not_reached"
    assert states["1.3 Logging and alerts"] == "not_reached"          # never mentioned in class
    assert cov["furthest"] == "1.2 Default deny" and cov["upto"] == 2 and cov["passages_total"] == 3
    assert cov["lines_matched"] == 2                                  # greetings and "we'll stop" match nothing
    full = prep.session_coverage(cid, prep._sessions(cid)[0])
    assert {e["line"] for e in full["evidence"]} == {1, 2} and all(e["where"] for e in full["evidence"])


def test_prep_endpoint_timeline_last_class_and_pace():
    cid, l1, l2, sid = course()
    r = client().get(f"/api/ft/{cid}/prep").json()
    tl = r["timeline"]
    assert [l["id"] for l in tl["lessons"]] == [l1, l2] and tl["lessons"][0]["state"] == "next"
    assert tl["chapters"][0]["transcript_pct"] == 67 and tl["chapters"][1]["transcript_pct"] == 0
    assert tl["chapters"][0]["sections"] == ["1.1 What a firewall does", "1.2 Default deny", "1.3 Logging and alerts"]
    last = r["last_class"]
    assert last["session_id"] == sid and last["teacher"] == "Ms Dlamini" and last["present"] == 3 and last["minutes"] == 45
    assert last["thumbnail"] is None and last["source"] == "upload"   # no Meet recording: the page draws the card
    assert r["coverage"]["furthest"] == "1.2 Default deny"
    assert r["pace"]["advanced"] == 2 and r["pace"]["remaining"] == 2 and r["pace"]["classes_needed"] == 1
    assert r["lesson"]["id"] == l1 and r["lesson"]["is_next"]
    assert client().get(f"/api/ft/{cid}/prep?lesson_id={l2}").json()["lesson"]["is_next"] is False
    assert client().get(f"/api/ft/{cid}/prep?lesson_id=99999").status_code == 404


def test_deck_is_cited_and_cuts_what_was_taught_before_the_stop():
    cid, l1, _, _ = course()
    c = client()
    assert c.get(f"/api/lessons/{l1}/deck").json()["deck"] is None    # not prepared yet
    plan_lesson(l1, cid)
    c.post(f"/api/lessons/{l1}/progress", json={"stopped_section": "1.2 Default deny", "finished": False})
    d = c.get(f"/api/lessons/{l1}/deck").json()
    deck = d["deck"]
    assert not d["edited"] and deck["stop"] == "1.2 Default deny" and deck["stop_from"] == "recorded"
    kinds = [s["kind"] for s in deck["slides"]]
    assert kinds[0] == "title" and kinds[-1] == "sources" and "recap" in kinds and "check" in kinds
    ideas = [s for s in deck["slides"] if s["kind"] == "idea"]
    assert ideas[0]["cut"] and "stop point" in ideas[0]["cut_reason"]          # 1.1 was taught before the stop
    assert not ideas[1]["cut"] and not ideas[2]["cut"]
    for s in ideas:                                                          # every bullet carries a citation
        assert all("[P" in b["text"] for b in s["bullets"])
    assert ideas[0]["bullets"][1]["text"].endswith("[P1]")                   # an uncited sentence borrows its paragraph's
    recap = next(s for s in deck["slides"] if s["kind"] == "recap")
    assert all("[T" in b["text"] for b in recap["bullets"])
    assert {t["line"] for t in deck["transcript"]} >= {1, 2}
    assert next(s for s in deck["slides"] if s["kind"] == "check")["bullets"][0]["answer"].endswith("[P2]")


def test_deck_edits_keep_server_text_and_added_slides_are_cited(tmp_path):
    cid, l1, _, _ = course()
    plan_lesson(l1, cid)
    c = client()
    deck = c.get(f"/api/lessons/{l1}/deck").json()["deck"]
    slides = deck["slides"]
    idea = next(s for s in slides if s["kind"] == "idea")
    forged = [dict(s) for s in slides] + [{"id": "evil", "kind": "idea", "title": "Made up", "bullets": [{"id": "x", "text": "Lies"}]}]
    k = next(i for i, s in enumerate(forged) if s["id"] == idea["id"])
    forged[k] = {**idea, "cut": True, "notes": "Use the whiteboard",
                 "bullets": [{**idea["bullets"][0], "text": "Firewalls stop all viruses [P1]", "cut": True}] + idea["bullets"][1:],
                 "image": {"src": "https://evil.example/x.png", "credit": "me"}}
    out = c.post(f"/api/lessons/{l1}/deck", json={"slides": forged}).json()
    got = next(s for s in out["deck"]["slides"] if s["id"] == idea["id"])
    assert out["edited"] and got["cut"] and got["notes"] == "Use the whiteboard" and got["image"] is None
    assert got["bullets"][0]["cut"] and got["bullets"][0]["text"] == idea["bullets"][0]["text"]   # text stays the server's
    assert not any(s["id"] == "evil" for s in out["deck"]["slides"])
    assert c.get(f"/api/lessons/{l1}/deck").json()["edited"]

    cands = c.get(f"/api/lessons/{l1}/deck/passages").json()
    pid = cands[2]["pid"]                                                     # 1.3 Logging and alerts
    added = c.post(f"/api/lessons/{l1}/deck/slides", json={"pid": pid, "after": idea["id"]}).json()["deck"]
    k = next(i for i, s in enumerate(added["slides"]) if s["id"] == f"add{pid}")
    assert added["slides"][k - 1]["id"] == idea["id"] and added["slides"][k]["title"] == "1.3 Logging and alerts"
    n = next(s["n"] for s in added["sources"] if s["pid"] == pid)
    assert all(b["text"].endswith(f"[P{n}]") for b in added["slides"][k]["bullets"])
    assert c.post(f"/api/lessons/{l1}/deck/slides", json={"pid": pid}).status_code == 400
    reset = c.delete(f"/api/lessons/{l1}/deck").json()
    assert not reset["edited"] and not any(s["id"].startswith("add") for s in reset["deck"]["slides"])


def commons_transport(seen: list):
    def handler(req: httpx.Request):
        seen.append(req)
        if req.url.host == "commons.wikimedia.org":
            info = {"thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fw.jpg/640px-Fw.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Fw.jpg", "mime": "image/jpeg",
                    "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 4.0"}, "Artist": {"value": "<a href='x'>Jo Bloggs</a>"}}}
            pages = [{"title": "File:Fw.jpg", "index": 1, "imageinfo": [info]},
                     {"title": "File:NoLicence.jpg", "index": 2, "imageinfo": [{**info, "extmetadata": {}}]}]
            if req.url.params.get("titles") == "File:Elsewhere.jpg":
                pages = [{"title": "File:Elsewhere.jpg", "imageinfo": [{**info, "thumburl": "https://evil.example/a.jpg"}]}]
            return httpx.Response(200, json={"query": {"pages": pages}})
        if req.url.host == "upload.wikimedia.org":
            return httpx.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})
        return httpx.Response(404)
    return httpx.MockTransport(handler)


def test_images_come_only_from_commons_with_their_credit():
    seen: list = []
    hits = prep.search_images("firewall", "https://school.example", commons_transport(seen))
    assert [h["title"] for h in hits] == ["File:Fw.jpg"]                       # no licence, no result
    assert hits[0]["artist"] == "Jo Bloggs" and hits[0]["license"] == "CC BY-SA 4.0"
    assert "+https://school.example" in seen[0].headers["user-agent"]            # Wikimedia asks for a contact
    meta = prep.save_image("File:Fw.jpg", "https://school.example", commons_transport(seen))
    assert meta["credit"] == "Jo Bloggs, CC BY-SA 4.0, via Wikimedia Commons" and meta["src"].startswith("/api/prep/images/")
    r = client().get(meta["src"])
    assert r.status_code == 200 and r.content == b"\xff\xd8jpeg" and r.headers["content-type"] == "image/jpeg"
    assert prep._image_meta(meta["src"])["credit"] == meta["credit"]
    with pytest.raises(Exception):
        prep.save_image("File:Elsewhere.jpg", "", commons_transport(seen))      # a thumb off Wikimedia is refused
    with pytest.raises(Exception):
        prep.save_image("https://evil.example/a.jpg", "", commons_transport(seen))
    assert client().get("/api/prep/images/..%2F..%2Fstaffroom.db").status_code == 404


def test_meet_recording_thumbnail_only_goes_to_google():
    def handler(req: httpx.Request):
        p = req.url.path
        if p.endswith("/recordings"):
            return httpx.Response(200, json={"recordings": [{"driveDestination": {"file": "f1"}}]})
        if p.endswith("/files/f1"):
            return httpx.Response(200, json={"thumbnailLink": link})
        if req.url.host == "lh3.googleusercontent.com":
            assert req.headers["authorization"] == "Bearer ya29.test"
            return httpx.Response(200, content=b"png", headers={"content-type": "image/png"})
        raise AssertionError(f"token sent to {req.url.host}")

    link = "https://lh3.googleusercontent.com/thumb=s220"
    meet = Meet("ya29.test", transport=httpx.MockTransport(handler))
    assert meet.recording_thumbnail("conferenceRecords/r1") == b"png"
    link = "https://evil.example/thumb"
    assert meet.recording_thumbnail("conferenceRecords/r1") is None

    cid, l1, _, sid = course()
    assert client().get(f"/api/ft/sessions/{sid}/thumbnail").status_code == 404     # an upload has no recording


def test_public_demo_prep_page_works_offline_and_never_fetches_images(monkeypatch):
    import httpx
    from fastapi.testclient import TestClient
    from app import main, mode
    monkeypatch.setenv("FASTTRACK_DATA", "demo")
    monkeypatch.setenv("FASTTRACK_PUBLIC", "1")
    cid = mode.bootstrap()["course_id"]
    def no_network(*a, **k):
        raise AssertionError("public demo must not reach the internet")
    monkeypatch.setattr(httpx.Client, "send", no_network)
    c = TestClient(main.app)
    page = c.get(f"/api/ft/{cid}/prep")
    assert page.status_code == 200 and "melsoft" not in page.text.lower()
    assert c.get("/api/prep/images", params={"q": "firewall"}).status_code == 403
    assert c.post("/api/prep/images", json={"title": "File:Firewall.png"}).status_code == 403
