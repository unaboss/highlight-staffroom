"""Subject Teacher: writes lesson plans and draft tests from the Librarian's passages only.

Every fact carries a [P#] marker. The Examiner checks each one; anything that fails comes back
here with the reason, and the Teacher fixes or removes it (at most twice).
"""

import re

from ..textutil import CITE_RE, content_words, sentences, strip_cites
from .librarian import format_passages

LEVELS = {1: "Recall", 2: "Explain", 3: "Apply", 4: "Analyse", 5: "Evaluate"}

TEACHER_SYSTEM = """You are a subject teacher in an online school writing ONE lesson plan.
Use ONLY the numbered passages provided. Cite every fact with passage ids in square brackets,
e.g. [P3] or [P2][P5]. Do not add facts from your own knowledge. If the passages don't cover
something the topic needs, list it under "gaps" instead of filling it in.
JSON shape:
{"title": "...",
 "objectives": ["Learners can ... [P#]", "... (3 items)"],
 "explanation": ["one short paragraph per key idea, each with [P#]", "..."],
 "worked_example": "a worked example taken from the passages [P#]",
 "activity": "a short class activity for a live video lesson",
 "check_questions": [{"q": "...", "answer": "... [P#]"}],
 "gaps": ["..."]}"""

REVISE_SYSTEM = """You are the same subject teacher. The examiner sent some items back.
Fix each listed item so it is fully supported by the cited passage, or remove it.
Keep everything else unchanged. Use ONLY the numbered passages. Return the full lesson plan JSON
in the same shape as before."""

TEST_SYSTEM = """You are a subject teacher writing a short personalised test for one learner.
Use ONLY the numbered passages. Each question has a difficulty level:
1 Recall (define or name), 2 Explain (in own words), 3 Apply (to a short scenario),
4 Analyse (compare or diagnose), 5 Evaluate (recommend and justify).
Every memo answer must cite the passage it comes from with [P#].
JSON shape:
{"questions": [{"topic": "<topic>", "level": 1-5, "q": "...", "answer": "... [P#]", "marks": 1-5}]}"""


# ---------------------------------------------------------------- lesson plans

def lesson_items(plan: dict) -> list[dict]:
    """Flatten a plan into checkable items for the Examiner."""
    items = []
    for i, t in enumerate(plan.get("objectives") or [], 1):
        # Check what the objective is about, not the "Learners can explain" wording around it.
        claim = re.sub(r"^\s*(learners|students|you)\s+(can|will|should|are able to)\s+\w+\s+", "", str(t), flags=re.I)
        items.append({"id": f"o{i}", "kind": "objective", "text": str(t), "claim": claim})
    for i, t in enumerate(plan.get("explanation") or [], 1):
        items.append({"id": f"e{i}", "kind": "explanation", "text": str(t)})
    if plan.get("worked_example"):
        items.append({"id": "x1", "kind": "example", "text": str(plan["worked_example"])})
    for i, cq in enumerate(plan.get("check_questions") or [], 1):
        if isinstance(cq, dict):
            items.append({"id": f"q{i}", "kind": "question", "text": f"{cq.get('q', '')} {cq.get('answer', '')}",
                          "claim": str(cq.get("answer", ""))})
    return items


def _clean(plan: dict) -> dict:
    plan = plan if isinstance(plan, dict) else {}
    out = {
        "title": str(plan.get("title") or ""),
        "objectives": [str(x) for x in plan.get("objectives") or [] if str(x).strip()],
        "explanation": [str(x) for x in plan.get("explanation") or [] if str(x).strip()],
        "worked_example": str(plan.get("worked_example") or ""),
        "activity": str(plan.get("activity") or ""),
        "check_questions": [{"q": str(c.get("q", "")), "answer": str(c.get("answer", ""))}
                            for c in plan.get("check_questions") or [] if isinstance(c, dict)],
        "gaps": [str(x) for x in plan.get("gaps") or [] if str(x).strip()],
    }
    return out


def drop_bad_cites(plan: dict, valid: set[int]) -> tuple[dict, int]:
    """Remove [P#] markers that point at passages the Librarian never provided."""
    dropped = 0

    def fix(text: str) -> str:
        nonlocal dropped

        def sub(m):
            nonlocal dropped
            if int(m.group(1)) in valid:
                return m.group(0)
            dropped += 1
            return ""
        return CITE_RE.sub(sub, text)

    plan["objectives"] = [fix(t) for t in plan["objectives"]]
    plan["explanation"] = [fix(t) for t in plan["explanation"]]
    plan["worked_example"] = fix(plan["worked_example"])
    for cq in plan["check_questions"]:
        cq["answer"] = fix(cq["answer"])
    return plan, dropped


PRONOUNS = {"this", "that", "it", "they", "these", "those", "there", "which", "he", "she", "we", "you"}


