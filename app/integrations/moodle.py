"""Moodle web services: the LMS adapter (roster in, grades out later).

Ask the school for a web-service token on a read-only role for one course. Uses the standard
REST endpoint: {site}/webservice/rest/server.php
"""

import httpx


class MoodleError(RuntimeError):
    pass


class Moodle:
    def __init__(self, site: str, token: str, transport: httpx.BaseTransport | None = None):
        self.url = site.rstrip("/") + "/webservice/rest/server.php"
        self.token = token
        self.http = httpx.Client(timeout=30, transport=transport)

    def call(self, function: str, **params):
        data = {"wstoken": self.token, "wsfunction": function, "moodlewsrestformat": "json", **params}
        r = self.http.post(self.url, data=data)
        out = r.json()
        if isinstance(out, dict) and out.get("exception"):
            raise MoodleError(out.get("message") or out["exception"])
        return out

    def enrolled_learners(self, course_id: int) -> list[dict]:
        users = self.call("core_enrol_get_enrolled_users", courseid=course_id)
        out = []
        for u in users:
            roles = {r.get("shortname") for r in u.get("roles", [])}
            if not roles or "student" in roles:
                out.append({"name": u.get("fullname") or f"{u.get('firstname', '')} {u.get('lastname', '')}".strip(),
                            "email": u.get("email", "")})
        return out
