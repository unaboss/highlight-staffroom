"""Librarian: the only agent allowed to fetch course content.

It indexes the school's own material (notes, textbook, syllabus) into SQLite FTS5 and hands
other agents a numbered list of passages [P1], [P2], ... Anything not in that list can't be
cited, which is what keeps the rest of the staff honest. The search loop is the planner from
Ask the Commission: plan keyword searches, read what came back, search again if needed.
"""

import io
import re

from .. import db
from ..textutil import to_fts_query

MAX_ROUNDS = 2
PER_QUERY = 6
MAX_PASSAGES = 12
CHUNK_WORDS = 110

PLANNER_SYSTEM = """You are the school librarian. A teacher needs course material on one topic.
You can run keyword searches (BM25 over the course notes and textbook).
Reply in one of these forms:
{"action": "search", "reason": "<short>", "queries": ["<keywords>", "..."]}
{"action": "done", "reason": "<why the passages already cover the topic>"}
Rules: 1 to 4 queries per round; use distinctive terms, synonyms and abbreviations
(e.g. "MFA", "multi-factor authentication"). Choose "done" once the passages cover the topic."""


# ---------------------------------------------------------------- ingest

def _flush(buf, meta, out):
    text = " ".join(" ".join(buf).split())
    if len(text) > 40:
        out.append({**meta, "text": text})
    buf.clear()


def chunk_markdown(text: str, doc_title: str) -> list[dict]:
    """Split notes into passages, keeping chapter, section and page for citations.

    Page numbers come from <!-- page N --> markers when the notes have them.
    """
    out, buf = [], []
    meta = {"doc_title": doc_title, "chapter": doc_title, "section": "", "page": None}
    words = 0
    for raw in text.splitlines():
        line = raw.strip()
        m_page = re.match(r"<!--\s*page\s+(\d+)\s*-->", line, re.I)
        if m_page:
            _flush(buf, meta, out); words = 0
            meta = {**meta, "page": int(m_page.group(1))}
            continue
        if line.startswith("# "):
            _flush(buf, meta, out); words = 0
            meta = {**meta, "chapter": line[2:].strip(), "section": ""}
            continue
        if line.startswith("## ") or line.startswith("### "):
            _flush(buf, meta, out); words = 0
            meta = {**meta, "section": line.lstrip("#").strip()}
            continue
        if not line:
            if words >= CHUNK_WORDS:
                _flush(buf, meta, out); words = 0
            continue
        buf.append(line.lstrip("-* ").strip() if line[:2] in ("- ", "* ") else line)
        words += len(line.split())
    _flush(buf, meta, out)
    return out


def chunk_pdf(data: bytes, doc_title: str) -> list[dict]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    out = []
    for page_no, page in enumerate(reader.pages, 1):
        paras = [p.strip() for p in re.split(r"\n\s*\n", page.extract_text() or "") if p.strip()]
        buf, words = [], 0
        meta = {"doc_title": doc_title, "chapter": doc_title, "section": "", "page": page_no}
        for p in paras:
            buf.append(p)
            words += len(p.split())
            if words >= CHUNK_WORDS:
                _flush(buf, meta, out); words = 0
        _flush(buf, meta, out)
    return out


def ingest(course_id: int, title: str, chunks: list[dict], kind: str = "notes") -> int:
    doc_id = db.insert("documents", course_id=course_id, title=title, kind=kind)
    for c in chunks:
        pid = db.insert("passages", course_id=course_id, document_id=doc_id, doc_title=c["doc_title"],
                        chapter=c["chapter"], section=c["section"], page=c["page"], text=c["text"])
        db.run("INSERT INTO passages_fts (rowid, text, chapter, section) VALUES (?, ?, ?, ?)",
               (pid, c["text"], c["chapter"], c["section"]))
    return doc_id


def ingest_file(course_id: int, filename: str, data: bytes) -> tuple[int, int]:
    title = re.sub(r"\.[A-Za-z0-9]+$", "", filename).replace("_", " ").replace("-", " ").strip()
    if filename.lower().endswith(".pdf"):
        chunks = chunk_pdf(data, title)
    else:
        chunks = chunk_markdown(data.decode("utf-8", errors="replace"), title)
    return ingest(course_id, title, chunks), len(chunks)


