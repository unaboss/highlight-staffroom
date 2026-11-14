"""Google Meet REST API (v2): pull a class's register and transcript after it ends.

Needs an OAuth access token with the meetings.space.readonly scope (for a quick test, the
Google OAuth Playground works). Transcription must be switched on in the class's Meet, and
transcript entries are kept for 30 days, so pull soon after class.
"""

from datetime import datetime

import httpx

API = "https://meet.googleapis.com/v2"
DRIVE = "https://www.googleapis.com/drive/v3"


class MeetError(RuntimeError):
    pass


def _t(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


class Meet:
    def __init__(self, token: str, transport: httpx.BaseTransport | None = None):
        self.http = httpx.Client(base_url=API, timeout=30, transport=transport,
                                 headers={"Authorization": f"Bearer {token}"})

    def _get_all(self, path: str, key: str, params: dict | None = None) -> list[dict]:
        out, token = [], None
        while True:
            p = dict(params or {})
            if token:
                p["pageToken"] = token
            r = self.http.get(path, params=p)
            if r.status_code >= 400:
                raise MeetError(f"Meet {path} -> {r.status_code}: {r.text[:200]}")
            data = r.json()
            out += data.get(key, [])
            token = data.get("nextPageToken")
            if not token:
                return out

    def latest_record(self, meeting_code: str) -> dict:
        recs = self._get_all("/conferenceRecords", "conferenceRecords",
                             {"filter": f'space.meeting_code = "{meeting_code}"'})
        if not recs:
            raise MeetError(f"No finished Meet calls found for meeting code {meeting_code}")
        return max(recs, key=lambda r: r.get("startTime", ""))

    def class_data(self, meeting_code: str) -> tuple[list[dict], list[dict], dict]:
        """Returns (transcript entries, attendance, record) in Staffroom's own shapes."""
        rec = self.latest_record(meeting_code)
        start = _t(rec.get("startTime"))
        people = self._get_all(f"/{rec['name']}/participants", "participants")
        names, attendance = {}, []
        for p in people:
            who = (p.get("signedinUser") or p.get("anonymousUser") or p.get("phoneUser") or {})
            name = who.get("displayName") or "Unknown"
            names[p["name"]] = name
            minutes = 0.0
            for s in self._get_all(f"/{p['name']}/participantSessions", "participantSessions"):
                a, b = _t(s.get("startTime")), _t(s.get("endTime"))
                if a and b:
                    minutes += (b - a).total_seconds() / 60
            attendance.append({"name": name, "minutes": round(minutes, 1),
                               "joined": p.get("earliestStartTime", ""), "left": p.get("latestEndTime", "")})
        entries = []
        for tr in self._get_all(f"/{rec['name']}/transcripts", "transcripts"):
            for e in self._get_all(f"/{tr['name']}/entries", "transcriptEntries"):
                a, b = _t(e.get("startTime")), _t(e.get("endTime"))
                entries.append({"start": (a - start).total_seconds() if a and start else 0.0,
                                "end": (b - start).total_seconds() if b and start else 0.0,
                                "speaker": names.get(e.get("participant"), "Unknown"),
                                "text": e.get("text", "")})
        entries.sort(key=lambda e: e["start"])
        for i, e in enumerate(entries):
            e["i"] = i
        if not entries:
            raise MeetError("The call has no transcript. Turn on transcription in Meet for the class.")
        return entries, attendance, rec

    def recording_thumbnail(self, record_name: str) -> bytes | None:
        """The class recording's thumbnail, from the Drive file Meet saved it to. Needs the token to
        also carry a Drive read scope (drive.meet.readonly or drive.readonly). None if there isn't one."""
        for rec in self._get_all(f"/{record_name}/recordings", "recordings"):
            fid = (rec.get("driveDestination") or {}).get("file")
            if not fid:
                continue
            r = self.http.get(f"{DRIVE}/files/{fid}", params={"fields": "thumbnailLink"})
            if r.status_code >= 400:
                raise MeetError(f"Drive file -> {r.status_code}")
            link = r.json().get("thumbnailLink") or ""
            host = httpx.URL(link).host if link else ""
            if not (host.endswith(".googleusercontent.com") or host.endswith(".google.com")):
                continue                         # never send the token anywhere but Google
            img = self.http.get(link)
            if img.status_code < 400 and img.headers.get("content-type", "").startswith("image/"):
                return img.content
        return None
