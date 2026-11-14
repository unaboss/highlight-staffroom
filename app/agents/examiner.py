"""Examiner: marks every statement and every memo answer against the Librarian's passages.

Two independent checks:
1. Code: the cited passage must exist, and enough of the statement's content words must
   actually appear in it (a grounding score). This catches invented citations and
   statements the model made up.
2. Model (when online): a verdict per item - Supported, Partly supported, Contradicted,
   or Not in the material - adapted from Ask the Commission's "Verify a claim" mode.

With a model, an item passes only when the model says Supported and code finds at least half of
its key words in the cited passage. Under 20% grounding is Not in the material whatever the model
says, and a Contradicted from the model always stands. Offline, code alone needs 80%.
"""

import re

from ..textutil import cites, missing_words, overlap, sentences, strip_cites
from .librarian import format_passages

SUPPORTED, PARTLY, CONTRADICTED, MISSING, UNCITED = (
    "Supported", "Partly supported", "Contradicted", "Not in the material", "Uncited")

EXAMINER_SYSTEM = """You are the school examiner. Check each item against the numbered passages ONLY.
An item is a lesson statement, or a test question with its memo answer (check the answer).
For each item give a verdict: "Supported", "Partly supported", "Contradicted" or "Not in the material",
and a short reason that names the passage id that decides it.
Reply: {"items": [{"id": "<item id>", "verdict": "...", "reason": "..."}]}"""


SUPPORT_MIN = 0.8          # share of a line's content words that must appear in the passage it cites
PARTLY_MIN = 0.45


def _lexical(score: float) -> str:
    if score >= SUPPORT_MIN:
        return SUPPORTED
    if score >= PARTLY_MIN:
        return PARTLY
    return MISSING


def citation_check(text: str, passages: list[dict], claim: str | None = None, by_n: dict | None = None) -> dict:
    """Deterministic: does the passage a line cites actually support it?

    Every [P#] must point at a passage the Librarian provided, and at least SUPPORT_MIN of the claim's
    content words (stemmed, stop words dropped) must appear in the cited passage text. Extractive
    lines score ~100%; a plausible line the notes don't make lands well under half. Returns cites,
    bad_cites, grounding (0..1), lexical/verdict, supported, and a reason naming the missing words.
    """
    by_n = by_n or {p["n"]: p for p in passages}
    claim = claim or text
    all_cites = cites(text) + cites(claim)
    good = sorted({c for c in all_cites if c in by_n})
    bad = sorted({c for c in all_cites if c not in by_n})
    if not good:
        score, verdict = 0.0, UNCITED
        reason = "No citation to a provided passage" + (f" (cited P{bad[0]}, which doesn't exist)" if bad else "")
    else:
        source = " ".join(f"{by_n[c].get('section', '')} {by_n[c]['text']}" for c in good)
        score = round(overlap(strip_cites(claim), source), 2)
        verdict = _lexical(score)
        reason = f"{int(score * 100)}% of its key words appear in " + ", ".join(f"P{c}" for c in good)
        gone = missing_words(claim, source)
        if gone and verdict != SUPPORTED:
            reason += "; not in the source: " + ", ".join(gone[:6])
    return {"cites": good, "bad_cites": bad, "grounding": score, "lexical": verdict, "verdict": verdict,
            "reason": reason, "supported": verdict == SUPPORTED}