# ---------------------------------------------------------------- search

def search(course_id: int, query: str, k: int = PER_QUERY) -> list[dict]:
    fts = to_fts_query(query)
    if not fts:
        return []
    rows = db.q(
        "SELECT p.id, p.doc_title, p.chapter, p.section, p.page, p.text, bm25(passages_fts) AS score "
        "FROM passages_fts JOIN passages p ON p.id = passages_fts.rowid "
        "WHERE passages_fts MATCH ? AND p.course_id = ? ORDER BY score LIMIT ?",
        (fts, course_id, k))
    return rows


def where(p: dict) -> str:
    bits = [p.get("doc_title") or ""]
    if p.get("section"):
        bits.append(p["section"])
    if p.get("page"):
        bits.append(f"p. {p['page']}")
    return ", ".join(b for b in bits if b)


def number(passages: list[dict]) -> list[dict]:
    return [{"n": i, "pid": p["id"], "doc_title": p["doc_title"], "chapter": p["chapter"],
             "section": p["section"], "page": p["page"], "text": p["text"], "where": where(p)}
            for i, p in enumerate(passages, 1)]


def format_passages(numbered: list[dict]) -> str:
    return "\n\n".join(f"[P{p['n']}] ({p['where']})\n{p['text']}" for p in numbered)


def gather(course_id: int, topic: str, keywords: str, llm, emit) -> list[dict]:
    """Collect up to MAX_PASSAGES numbered passages on a topic."""
    found: dict[int, dict] = {}

    def add(rows):
        new = 0
        for r in rows:
            if r["id"] not in found and len(found) < MAX_PASSAGES:
                found[r["id"]] = r
                new += 1
        return new

    first = [topic] + [k.strip() for k in (keywords or "").split(",") if k.strip()][:3]
    emit("Librarian", "work", f"Searching the course material for “{topic}”",
         {"queries": first})
    for qtext in first:
        add(search(course_id, qtext))

    if llm.online:
        for round_no in range(1, MAX_ROUNDS + 1):
            have = format_passages(number(list(found.values())))[:6000] or "(nothing yet)"
            plan = llm.json(PLANNER_SYSTEM,
                            f"Topic: {topic}\nRound {round_no} of {MAX_ROUNDS}.\nPassages so far:\n{have}",
                            max_tokens=400)
            if plan.get("action") != "search":
                emit("Librarian", "work", f"Enough material: {plan.get('reason', 'topic covered')}")
                break
            queries = [str(x) for x in (plan.get("queries") or [])][:4]
            if not queries:
                break
            emit("Librarian", "work", f"Round {round_no}: {plan.get('reason', 'searching again')}",
                 {"queries": queries})
            if sum(add(search(course_id, qq)) for qq in queries) == 0:
                break

    numbered = number(list(found.values()))
    emit("Librarian", "handoff", f"Found {len(numbered)} numbered passages",
         {"passages": [{"n": p["n"], "where": p["where"]} for p in numbered]})
    return numbered


def focus(numbered: list[dict], part: int = 1, parts: int = 1) -> list[dict]:
    """Keep the topic's own chapter, in reading order, and the slice for this part of the topic.

    Search can pull in stray passages from other chapters (a "network" mention in the logging
    chapter, say). If most hits share a chapter, the lesson sticks to it.
    """
    if not numbered:
        return numbered
    counts: dict[str, int] = {}
    for p in numbered:
        counts[p["chapter"]] = counts.get(p["chapter"], 0) + 1
    main, n = max(counts.items(), key=lambda kv: kv[1])
    kept = [p for p in numbered if p["chapter"] == main] if n >= 2 else list(numbered)
    kept.sort(key=lambda p: (p["page"] or 0, p["pid"]))
    if parts > 1 and len(kept) >= parts:
        size = -(-len(kept) // parts)
        kept = kept[(part - 1) * size: part * size] or kept
    return [{**p, "n": i} for i, p in enumerate(kept, 1)]
