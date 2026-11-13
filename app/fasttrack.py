"""Fast Track: a 10-level question ladder per chapter, built only from the chapter's passages.

Levels 1-2 Recall, 3-4 Explain, 5-6 Spot the mistake, 7-8 Apply, 9-10 Analyse, then a final quiz
(level 11). Every question cites the numbered passage(s) [P1], [P2]... it was built from, and
carries the exact source sentence so a wrong answer can show it highlighted.

With a model key, Explain / Apply / Analyse questions are written by the model and checked in
code (the cited passage must exist and the quoted sentence must really be in it). Without one,
or when the model's output fails the checks, every level is built from templates in code.
"""

import math
import random
import re
from collections import Counter
from datetime import date, timedelta
from functools import lru_cache

from . import db
from .agents.counsellor import level_from_pct
from .textutil import STOPWORDS, content_words, overlap, sentences, stem

PER_LEVEL = 5
QUIZ_SIZE = 10
QUIZ_LEVEL = 11
PASS_SHARE = 0.6                     # 3 of 5 to climb

SKILLS = {1: "Recall", 2: "Recall", 3: "Explain", 4: "Explain", 5: "Spot the mistake", 6: "Spot the mistake",
          7: "Apply", 8: "Apply", 9: "Analyse", 10: "Analyse", QUIZ_LEVEL: "Final quiz"}
LEVEL_BLURB = {
    1: "Fill the gap: pick the word the notes use.",
    2: "Match each term to the line it completes.",
    3: "Finish the explanation: how does the sentence end?",
    4: "Which explanation do the notes actually give?",
    5: "True or false? Some lines have been changed.",
    6: "One word is wrong. Tap it.",
    7: "Which part of the chapter does this situation belong to?",
    8: "Which of these is an example of the idea?",
    9: "Odd one out: which line belongs to a different idea?",
    10: "Three lines are from the notes. Which one isn't supported?",
    QUIZ_LEVEL: "Ten mixed questions from the whole chapter.",
}

ANTONYMS = [("always", "never"), ("more", "less"), ("increase", "decrease"), ("increases", "decreases"),
            ("before", "after"), ("can", "cannot"), ("larger", "smaller"), ("higher", "lower"),
            ("faster", "slower"), ("internal", "external"), ("public", "private"), ("inbound", "outbound"),
            ("first", "last"), ("allow", "block"), ("allows", "blocks"), ("secure", "insecure"),
            ("legal", "illegal"), ("authorised", "unauthorised"), ("authorized", "unauthorized"),
            ("encrypt", "decrypt"), ("encrypted", "unencrypted"), ("passive", "active"), ("most", "least"),
            ("strong", "weak"), ("stronger", "weaker"), ("easy", "difficult"), ("easier", "harder"),
            ("physical", "logical"), ("hardware", "software"), ("input", "output"), ("volatile", "non-volatile"),
            ("positive", "negative"), ("maximum", "minimum"), ("reduce", "increase"), ("reduces", "increases"),
            ("protect", "expose"), ("protects", "exposes"), ("should", "should not"), ("must", "need not")]
SWAP = {}
for a, b in ANTONYMS:
    SWAP.setdefault(a, b)
    SWAP.setdefault(b, a)

EXPLAIN_RE = re.compile(r"\b(because|so that|in order to|which means|this means|meaning that|therefore|"
                        r"so as to|to prevent|to protect|to ensure|to reduce|to avoid|to allow|helps|allows|"
                        r"enables|prevents|ensures|protects|is used to|are used to|is responsible for|"
                        r"refers to|is defined as|is known as|means)\b", re.I)
EXAMPLE_RE = re.compile(r"\b(for example|for instance|such as|e\.g\.|if a|if an|if the|if you|when a|when an|"
                        r"when the|when you|imagine|suppose|scenario)\b", re.I)


# ---------------------------------------------------------------- material