def check(items: list[dict], passages: list[dict], llm, emit, what: str = "items",
          issue_word: str = "sent back") -> dict:
    """items: [{"id", "kind", "text", "claim"?}] where text carries [P#] markers.

    "claim" is the part to verify (for a test question, the memo answer); defaults to text.
    """
    by_n = {p["n"]: p for p in passages}
    emit("Examiner", "start", f"Marking {len(items)} {what} against {len(passages)} passages")
    results = []
    for it in items:
        r = citation_check(it["text"], passages, claim=it.get("claim"), by_n=by_n)
        r.pop("supported")
        results.append({"id": it["id"], "kind": it.get("kind", ""), "text": it["text"], **r})

    if llm.online and results:
        listing = "\n".join(f"{r['id']}: {r['text']}" for r in results)
        out = llm.json(EXAMINER_SYSTEM, f"Passages:\n{format_passages(passages)}\n\nItems:\n{listing}",
                       max_tokens=2500)
        verdicts = {str(v.get("id")): v for v in (out.get("items") or []) if isinstance(v, dict)}
        for r in results:
            v = verdicts.get(str(r["id"]))
            if not v or r["verdict"] == UNCITED:
                continue
            model_verdict = str(v.get("verdict", "")).strip()
            if r["grounding"] < 0.2:
                r["verdict"] = MISSING          # words aren't in the source: don't trust a "Supported"
            elif model_verdict == CONTRADICTED:
                r["verdict"] = CONTRADICTED
            elif model_verdict == SUPPORTED and r["grounding"] >= 0.5:
                r["verdict"] = SUPPORTED
            elif model_verdict in (PARTLY, MISSING, SUPPORTED):
                r["verdict"] = PARTLY if model_verdict == SUPPORTED else model_verdict
            r["reason"] = (v.get("reason") or r["reason"]) + f" (grounding {int(r['grounding'] * 100)}%)"

    issues = [r for r in results if r["verdict"] != SUPPORTED]
    for r in issues:
        emit("Examiner", "reject", f"{r['verdict']}: “{strip_cites(r['text'])[:110]}”",
             {"id": r["id"], "reason": r["reason"]})
    passed = not issues
    summary = (f"All {len(results)} {what} supported by the course material" if passed else
               f"{len(results) - len(issues)} of {len(results)} {what} supported; {len(issues)} {issue_word}")
    emit("Examiner", "pass" if passed else "reject", summary,
         {"supported": len(results) - len(issues), "issues": len(issues)})
    return {"verdict": "pass" if passed else "send_back", "items": results, "issues": issues,
            "summary": summary}


DEFINITION = re.compile(r"^(an?\s+|the\s+)?[\w\-/ ]{2,40}?\s+(is|are|means|refers to)\s+(an?|the)\b", re.I)


def corrective(text: str, passages: list[dict]) -> tuple[str, dict] | tuple[None, None]:
    """The sentence in the notes that best answers a wrong idea: on the same words, and a definition if one fits."""
    best, best_p, best_score = None, None, -1.0
    for p in passages:
        for s in sentences(p["text"]):
            score = overlap(text, s) + (0.5 if DEFINITION.match(s) else 0.0)
            if score > best_score:
                best, best_p, best_score = s, p, score
    return best, best_p


def check_statements(statements: list[dict], passages: list[dict], llm, emit) -> list[dict]:
    """Check what learners said in class against the lesson's passages.

    statements: [{"line", "learner_id", "name", "text"}]. Returns the ones the notes don't support,
    each with the passage it was checked against, so the teacher can revisit them next lesson.
    """
    if not statements or not passages:
        return []
    items = []
    for i, st in enumerate(statements, 1):
        best = max(passages, key=lambda p: overlap(st["text"], f"{p.get('section', '')} {p['text']}"))
        items.append({"id": f"s{i}", "kind": "learner statement", "text": f"{st['text'].strip()} [P{best['n']}]"})
    out = check(items, passages, llm, emit, "learner statements", "flagged for the teacher to revisit")
    by_n = {p["n"]: p for p in passages}
    found = []
    for st, r in zip(statements, out["items"]):
        if r["verdict"] == SUPPORTED:
            continue
        sent, src = corrective(st["text"], passages)
        if not src and r["cites"]:
            src = by_n.get(r["cites"][0])
        found.append({**st, "verdict": r["verdict"], "reason": r["reason"], "grounding": r["grounding"],
                      "notes_say": sent, "source": dict(src) if src else None})
    return found


def check_claim(text: str, passages: list[dict], llm, emit) -> dict:
    """Ask the Examiner about any statement, e.g. something an AI tool or a learner said.

    If the statement cites nothing, the Examiner picks the closest passage and checks against it.
    """
    if not cites(text) and passages:
        best = max(passages, key=lambda p: overlap(text, f"{p.get('section', '')} {p['text']}"))
        text = f"{text.strip()} [P{best['n']}]"
    out = check([{"id": "c1", "kind": "claim", "text": text}], passages, llm, emit, "statement")
    return out["items"][0]