def _definitional(s: str) -> re.Match | None:
    m = re.match(r"^(An?|The)?\s*([A-Z][\w\- ]{2,40}?|[a-z][\w\- ]{2,40}?)\s+(is|are|means)\s+(.{15,})$", s)
    if not m or m.group(2).strip().lower() in PRONOUNS or m.group(2).strip().lower().split()[0] in PRONOUNS:
        return None
    return m


def lower_first(s: str) -> str:
    s = s.strip()
    if len(s) > 1 and s[1].isupper():
        return s                      # an acronym like TCP or MFA
    return s[:1].lower() + s[1:]


def what_question(m: re.Match) -> str:
    article = (m.group(1) or "").lower()
    subject = lower_first(m.group(2))
    verb = "is" if m.group(3) == "means" else m.group(3)
    if m.group(3) == "means":
        return f"What does {subject} mean?"
    return f"What {verb} {article + ' ' if article else ''}{subject}?"


def _offline_lesson(topic: str, passages: list[dict]) -> dict:
    key = set(content_words(topic))
    picked, seen_sections, objectives = [], [], []
    for p in passages[:7]:
        sents = sentences(p["text"])
        ranked = sorted(sents, key=lambda s: -len(key & set(content_words(s))))
        for s in ranked[:2]:
            if len(s.split()) >= 6:
                picked.append((s, p["n"]))
        sec = re.sub(r"^[\d.]+\s*", "", p.get("section") or "").strip()
        if sec and sec not in seen_sections and len(objectives) < 3:
            seen_sections.append(sec)
            objectives.append(f"Learners can explain {lower_first(sec)} [P{p['n']}]")
    explanation = [f"{s} [P{n}]" for s, n in picked[:6]]
    example = next((f"{s} [P{p['n']}]" for p in passages for s in sentences(p["text"])
                    if re.search(r"\b(for example|e\.g\.|for instance|imagine|suppose)\b", s, re.I)), "")
    questions = []
    for p in passages:
        for s in sentences(p["text"]):
            m = _definitional(s)
            if m and len(questions) < 3:
                questions.append({"q": what_question(m), "answer": f"{s} [P{p['n']}]"})
    return {"title": topic, "objectives": objectives, "explanation": explanation,
            "worked_example": example,
            "activity": "Think-pair-share in breakout rooms: each pair explains one idea from today in their own words, "
                        "then one pair presents.",
            "check_questions": questions, "gaps": []}


def write_lesson(topic: str, lesson_title: str, passages: list[dict], llm, emit) -> dict:
    emit("Subject Teacher", "start", f"Writing the lesson plan for “{lesson_title}”")
    if llm.online:
        plan = _clean(llm.json(TEACHER_SYSTEM,
                               f"Lesson: {lesson_title}\nTopic: {topic}\n\nPassages:\n{format_passages(passages)}",
                               max_tokens=2500))
        if not plan["explanation"]:
            emit("Subject Teacher", "warn", "The model returned an empty plan; using the extractive draft instead")
            plan = _offline_lesson(topic, passages)
    else:
        plan = _offline_lesson(topic, passages)
    plan["title"] = plan["title"] or lesson_title
    plan, dropped = drop_bad_cites(plan, {p["n"] for p in passages})
    if dropped:
        emit("Subject Teacher", "warn", f"Removed {dropped} citation(s) to passages that don't exist")
    emit("Subject Teacher", "handoff",
         f"Draft ready: {len(plan['objectives'])} objectives, {len(plan['explanation'])} key ideas, "
         f"{len(plan['check_questions'])} check questions")
    return plan


def revise_lesson(plan: dict, issues: list[dict], passages: list[dict], llm, emit) -> dict:
    emit("Subject Teacher", "work", f"Fixing {len(issues)} item(s) the Examiner sent back")
    if llm.online:
        listing = "\n".join(f"- {i['id']} ({i['verdict']}): {i['text']}  Reason: {i['reason']}" for i in issues)
        import json as _json
        revised = _clean(llm.json(REVISE_SYSTEM,
                                  f"Passages:\n{format_passages(passages)}\n\nCurrent plan:\n{_json.dumps(plan)}\n\n"
                                  f"Items sent back:\n{listing}", max_tokens=2500))
        if revised["explanation"]:
            revised, _ = drop_bad_cites(revised, {p["n"] for p in passages})
            revised["title"] = revised["title"] or plan["title"]
            return revised
    # Offline (or the model failed): remove what didn't pass. Never invent a replacement.
    bad = {i["id"] for i in issues}
    plan = {**plan}
    plan["objectives"] = [t for k, t in enumerate(plan["objectives"], 1) if f"o{k}" not in bad]
    plan["explanation"] = [t for k, t in enumerate(plan["explanation"], 1) if f"e{k}" not in bad]
    if "x1" in bad:
        plan["gaps"] = plan["gaps"] + ["Worked example removed: not supported by the notes"]
        plan["worked_example"] = ""
    plan["check_questions"] = [c for k, c in enumerate(plan["check_questions"], 1) if f"q{k}" not in bad]
    return plan


# ---------------------------------------------------------------- tests