def chapter_passages(topic_id: int) -> tuple[dict, list[dict]]:
    t = db.one("SELECT * FROM topics WHERE id = ?", (topic_id,))
    if not t:
        return {}, []
    rows = db.q("SELECT id, section, page, text FROM passages WHERE course_id = ? AND chapter = ? ORDER BY id",
                (t["course_id"], t["title"]))
    return t, [{"n": i, "pid": r["id"], "section": section_name(r["section"]), "text": r["text"]}
               for i, r in enumerate(rows, 1)]


def section_name(s: str) -> str:
    return re.sub(r"^KT\d+\s*", "", s or "").strip() or "General"


def good_sentence(s: str) -> bool:
    words = s.split()
    if not 7 <= len(words) <= 42:
        return False
    if re.search(r"\b(IAC|AC|KT|KM|SO|AS)\s?-?\d{2,}", s):
        return False                   # assessment-criteria codes, not teaching text
    if s.rstrip().endswith(":") or s.count("—") > 2 or s.count("|") or s.count("http"):
        return False
    letters = sum(ch.isalpha() for ch in s)
    return letters / max(1, len(s)) > 0.65 and len(content_words(s)) >= 4


def candidates(passages: list[dict]) -> list[dict]:
    out = []
    for p in passages:
        for s in sentences(p["text"]):
            if good_sentence(s):
                out.append({"n": p["n"], "pid": p["pid"], "section": p["section"], "s": s})
    return out


@lru_cache(maxsize=8)
def _course_df(course_id: int, n_passages: int) -> tuple[Counter, int]:
    """How many chapters use each word stem: rare words make the best blanks."""
    df: Counter = Counter()
    chapters = db.q("SELECT chapter, GROUP_CONCAT(text, ' ') AS body FROM passages WHERE course_id = ? "
                    "GROUP BY chapter", (course_id,))
    for c in chapters:
        df.update(set(content_words(c["body"])))
    return df, max(1, len(chapters))


def chapter_terms(course_id: int, passages: list[dict]) -> list[str]:
    """Distinctive terms for this chapter: acronyms, section-title phrases, then rare frequent words."""
    n_total = db.one("SELECT COUNT(*) AS n FROM passages WHERE course_id = ?", (course_id,))["n"]
    df, n_ch = _course_df(course_id, n_total)
    body = " ".join(p["text"] for p in passages)
    terms: list[str] = []
    for a, c in Counter(re.findall(r"\b[A-Z][A-Z0-9]{1,6}s?\b", body)).most_common(12):
        if c >= 2 and a.lower() not in STOPWORDS and a not in ("KT", "KM", "II", "III", "IV"):
            terms.append(a)
    for p in passages:
        for part in re.split(r",|/|\band\b|:|\(", p["section"]):
            part = part.strip(" .-")
            if 1 <= len(part.split()) <= 3 and len(part) > 3 and re.search(re.escape(part), body, re.I):
                terms.append(part)
    words = Counter(w.lower() for w in re.findall(r"[A-Za-z][A-Za-z\-]{4,}", body) if w.lower() not in STOPWORDS)
    scored = sorted(words, key=lambda w: -words[w] * math.log((n_ch + 1) / (df.get(stem(w), 0) + 1)))
    terms += [w for w in scored[:40] if words[w] >= 2]
    seen, out = set(), []
    for t in terms:
        k = t.lower()
        if k not in seen:
            seen.add(k)
            out.append(t)
    return out


def find_term(term: str, s: str):
    return re.search(r"(?<![A-Za-z0-9])" + re.escape(term) + r"(?![A-Za-z0-9])", s, re.I)


def cite(c: dict) -> dict:
    return {"n": c["n"], "pid": c["pid"], "sentence": c["s"]}


def words_in(*texts) -> int:
    return sum(len(str(t).split()) for t in texts)


def recall_seconds(words: int) -> int:
    return int(min(75, max(12, round(8 + words * 0.5))))


# ---------------------------------------------------------------- alterations

