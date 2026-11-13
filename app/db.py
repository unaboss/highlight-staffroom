"""SQLite storage: the agents' shared memory. One file, no server."""

import json
import os
import sqlite3
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = str(ROOT / "data" / "staffroom.db")


def _load_dotenv(path: Path) -> None:
    """Read KEY=VALUE lines from .env into the environment (real environment variables win)."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if key.strip() and value:
            os.environ.setdefault(key.strip(), value)


_load_dotenv(ROOT / ".env")

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY, title TEXT, subject TEXT, grade TEXT, curriculum TEXT,
  teacher TEXT, term_start TEXT, exam_date TEXT, slot_days TEXT, slot_minutes INTEGER,
  meet_code TEXT, clickup_space_id TEXT, clickup_lists TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, course_id INTEGER, title TEXT, kind TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS passages (
  id INTEGER PRIMARY KEY, course_id INTEGER, document_id INTEGER, doc_title TEXT,
  chapter TEXT, section TEXT, page INTEGER, text TEXT);

CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
  text, chapter, section, content='passages', content_rowid='id', tokenize='porter unicode61');

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY, course_id INTEGER, seq INTEGER, title TEXT, minutes INTEGER, keywords TEXT);

CREATE TABLE IF NOT EXISTS learners (
  id INTEGER PRIMARY KEY, course_id INTEGER, name TEXT, email TEXT, consent INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY, course_id INTEGER, seq INTEGER, topic_id INTEGER, part INTEGER, parts INTEGER,
  title TEXT, planned_date TEXT, minutes INTEGER, status TEXT DEFAULT 'Planned',
  plan_json TEXT, passages_json TEXT, review_json TEXT, verdict TEXT, examiner_rounds INTEGER DEFAULT 0,
  clickup_task_id TEXT, taught_on TEXT);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, course_id INTEGER, lesson_id INTEGER, source TEXT, held_on TEXT,
  entries_json TEXT, attendance_json TEXT, report_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS participation (
  id INTEGER PRIMARY KEY, session_id INTEGER, learner_id INTEGER, minutes REAL, turns INTEGER,
  questions INTEGER, answers INTEGER, on_topic INTEGER, score REAL, label TEXT, evidence_json TEXT);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY, learner_id INTEGER, topic_id INTEGER, kind TEXT, score REAL, max REAL, taken_on TEXT);

CREATE TABLE IF NOT EXISTS mastery (
  learner_id INTEGER, topic_id INTEGER, level INTEGER, basis TEXT, PRIMARY KEY (learner_id, topic_id));

CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY, course_id INTEGER, learner_id INTEGER, session_id INTEGER, reason TEXT,
  topics_json TEXT, evidence_json TEXT, clickup_task_id TEXT, status TEXT DEFAULT 'Open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY, course_id INTEGER, learner_id INTEGER, title TEXT, plan_json TEXT,
  questions_json TEXT, passages_json TEXT, review_json TEXT, verdict TEXT, examiner_rounds INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Draft', clickup_task_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, kind TEXT, course_id INTEGER, status TEXT, started TEXT, finished TEXT, result_json TEXT);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, job_id INTEGER, ts TEXT, agent TEXT, kind TEXT, message TEXT, data_json TEXT);
"""

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None
_path: str | None = None


def db_path() -> str:
    return os.environ.get("STAFFROOM_DB", DEFAULT_DB)


def conn() -> sqlite3.Connection:
    """One shared connection guarded by a lock; fine for a single-teacher app."""
    global _conn, _path
    path = db_path()
    with _lock:
        if _conn is None or _path != path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            c = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA journal_mode=MEMORY" if path.startswith("/mnt/") else "PRAGMA journal_mode=WAL")
            c.executescript(SCHEMA)
            _conn, _path = c, path
        return _conn


def reset_for_tests() -> None:
    global _conn, _path
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn, _path = None, None


def q(sql: str, args=()) -> list[dict]:
    with _lock:
        return [dict(r) for r in conn().execute(sql, args).fetchall()]


def one(sql: str, args=()) -> dict | None:
    rows = q(sql, args)
    return rows[0] if rows else None


def run(sql: str, args=()) -> int:
    with _lock:
        cur = conn().execute(sql, args)
        return cur.lastrowid


def insert(table: str, **fields) -> int:
    cols = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    return run(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(fields.values()))


def update(table: str, row_id: int, **fields) -> None:
    sets = ", ".join(f"{k} = ?" for k in fields)
    run(f"UPDATE {table} SET {sets} WHERE id = ?", (*fields.values(), row_id))


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)


def loads(text, default=None):
    if not text:
        return default
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


def get_setting(key: str, default: str = "") -> str:
    row = one("SELECT value FROM settings WHERE key = ?", (key,))
    if row and row["value"]:
        return row["value"]
    return os.environ.get(key.upper(), default)


def set_setting(key: str, value: str) -> None:
    run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value))