def test_items(questions: list[dict]) -> list[dict]:
    return [{"id": f"t{i}", "kind": "question", "text": f"{q['q']} {q['answer']}", "claim": q["answer"]}
            for i, q in enumerate(questions, 1)]


def _offline_questions(topic: str, level: int, passages: list[dict], count: int) -> list[dict]:
    out = []
    sents = [(s, p) for p in passages for s in sentences(p["text"]) if len(s.split()) >= 7]
    defs = [(s, p, _definitional(s)) for s, p in sents if _definitional(s)]
    examples = [(s, p) for s, p in sents if re.search(r"\b(for example|e\.g\.|for instance|suppose|imagine)\b", s, re.I)]
    advice = [(s, p) for s, p in sents if re.search(r"\b(should|best|recommend|always|never|important)\b", s, re.I)]
    sections = []
    for p in passages:
        sec = re.sub(r"^[\d.]+\s*", "", p.get("section") or "").strip()
        if sec and all(sec != x[0] for x in sections):
            sections.append((sec, p))

    def add(q, s, p):
        if len(out) < count and all(o["q"] != q for o in out):
            out.append({"topic": topic, "level": level, "q": q, "answer": f"{s} [P{p['n']}]", "marks": level})

    if level <= 1:
        for s, p, m in defs:
            add(what_question(m), s, p)
    if level == 2 or (level <= 1 and len(out) < count):
        for sec, p in sections:
            best = max(sentences(p["text"]), key=len)
            add(f"In your own words, explain {lower_first(sec)}.", best, p)
    if level == 3:
        for s, p in examples:
            add(f"Give a real-world example that shows {lower_first(topic)} in practice, and explain it.", s, p)
        for sec, p in sections:
            if len(sec.split()) >= 3:
                add(f"Your school's IT team asks you to explain {lower_first(sec)} to new staff. What would you say?",
                    max(sentences(p["text"]), key=len), p)
    if level == 4 and len(sections) >= 2:
        for (a, pa), (b, pb) in zip(sections, sections[1:]):
            sa, sb = max(sentences(pa["text"]), key=len), max(sentences(pb["text"]), key=len)
            if len(out) < count:
                out.append({"topic": topic, "level": level, "q": f"Compare {lower_first(a)} with {lower_first(b)}.",
                            "answer": f"{sa} [P{pa['n']}] {sb} [P{pb['n']}]", "marks": level})
    if level >= 5:
        for s, p in advice:
            add(f"A small online school asks what to do about {lower_first(topic)}. What do you recommend, and why?", s, p)
    if len(out) < count:  # fill from the next level down rather than inventing anything
        if level > 1:
            out += _offline_questions(topic, level - 1, passages, count - len(out))
    return out[:count]


def draft_test(learner: str, targets: list[dict], passages: list[dict], llm, emit,
               per_topic: int = 2) -> list[dict]:
    """targets: [{"topic", "level"}] already ordered weakest first."""
    want = ", ".join(f"{t['topic']} (level {t['level']} {LEVELS[t['level']]})" for t in targets)
    emit("Subject Teacher", "start", f"Drafting a personalised test for {learner}: {want}")
    questions = []
    if llm.online:
        spec = "\n".join(f"- {t['topic']}: {per_topic} questions at level {t['level']} ({LEVELS[t['level']]})"
                         for t in targets)
        out = llm.json(TEST_SYSTEM, f"Learner: {learner}\nQuestions wanted:\n{spec}\n\n"
                                    f"Passages:\n{format_passages(passages)}", max_tokens=2500)
        for q in out.get("questions") or []:
            if isinstance(q, dict) and q.get("q") and q.get("answer"):
                try:
                    level = max(1, min(5, int(q.get("level", 2))))
                except (TypeError, ValueError):
                    level = 2
                questions.append({"topic": str(q.get("topic") or targets[0]["topic"]), "level": level,
                                  "q": str(q["q"]), "answer": str(q["answer"]),
                                  "marks": int(q.get("marks") or level) if str(q.get("marks", "")).isdigit() else level})
    if not questions:
        for t in targets:
            topic_passages = t.get("passages") or passages
            questions += _offline_questions(t["topic"], t["level"], topic_passages, per_topic)
    valid = {p["n"] for p in passages}
    for q in questions:
        q["answer"] = CITE_RE.sub(lambda m: m.group(0) if int(m.group(1)) in valid else "", q["answer"]).strip()
    emit("Subject Teacher", "handoff", f"Draft test ready: {len(questions)} questions with memo answers")
    return questions


def revise_test(questions: list[dict], issues: list[dict], emit) -> list[dict]:
    bad = {i["id"] for i in issues}
    keep = [q for k, q in enumerate(questions, 1) if f"t{k}" not in bad]
    emit("Subject Teacher", "work", f"Removed {len(questions) - len(keep)} question(s) the Examiner couldn't verify")
    return keep


def plain(text: str) -> str:
    return strip_cites(text)
