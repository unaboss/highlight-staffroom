"""Small text helpers shared by the agents: tokenising, overlap scores, citations."""

import re

STOPWORDS = set("""
a an the and or but if then else of to in on at by for with from into onto over under as is are was were be been
being it its this that these those there here which who whom whose what when where why how not no nor so than too
very can could should would may might must will shall do does did done have has had having i you he she we they me
him her us them my your his our their also just only such each every any all some more most other same both few
many much one two three about after before between through during above below up down out off again further once
s t don now use used using like get gets got make makes made way ways e g ie eg etc per
because don't doesn't isn't aren't can't won't didn't i'm it's that's we're you're they're
""".split())

WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-']+")
CITE_RE = re.compile(r"\[P(\d+)\]")


def stem(word: str) -> str:
    w = word.lower().strip("'")
    for suf in ("ations", "ation", "ings", "ing", "edly", "ies", "ied", "es", "ed", "ly", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            if suf in ("ies", "ied"):
                return w[: -len(suf)] + "y"
            return w[: -len(suf)]
    return w


def content_words(text: str) -> list[str]:
    return [stem(w) for w in WORD_RE.findall(text or "") if w.lower() not in STOPWORDS and len(w) > 2]


def overlap(claim: str, source: str) -> float:
    """Share of the claim's content words that also appear in the source (0..1)."""
    cw = set(content_words(strip_cites(claim)))
    if not cw:
        return 0.0
    sw = set(content_words(source))
    return len(cw & sw) / len(cw)


def missing_words(claim: str, source: str) -> list[str]:
    """Content words of the claim that don't appear in the source (original spelling)."""
    sw = set(content_words(source))
    out = []
    for w in WORD_RE.findall(strip_cites(claim)):
        if w.lower() in STOPWORDS or len(w) <= 2:
            continue
        if stem(w) not in sw and w.lower() not in (x.lower() for x in out):
            out.append(w)
    return out


def strip_cites(text: str) -> str:
    return CITE_RE.sub("", text or "").strip()


def cites(text: str) -> list[int]:
    return [int(n) for n in CITE_RE.findall(text or "")]


def sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text or "").strip()
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z\"'(])", text)
    return [p.strip() for p in parts if len(p.strip()) > 2]


def to_fts_query(text: str) -> str:
    """Free text to a safe FTS5 OR-query. Every term is quoted, so input can't inject syntax."""
    phrases = re.findall(r'"([^"]+)"', text or "")
    rest = re.sub(r'"[^"]+"', " ", text or "")
    words = [w for w in re.findall(r"[\w']+", rest.lower()) if w not in STOPWORDS and len(w) > 1]
    parts = [f'"{p.replace(chr(34), "")}"' for p in phrases]
    parts += [f'"{w}"' for w in dict.fromkeys(words)]
    return " OR ".join(parts)
