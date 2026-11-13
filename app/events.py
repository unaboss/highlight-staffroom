"""Event bus: every agent step is stored and streamed to the dashboard's live staffroom board."""

import queue
import threading
from datetime import datetime, timezone

from . import db

_subscribers: list[queue.Queue] = []
_sub_lock = threading.Lock()


def subscribe() -> queue.Queue:
    qu: queue.Queue = queue.Queue(maxsize=2000)
    with _sub_lock:
        _subscribers.append(qu)
    return qu


def unsubscribe(qu: queue.Queue) -> None:
    with _sub_lock:
        if qu in _subscribers:
            _subscribers.remove(qu)


def emit(job_id: int | None, agent: str, kind: str, message: str, data: dict | None = None) -> dict:
    """kind: start | work | handoff | pass | reject | done | warn | error | sync"""
    ts = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    event_id = db.insert("events", job_id=job_id, ts=ts, agent=agent, kind=kind, message=message,
                         data_json=db.dumps(data or {}))
    event = {"id": event_id, "job_id": job_id, "ts": ts, "agent": agent, "kind": kind,
             "message": message, "data": data or {}}
    with _sub_lock:
        subs = list(_subscribers)
    for qu in subs:
        try:
            qu.put_nowait(event)
        except queue.Full:
            pass
    return event


class Emitter:
    """Bound to one job so agents just call emit(agent, kind, message)."""

    def __init__(self, job_id: int | None):
        self.job_id = job_id

    def __call__(self, agent: str, kind: str, message: str, data: dict | None = None) -> dict:
        return emit(self.job_id, agent, kind, message, data)


def recent(limit: int = 200, job_id: int | None = None) -> list[dict]:
    if job_id:
        rows = db.q("SELECT * FROM events WHERE job_id = ? ORDER BY id DESC LIMIT ?", (job_id, limit))
    else:
        rows = db.q("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))
    out = []
    for r in reversed(rows):
        r["data"] = db.loads(r.pop("data_json"), {})
        out.append(r)
    return out
