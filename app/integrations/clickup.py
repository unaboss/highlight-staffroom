"""ClickUp: the teacher's working board. Lessons, learner follow-ups and draft tests become tasks.

Uses ClickUp API v2 with a personal token (ClickUp > Settings > Apps). Every call is best-effort:
if ClickUp is down or not connected, the agents carry on and the dashboard still has everything.
Approval works by polling (no public URL needed) and also via the webhook endpoint.
"""

from datetime import datetime, time, timezone

import httpx

from .. import db

API = "https://api.clickup.com/api/v2"
LISTS = {"lessons": "Lesson plan", "followups": "Learner follow-ups", "tests": "Tests: needs approval"}
FIELD_NAMES = {"score": "Participation score", "mastery": "Mastery", "difficulty": "Difficulty",
               "verdict": "Examiner verdict", "cited": "Sources cited"}


class ClickUpError(RuntimeError):
    pass


class ClickUp:
    def __init__(self, token: str, transport: httpx.BaseTransport | None = None):
        self.token = token
        self.http = httpx.Client(base_url=API, timeout=20, transport=transport,
                                 headers={"Authorization": token, "Content-Type": "application/json"})
        self._fields: dict[str, dict[str, str]] = {}

    def _req(self, method: str, path: str, **kw) -> dict:
        r = self.http.request(method, path, **kw)
        if r.status_code >= 400:
            raise ClickUpError(f"ClickUp {method} {path} -> {r.status_code}: {r.text[:200]}")
        return r.json() if r.content else {}

    # -- workspace
    def teams(self) -> list[dict]:
        return self._req("GET", "/team").get("teams", [])

    def spaces(self, team_id: str) -> list[dict]:
        return self._req("GET", f"/team/{team_id}/space").get("spaces", [])

    def create_space(self, team_id: str, name: str) -> dict:
        return self._req("POST", f"/team/{team_id}/space", json={"name": name, "multiple_assignees": True})

    def space_lists(self, space_id: str) -> list[dict]:
        return self._req("GET", f"/space/{space_id}/list").get("lists", [])

    def create_list(self, space_id: str, name: str) -> dict:
        return self._req("POST", f"/space/{space_id}/list", json={"name": name})

    def list_info(self, list_id: str) -> dict:
        return self._req("GET", f"/list/{list_id}")

    def list_fields(self, list_id: str) -> dict[str, str]:
        if list_id not in self._fields:
            fields = self._req("GET", f"/list/{list_id}/field").get("fields", [])
            self._fields[list_id] = {f["name"].strip().lower(): f["id"] for f in fields}
        return self._fields[list_id]

    # -- tasks
    def create_task(self, list_id: str, name: str, markdown: str = "", status: str | None = None,
                    tags: list[str] | None = None, due: str | None = None) -> dict:
        body = {"name": name[:250], "markdown_description": markdown, "tags": tags or []}
        if status:
            body["status"] = status
        if due:
            d = datetime.combine(datetime.fromisoformat(due).date(), time(8, 0), tzinfo=timezone.utc)
            body["due_date"] = int(d.timestamp() * 1000)
        return self._req("POST", f"/list/{list_id}/task", json=body)

    def update_task(self, task_id: str, **fields) -> dict:
        return self._req("PUT", f"/task/{task_id}", json=fields)

    def get_task(self, task_id: str) -> dict:
        return self._req("GET", f"/task/{task_id}")

    def comment(self, task_id: str, text: str) -> dict:
        return self._req("POST", f"/task/{task_id}/comment", json={"comment_text": text, "notify_all": False})

    def set_field(self, list_id: str, task_id: str, key: str, value) -> bool:
        """Set a custom field if the teacher created one with the expected name; skip quietly if not."""
        field_id = self.list_fields(list_id).get(FIELD_NAMES[key].lower())
        if not field_id:
            return False
        self._req("POST", f"/task/{task_id}/field/{field_id}", json={"value": value})
        return True

    def create_webhook(self, team_id: str, endpoint: str) -> dict:
        return self._req("POST", f"/team/{team_id}/webhook",
                         json={"endpoint": endpoint, "events": ["taskStatusUpdated"]})


# ---------------------------------------------------------------- app glue

def client() -> ClickUp | None:
    token = db.get_setting("clickup_token")
    return ClickUp(token) if token else None


def course_lists(course: dict) -> dict:
    return db.loads(course.get("clickup_lists"), {}) or {}


def connected(course: dict) -> bool:
    return bool(db.get_setting("clickup_token") and course_lists(course))


def setup_course(course_id: int, team_id: str | None = None) -> dict:
    """Create (or reuse) a Space for the course with the three Lists."""
    cu = client()
    if not cu:
        raise ClickUpError("Add a ClickUp token in Settings first")
    course = db.one("SELECT * FROM courses WHERE id = ?", (course_id,))
    team_id = team_id or db.get_setting("clickup_team_id")
    if not team_id:
        teams = cu.teams()
        if not teams:
            raise ClickUpError("This ClickUp token can't see any Workspace")
        team_id = str(teams[0]["id"])
        db.set_setting("clickup_team_id", team_id)
    name = f"Staffroom: {course['title']}"[:100]
    space = next((s for s in cu.spaces(team_id) if s.get("name") == name), None) or cu.create_space(team_id, name)
    existing = {l["name"]: str(l["id"]) for l in cu.space_lists(str(space["id"]))}
    lists = {}
    for key, list_name in LISTS.items():
        lists[key] = existing.get(list_name) or str(cu.create_list(str(space["id"]), list_name)["id"])
    db.update("courses", course_id, clickup_space_id=str(space["id"]), clickup_lists=db.dumps(lists))
    return {"team_id": team_id, "space_id": str(space["id"]), "lists": lists}


def statuses(cu: ClickUp, list_id: str) -> list[dict]:
    try:
        return cu.list_info(list_id).get("statuses", []) or []
    except ClickUpError:
        return []


def pick_status(sts: list[dict], want: str) -> str | None:
    """Map our states onto whatever statuses the List has (defaults are usually 'to do' / 'complete')."""
    if not sts:
        return None
    names = [s.get("status", "") for s in sts]
    low = [n.lower() for n in names]
    prefs = {
        "open": ["planned", "to do", "open", "needs approval", "backlog"],
        "middle": ["taught", "in progress", "review", "in review"],
        "closed": ["reviewed", "approved", "complete", "done", "closed"],
    }[want]
    for p in prefs:
        if p in low:
            return names[low.index(p)]
    if want == "closed":
        closed = [s["status"] for s in sts if s.get("type") in ("closed", "done")]
        return closed[0] if closed else names[-1]
    if want == "middle" and len(names) > 2:
        return names[1]
    return names[0]


def is_approved(task: dict) -> bool:
    st = task.get("status") or {}
    name = (st.get("status") or "").lower()
    return st.get("type") in ("closed", "done") or any(w in name for w in ("approv", "complete", "done", "release"))