def alter(s: str, terms: list[str], rng: random.Random, single_word=False):
    """Change one word or phrase so the sentence is no longer what the notes say.

    Returns (new_sentence, wrong_text, original_text) or None.
    """
    toks = list(re.finditer(r"[A-Za-z][A-Za-z\-']*", s))
    opts = []
    for m in toks:
        w = m.group(0)
        if w.lower() in SWAP and (not single_word or " " not in SWAP[w.lower()]):
            new = SWAP[w.lower()]
            new = new.capitalize() if w[0].isupper() else new
            opts.append((m.start(), m.end(), new, w))
    present = [t for t in terms if find_term(t, s)]
    absent = [t for t in terms if not find_term(t, s) and (not single_word or " " not in t)]
    for t in present:
        if single_word and " " in t:
            continue
        m = find_term(t, s)
        same_kind = [a for a in absent if a.isupper() == t.isupper()] or absent
        if same_kind:
            new = rng.choice(same_kind[:15])
            opts.append((m.start(), m.end(), new, m.group(0)))
    for m in re.finditer(r"\b\d+(\.\d+)?\b", s):
        num = m.group(0)
        if "." not in num and 1 < int(num) < 10000:
            new = str(int(num) * 2 if int(num) < 50 else int(num) // 2)
            opts.append((m.start(), m.end(), new, num))
    if not opts:
        return None
    a, b, new, old = rng.choice(opts)
    return s[:a] + new + s[b:], new, old


# ---------------------------------------------------------------- templates per question type

class Builder:
    def __init__(self, topic: dict, passages: list[dict], seed: int):
        self.topic, self.passages = topic, passages
        self.rng = random.Random(f"{topic['id']}:{seed}")
        self.cands = candidates(passages)
        self.rng.shuffle(self.cands)
        self.terms = chapter_terms(topic["course_id"], passages)
        self.used: set[str] = set()
        self.sections = sorted({c["section"] for c in self.cands})

    def take(self, pred=lambda c: True, fresh=True):
        for c in self.cands:
            if (not fresh or c["s"] not in self.used) and pred(c):
                self.used.add(c["s"])
                return c
        if fresh:
            return self.take(pred, fresh=False)
        return None

    def distractor_terms(self, answer: str, s: str, k=3):
        pool = [t for t in self.terms if t.lower() != answer.lower() and not find_term(t, s)
                and t.lower() not in answer.lower() and answer.lower() not in t.lower()]
        same = [t for t in pool if t.isupper() == answer.isupper() and (" " in t) == (" " in answer)]
        pick = same[:12] if len(same) >= k else pool[:15]
        self.rng.shuffle(pick)
        return pick[:k]

    def mcq(self, kind, prompt, stem, right, wrong, cites, **extra):
        options = [right] + list(wrong)
        self.rng.shuffle(options)
        return {"type": kind, "prompt": prompt, "stem": stem, "options": options, "answer": options.index(right),
                "cites": cites, **extra}

    # Recall ---------------------------------------------------------
    def cloze(self):
        for _ in range(12):
            c = self.take(lambda c: any(find_term(t, c["s"]) for t in self.terms[:30]))
            if not c:
                return None
            present = [t for t in self.terms[:30] if find_term(t, c["s"])]
            term = max(present, key=lambda t: (len(t.split()), len(t)))
            m = find_term(term, c["s"])
            wrong = self.distractor_terms(m.group(0), c["s"])
            if len(wrong) < 3:
                continue
            stem = c["s"][:m.start()] + "_____" + c["s"][m.end():]
            q = self.mcq("cloze", "Fill the gap.", stem, m.group(0), wrong, [cite(c)])
            q["seconds"] = recall_seconds(words_in(stem, *q["options"]))
            return q
        return None

    def match(self):
        pairs, cites_, seen = [], [], set()
        for _ in range(20):
            if len(pairs) == 4:
                break
            c = self.take(lambda c: any(find_term(t, c["s"]) for t in self.terms[:40]))
            if not c:
                break
            present = [t for t in self.terms[:40] if find_term(t, c["s"]) and t.lower() not in seen
                       and not any(find_term(t, p["clue"]) for p in pairs)]
            if not present:
                continue
            term = max(present, key=lambda t: (len(t.split()), len(t)))
            if any(find_term(p["term"], c["s"]) for p in pairs):
                continue
            m = find_term(term, c["s"])
            clue = c["s"][:m.start()] + "_____" + c["s"][m.end():]
            if len(clue.split()) > 30:
                continue
            seen.add(term.lower())
            pairs.append({"term": m.group(0), "clue": clue})
            cites_.append(cite(c))
        if len(pairs) < 3:
            return None
        order = list(range(len(pairs)))
        self.rng.shuffle(order)
        return {"type": "match", "prompt": "Match each term to the line it completes.",
                "terms": [pairs[i]["term"] for i in order], "clues": [p["clue"] for p in pairs],
                "answer": [order.index(i) for i in range(len(pairs))],  # clue i -> index in terms
                "cites": cites_, "seconds": recall_seconds(words_in(*[p["clue"] for p in pairs]) + 4 * len(pairs))}

    # Explain --------------------------------------------------------
    def split_explain(self, c):
        m = EXPLAIN_RE.search(c["s"])
        if m and 3 <= len(c["s"][:m.start()].split()) and len(c["s"][m.start():].split()) >= 4:
            return c["s"][:m.start()].rstrip(" ,"), c["s"][m.start():]
        return None

    def complete(self):
        c = self.take(lambda c: self.split_explain(c) is not None)
        if not c:
            c = self.take(lambda c: len(c["s"].split()) >= 12)
            if not c:
                return None
            w = c["s"].split()
            head, tail = " ".join(w[:len(w) // 2]), " ".join(w[len(w) // 2:])
        else:
            head, tail = self.split_explain(c)
        others = []
        for o in self.cands:
            if o["s"] == c["s"]:
                continue
            sp = self.split_explain(o)
            t = sp[1] if sp else " ".join(o["s"].split()[len(o["s"].split()) // 2:])
            if t.lower() != tail.lower() and t not in others and 3 <= len(t.split()) <= 30:
                others.append(t)
            if len(others) >= 12:
                break
        if len(others) < 3:
            return None
        self.rng.shuffle(others)
        return self.mcq("complete", "How does this explanation end?", head + " …", tail, others[:3], [cite(c)])

    def which_explains(self):
        c = self.take(lambda c: EXPLAIN_RE.search(c["s"]) is not None and any(find_term(t, c["s"]) for t in self.terms[:30]))
        if not c:
            return None
        term = next(t for t in self.terms[:30] if find_term(t, c["s"]))
        wrong = []
        for _ in range(3):
            alt = alter(c["s"], [t for t in self.terms if t.lower() != term.lower()], self.rng)
            if alt and alt[0] not in wrong and alt[0] != c["s"]:
                wrong.append(alt[0])
        while len(wrong) < 3:
            o = self.take(lambda o: o["s"] != c["s"] and o["s"] not in wrong)
            if not o:
                return None
            wrong.append(o["s"])
        return self.mcq("mcq", f"Which line matches what the notes say about “{term}”?", "", c["s"], wrong, [cite(c)])

    # Spot the mistake -----------------------------------------------
    def true_false(self):
        c = self.take()
        if not c:
            return None
        make_false = self.rng.random() < 0.55
        if make_false:
            alt = alter(c["s"], self.terms, self.rng)
            if alt:
                return {"type": "truefalse", "prompt": "True or false, according to the notes?", "stem": alt[0],
                        "answer": False, "changed": alt[1], "original": alt[2], "cites": [cite(c)]}
        return {"type": "truefalse", "prompt": "True or false, according to the notes?", "stem": c["s"],
                "answer": True, "cites": [cite(c)]}

    def spot_word(self):
        for _ in range(10):
            c = self.take()
            if not c:
                return None
            alt = alter(c["s"], self.terms, self.rng, single_word=True)
            if not alt:
                continue
            new, wrong, orig = alt
            tokens = new.split()
            idx = next((i for i, tk in enumerate(tokens) if re.sub(r"[^\w\-']", "", tk) == wrong), None)
            if idx is None:
                continue
            return {"type": "spot", "prompt": "One word is wrong. Tap it.", "tokens": tokens, "answer": idx,
                    "changed": wrong, "original": orig, "cites": [cite(c)]}
        return None

    # Apply ----------------------------------------------------------
    def mask_section(self, s, section):
        out = s
        for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", section):
            if w.lower() not in STOPWORDS:
                out = re.sub(r"(?<![A-Za-z])" + re.escape(w) + r"\w*", "▢▢▢", out, flags=re.I)
        return out

    def classify(self):
        if len(self.sections) < 3:
            return None
        c = self.take(lambda c: EXAMPLE_RE.search(c["s"]) is not None) or self.take()
        if not c:
            return None
        wrong = [s for s in self.sections if s != c["section"]]
        self.rng.shuffle(wrong)
        stem = self.mask_section(c["s"], c["section"])
        return self.mcq("mcq", "Which part of the chapter does this belong to?", stem, c["section"], wrong[:3],
                        [cite(c)])

    def example_of(self):
        if len(self.sections) < 2:
            return None
        c = self.take(lambda c: EXAMPLE_RE.search(c["s"]) is not None) or self.take()
        if not c:
            return None
        others = [o for o in self.cands if o["section"] != c["section"] and o["s"] not in self.used]
        self.rng.shuffle(others)
        wrong = [self.mask_section(o["s"], o["section"]) for o in others[:3]]
        if len(wrong) < 3:
            return None
        right = self.mask_section(c["s"], c["section"])
        return self.mcq("mcq", f"Which of these is about “{c['section']}”?", "", right, wrong, [cite(c)])

    # Analyse --------------------------------------------------------
    def odd_one_out(self):
        by_sec: dict[str, list] = {}
        for c in self.cands:
            by_sec.setdefault(c["section"], []).append(c)
        big = [s for s, cs in by_sec.items() if len(cs) >= 3]
        if not big or len(by_sec) < 2:
            return None
        sec = self.rng.choice(big)
        same = self.rng.sample(by_sec[sec], 3)
        odd = self.rng.choice([c for s, cs in by_sec.items() if s != sec for c in cs])
        q = self.mcq("mcq", "Odd one out: which line belongs to a different idea?", "",
                     odd["s"], [c["s"] for c in same], [cite(odd)] + [cite(c) for c in same],
                     note=f"Three lines are about “{sec}”; the odd one is from “{odd['section']}”.")
        for c in same + [odd]:
            self.used.add(c["s"])
        return q

    def unsupported(self):
        picks = []
        for _ in range(4):
            c = self.take()
            if c:
                picks.append(c)
        if len(picks) < 4:
            return None
        for i, c in enumerate(picks):
            alt = alter(c["s"], self.terms, self.rng)
            if alt:
                wrong = alt[0]
                truth = [p["s"] for j, p in enumerate(picks) if j != i][:3]
                return self.mcq("mcq", "Three lines are from the notes. Which one isn't supported?", "", wrong,
                                truth, [cite(c)], changed=alt[1], original=alt[2], pick_unsupported=True)
        return None


LEVEL_MAKERS = {
    1: ["cloze"], 2: ["match", "cloze"], 3: ["complete"], 4: ["which_explains", "complete"],
    5: ["true_false"], 6: ["spot_word", "true_false"], 7: ["classify", "example_of", "true_false"],
    8: ["example_of", "classify", "true_false"], 9: ["odd_one_out", "unsupported", "true_false"],
    10: ["unsupported", "odd_one_out", "true_false"],
}
LEVEL_PLAN = {
    1: ["cloze"] * 5, 2: ["match", "cloze", "match", "cloze", "match"], 3: ["complete"] * 5,
    4: ["which_explains", "complete", "which_explains", "complete", "which_explains"], 5: ["true_false"] * 5,
    6: ["spot_word"] * 5, 7: ["classify"] * 5, 8: ["example_of"] * 5, 9: ["odd_one_out"] * 5, 10: ["unsupported"] * 5,
}
QUIZ_MIX = ["cloze", "cloze", "complete", "which_explains", "true_false", "spot_word", "classify", "example_of",
            "odd_one_out", "unsupported"]
FALLBACK = ["true_false", "cloze", "complete"]


def build_level(topic_id: int, level: int, seed: int = 0) -> dict:
    topic, passages = chapter_passages(topic_id)
    if not topic:
        return {}
    b = Builder(topic, passages, seed * 100 + level)
    plan = QUIZ_MIX if level == QUIZ_LEVEL else LEVEL_PLAN[level]
    questions = []
    for i, kind in enumerate(plan):
        tries = [kind] + [k for k in LEVEL_MAKERS.get(level, []) if k != kind] + FALLBACK
        q = None
        for k in tries:
            q = getattr(b, k)()
            if q:
                break
        if q:
            q["id"] = f"{level}-{i}"
            q["skill"] = SKILLS[level] if level != QUIZ_LEVEL else _skill_of(q)
            questions.append(q)
    if level != QUIZ_LEVEL:
        questions = _model_questions(topic, passages, level, seed, questions)
    used = {c["n"] for q in questions for c in q["cites"]}
    return {"topic": {"id": topic["id"], "title": topic["title"], "course_id": topic["course_id"]},
            "level": level, "skill": SKILLS[level], "blurb": LEVEL_BLURB[level], "pass": math.ceil(PASS_SHARE * len(questions)),
            "questions": questions,
            "passages": {str(p["n"]): {"n": p["n"], "pid": p["pid"], "section": p["section"], "text": p["text"]}
                         for p in passages if p["n"] in used}}


def _skill_of(q):
    return {"cloze": "Recall", "match": "Recall", "complete": "Explain", "truefalse": "Spot the mistake",
            "spot": "Spot the mistake"}.get(q["type"], "Apply" if "belong" in q["prompt"] or "about" in q["prompt"]
                                             else "Analyse")


# ---------------------------------------------------------------- model-written questions (optional)

MODEL_SYSTEM = """You write multiple-choice questions for a student, using ONLY the numbered passages given.
Skill: {skill}. {how}
Reply as JSON: {{"questions": [{{"prompt": "...", "options": ["...", "...", "...", "..."], "answer": <0-3>,
"cite": <passage number>, "quote": "<the exact sentence from that passage that proves the answer>"}}]}}
Write {n} questions. Wrong options must be plausible but contradicted or unsupported by the passages."""
MODEL_HOW = {
    "Explain": "Ask why or how something works, as the notes explain it.",
    "Apply": "Describe a short realistic workplace situation and ask what the notes say to do or which idea applies.",
    "Analyse": "Ask the student to compare ideas, find the weakest claim, or judge which conclusion follows.",
}


def _model_questions(topic, passages, level, seed, fallback):
    skill = SKILLS[level]
    if skill not in MODEL_HOW:
        return fallback
    from .llm import get_llm
    llm = get_llm()
    if not llm.online or not passages:
        return fallback
    rng = random.Random(f"{topic['id']}:{level}:{seed}:m")
    pick = sorted(rng.sample(passages, min(8, len(passages))), key=lambda p: p["n"])
    text = "\n\n".join(f"[P{p['n']}] ({p['section']})\n{p['text']}" for p in pick)
    try:
        out = llm.json(MODEL_SYSTEM.format(skill=skill, how=MODEL_HOW[skill], n=PER_LEVEL),
                       f"Chapter: {topic['title']}\n\n{text}", max_tokens=2500)
    except Exception:
        return fallback
    by_n = {p["n"]: p for p in passages}
    good = []
    for i, q in enumerate(out.get("questions") or []):
        try:
            n, ans, opts = int(q["cite"]), int(q["answer"]), [str(o) for o in q["options"]]
            quote = str(q.get("quote") or "")
        except (KeyError, TypeError, ValueError):
            continue
        p = by_n.get(n)
        if not p or len(opts) != 4 or not 0 <= ans < 4 or overlap(quote, p["text"]) < 0.7:
            continue
        sent = max(sentences(p["text"]) or [p["text"]], key=lambda s: overlap(quote, s))
        good.append({"type": "mcq", "prompt": str(q.get("prompt") or ""), "stem": "", "options": opts,
                     "answer": ans, "cites": [{"n": n, "pid": p["pid"], "sentence": sent}],
                     "id": f"{level}-m{i}", "skill": skill, "by": "model"})
    if len(good) < 3:
        return fallback
    return (good + fallback)[:PER_LEVEL]


# ---------------------------------------------------------------- progress

def ensure_tables():
    db.run("CREATE TABLE IF NOT EXISTS fast_track (learner_id INTEGER, topic_id INTEGER, level INTEGER, "
           "best INTEGER, total INTEGER, stars INTEGER, xp INTEGER, attempts INTEGER, passed INTEGER, "
           "updated_at TEXT, PRIMARY KEY (learner_id, topic_id, level))")
    db.run("CREATE TABLE IF NOT EXISTS fast_track_learner (learner_id INTEGER PRIMARY KEY, xp INTEGER DEFAULT 0, "
           "streak INTEGER DEFAULT 0, best_streak INTEGER DEFAULT 0, answered INTEGER DEFAULT 0, "
           "correct INTEGER DEFAULT 0, sure_right INTEGER DEFAULT 0, sure_wrong INTEGER DEFAULT 0, "
           "day_streak INTEGER DEFAULT 0, last_day TEXT)")


def stars_for(correct: int, total: int) -> int:
    if not total:
        return 0
    share = correct / total
    return 3 if share >= 0.99 else 2 if share >= 0.8 else 1 if share >= PASS_SHARE else 0


def learner_stats(learner_id: int) -> dict:
    ensure_tables()
    s = db.one("SELECT * FROM fast_track_learner WHERE learner_id = ?", (learner_id,))
    return s or {"learner_id": learner_id, "xp": 0, "streak": 0, "best_streak": 0, "answered": 0, "correct": 0,
                 "sure_right": 0, "sure_wrong": 0, "day_streak": 0, "last_day": None}


def chapter_progress(learner_id: int, course_id: int) -> dict[int, dict]:
    ensure_tables()
    out: dict[int, dict] = {}
    for r in db.q("SELECT f.* FROM fast_track f JOIN topics t ON t.id = f.topic_id WHERE f.learner_id = ? "
                  "AND t.course_id = ?", (learner_id, course_id)):
        out.setdefault(r["topic_id"], {})[r["level"]] = {"best": r["best"], "total": r["total"],
                                                          "stars": r["stars"], "passed": bool(r["passed"])}
    return out


def record(learner_id: int, topic_id: int, level: int, answers: list[dict], today: date) -> dict:
    """Save one finished level: best score, XP, streaks, a score row and the topic's mastery."""
    ensure_tables()
    total = len(answers)
    correct = sum(1 for a in answers if a.get("ok"))
    xp = sum(max(0, int(a.get("xp") or 0)) for a in answers)
    passed = total > 0 and correct >= math.ceil(PASS_SHARE * total)
    stars = stars_for(correct, total)
    old = db.one("SELECT * FROM fast_track WHERE learner_id = ? AND topic_id = ? AND level = ?",
                 (learner_id, topic_id, level))
    if old:
        db.run("UPDATE fast_track SET best = ?, total = ?, stars = ?, xp = xp + ?, attempts = attempts + 1, "
               "passed = ?, updated_at = ? WHERE learner_id = ? AND topic_id = ? AND level = ?",
               (max(old["best"], correct) if old["total"] == total else correct, total, max(old["stars"], stars),
                xp, int(passed or old["passed"]), today.isoformat(), learner_id, topic_id, level))
    else:
        db.run("INSERT INTO fast_track VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
               (learner_id, topic_id, level, correct, total, stars, xp, int(passed), today.isoformat()))

    s = learner_stats(learner_id)
    streak, best = s["streak"], s["best_streak"]
    sure_right, sure_wrong = s["sure_right"], s["sure_wrong"]
    for a in answers:
        streak = streak + 1 if a.get("ok") else 0
        best = max(best, streak)
        if a.get("sure") == "certain":
            sure_right += 1 if a.get("ok") else 0
            sure_wrong += 0 if a.get("ok") else 1
    last = s["last_day"]
    day_streak = s["day_streak"] or 0
    if last != today.isoformat():
        day_streak = day_streak + 1 if last == (today - timedelta(days=1)).isoformat() else 1
    db.run("INSERT INTO fast_track_learner (learner_id, xp, streak, best_streak, answered, correct, sure_right, "
           "sure_wrong, day_streak, last_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(learner_id) DO UPDATE "
           "SET xp = excluded.xp, streak = excluded.streak, best_streak = excluded.best_streak, "
           "answered = excluded.answered, correct = excluded.correct, sure_right = excluded.sure_right, "
           "sure_wrong = excluded.sure_wrong, day_streak = excluded.day_streak, last_day = excluded.last_day",
           (learner_id, s["xp"] + xp, streak, best, s["answered"] + total, s["correct"] + correct, sure_right,
            sure_wrong, day_streak, today.isoformat()))

    kind = "fast_track_quiz" if level == QUIZ_LEVEL else f"fast_track_l{level}"
    db.insert("scores", learner_id=learner_id, topic_id=topic_id, kind=kind, score=correct, max=total,
              taken_on=today.isoformat())
    mastery = update_mastery(learner_id, topic_id)
    return {"correct": correct, "total": total, "passed": passed, "stars": stars, "xp": xp,
            "stats": learner_stats(learner_id), "mastery": mastery}


def update_mastery(learner_id: int, topic_id: int) -> dict:
    """Mastery 1-5 for the teacher's heatmap: accuracy, capped by how far up the ladder the learner has climbed.

    Two cleared levels lift the cap by one; the final quiz, once taken, sets the level on its own.
    """
    rows = db.q("SELECT level, passed FROM fast_track WHERE learner_id = ? AND topic_id = ?", (learner_id, topic_id))
    cleared = max([r["level"] for r in rows if r["passed"] and r["level"] != QUIZ_LEVEL] or [0])
    sc = db.one("SELECT SUM(score) AS s, SUM(max) AS m, COUNT(*) AS n FROM scores WHERE learner_id = ? AND topic_id = ? "
                "AND kind LIKE 'fast_track%'", (learner_id, topic_id))
    pct = (sc["s"] or 0) / sc["m"] if sc and sc["m"] else 0
    quiz = db.one("SELECT score, max FROM scores WHERE learner_id = ? AND topic_id = ? AND kind = 'fast_track_quiz' "
                  "ORDER BY id DESC LIMIT 1", (learner_id, topic_id))
    if quiz and quiz["max"]:
        qp = quiz["score"] / quiz["max"]
        level = level_from_pct(qp)
        basis = f"Fast Track final quiz {round(100 * qp)}%, ladder level {cleared} of 10"
    else:
        level = max(1, min(level_from_pct(pct), 1 + cleared // 2))
        basis = f"Fast Track: cleared level {cleared} of 10, {round(100 * pct)}% correct over {sc['n']} round(s)"
    db.run("INSERT INTO mastery (learner_id, topic_id, level, basis) VALUES (?, ?, ?, ?) "
           "ON CONFLICT(learner_id, topic_id) DO UPDATE SET level = excluded.level, basis = excluded.basis",
           (learner_id, topic_id, level, basis))
    return {"level": level, "basis": basis}
