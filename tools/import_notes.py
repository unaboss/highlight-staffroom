"""Import a folder of Word (.docx) course notes as a Staffroom course.

    python -m tools.import_notes "C:/path/to/notes" --course "Melsoft" --out data/melsoft

1. Converts every .docx with pandoc (falls back to reading the docx XML when pandoc is missing).
   When "X.docx" and "X (AutoRecovered).docx" both exist, the newer file wins.
2. Normalises the headings so each knowledge topic (KM-01 KT02, ...) becomes a "# chapter" and
   each sub-topic (KT0203 ...) a "## section": the shape the Librarian splits on.
3. Writes the Markdown to --out (keep it out of git: the notes are private).
4. Creates the course (or rebuilds it with --replace), with one syllabus topic per chapter, and
   hands each file to the Librarian, exactly as an upload from Settings would.
"""

import argparse
import math
import re
import shutil
import subprocess
import sys
import zipfile
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402
from app.agents import librarian, principal  # noqa: E402
from app.textutil import content_words  # noqa: E402

CHAPTER_RE = re.compile(r"K[MT]\s*-?\s*0?\d+\s*-\s*KT\s*[O0]?(\d+)\s*:?\s*(.*)", re.I)
SECTION_RE = re.compile(r"\bKT\s*(\d{2})(\d{2,3})\b\s*(.*)", re.I)
SECTION_GLUED_RE = re.compile(r"\bKT(\d{2})(\d{2})([A-Za-z].*)")
NUMBERING_RE = re.compile(r"^\s*(\d+(\.\d+)*\.?)\s+")


# ---------------------------------------------------------------- conversion

def pick_files(src: Path) -> list[Path]:
    """One file per module: the newest of "X.docx" and "X (AutoRecovered).docx"."""
    best: dict[str, Path] = {}
    for f in sorted(src.glob("*.docx")):
        if f.name.startswith("~$"):
            continue
        key = module_name(f)
        if key not in best or f.stat().st_mtime > best[key].stat().st_mtime:
            best[key] = f
    return [best[k] for k in sorted(best)]


def module_name(f: Path) -> str:
    stem = re.sub(r"\(autorecovered\)", "", f.stem, flags=re.I).strip()
    m = re.match(r"km\s*-?\s*0?(\d+)", stem, re.I)
    return f"KM-{int(m.group(1)):02d}" if m else stem.replace(" ", "-")


def docx_to_markdown(path: Path) -> str:
    if shutil.which("pandoc"):
        out = subprocess.run(["pandoc", str(path), "-t", "gfm", "--wrap=none"], capture_output=True,
                             check=True)
        return out.stdout.decode("utf-8", errors="replace")
    return docx_xml_to_markdown(path)


def docx_xml_to_markdown(path: Path) -> str:
    """No pandoc: read paragraphs and Heading styles straight from word/document.xml."""
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", errors="replace")
    lines = []
    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", para))
        style = re.search(r'<w:pStyle w:val="([^"]+)"', para)
        level = re.match(r"Heading(\d)", style.group(1)) if style else None
        if level:
            lines.append("#" * int(level.group(1)) + " " + text)
        else:
            lines.append(text)
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- normalising

def clean_inline(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?", " ", text)     # images
    text = re.sub(r"<[^>]+>", " ", text)                                # html
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)               # links: keep the words
    text = text.replace("**", "").replace("__", "")
    text = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|>~^$'\"])", r"\1", text)   # markdown escapes
    return re.sub(r"[ \t]+", " ", text).strip()


def clean_heading(text: str) -> str:
    text = clean_inline(text).strip(" *#")
    text = SECTION_GLUED_RE.sub(lambda m: f"KT{m.group(1)}{m.group(2)} {m.group(3)}", text)
    text = NUMBERING_RE.sub("", text)
    return text.strip(" .,:;").replace("|", "/")


def body_line(line: str) -> str | None:
    s = line.strip()
    if re.fullmatch(r"\|?[\s:\-|]+\|?", s) and "-" in s:               # table separator row
        return None
    if s.startswith("|") and s.endswith("|"):
        cells = [clean_inline(c) for c in s.strip("|").split("|")]
        s = " — ".join(c for c in cells if c)
        return s or None
    s = clean_inline(s)
    return s


def normalise(md: str, module: str) -> tuple[str, list[dict]]:
    """Return clean Markdown and the chapter list [{"title", "words"}]."""
    chapters: list[dict] = []
    out: list[str] = []
    current = 0
    pending: dict | None = None        # a chapter opened by a section code, titled by its first sections

    def open_chapter(num: int, title: str | None):
        nonlocal current, pending
        current = num
        ch = {"num": num, "title": title, "sections": [], "words": 0, "line": len(out)}
        chapters.append(ch)
        out.append("")                                  # placeholder, filled in at the end
        out.append("")
        pending = ch if not title else None

    for raw in md.splitlines():
        m = re.match(r"^(#{1,6})\s*(.*)$", raw.strip())
        if m:
            level, text = len(m.group(1)), m.group(2)
            plain = clean_inline(text).strip(" *#")
            if not plain:
                continue
            cm = CHAPTER_RE.search(plain)
            if cm:
                num, title = int(cm.group(1)), clean_heading(cm.group(2)) or None
                if num != current:
                    open_chapter(num, title)
                elif title and chapters and not chapters[-1]["title"]:
                    chapters[-1]["title"] = title
                continue
            sm = SECTION_RE.search(plain) or SECTION_GLUED_RE.search(plain)
            if sm:
                num = int(sm.group(1))
                if num == current + 1 or not chapters:
                    open_chapter(num, None)
            elif level == 1:
                open_chapter(current + 1, clean_heading(plain))
                continue
            if not chapters:
                open_chapter(1, None)
            sec = clean_heading(plain)
            if sec:
                chapters[-1]["sections"].append(sec)
                out.append(f"## {sec}")
                out.append("")
            continue
        line = body_line(raw)
        if line is None:
            continue
        if line and not chapters:
            open_chapter(1, None)
        if line:
            chapters[-1]["words"] += len(line.split())
        out.append(line)

    for ch in chapters:
        if not ch["title"]:
            names = [re.sub(r"^KT\d+\s*", "", s) for s in ch["sections"][:2]]
            title = ", ".join(n.strip(" ,") for n in names if n) or "Notes"
            if len(title) > 70:
                title = title[:70].rsplit(" ", 1)[0].rstrip(" ,:;") + "…"
            ch["title"] = title
        ch["title"] = f"{module} KT{ch['num']:02d}: {ch['title']}"
        out[ch["line"]] = f"# {ch['title']}"
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"
    return text, [{"title": c["title"], "words": c["words"]} for c in chapters if c["words"] > 0]


def keywords_for(chapters_text: dict[str, str], k: int = 4) -> dict[str, str]:
    """A few words that are common in one chapter and rare in the rest, for the Librarian's searches."""
    tf = {t: Counter(content_words(body)) for t, body in chapters_text.items()}
    df = Counter(w for c in tf.values() for w in c)
    n = len(tf)
    out = {}
    for t, c in tf.items():
        scored = sorted(c, key=lambda w: -c[w] * math.log((n + 1) / df[w]))
        out[t] = ", ".join([w for w in scored if len(w) > 3][:k])
    return out


# ---------------------------------------------------------------- course

def build(src: Path, out_dir: Path, course: str, replace: bool) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {"loaded": [], "failed": [], "skipped": [], "chapters": 0, "passages": 0}
    files = pick_files(src)
    report["skipped"] = sorted(f.name for f in src.glob("*.docx") if f not in files and not f.name.startswith("~$"))
    modules = []
    for f in files:
        mod = module_name(f)
        try:
            text, chapters = normalise(docx_to_markdown(f), mod)
        except Exception as e:  # keep going: one bad file shouldn't stop the rest
            report["failed"].append({"file": f.name, "error": str(e)})
            continue
        if not chapters:
            report["failed"].append({"file": f.name, "error": "no text found"})
            continue
        (out_dir / f"{mod}.md").write_text(text, encoding="utf-8")
        modules.append((mod, f, text, chapters))

    existing = db.q("SELECT id FROM courses WHERE title = ?", (course,))
    if existing and not replace:
        raise SystemExit(f"Course “{course}” already exists. Use --replace to rebuild it.")
    from app.main import _delete_course
    for c in existing:
        _delete_course(c["id"])

    # Syllabus: one topic per chapter, about 120 words of notes per teaching minute… roughly.
    bodies: dict[str, str] = {}
    for _, _, text, _ in modules:
        for block in re.split(r"(?m)^# ", text)[1:]:
            title, _, body = block.partition("\n")
            bodies[title.strip()] = body
    kws = keywords_for(bodies)
    lines, n = [], 0
    for _, _, _, chapters in modules:
        for ch in chapters:
            n += 1
            minutes = max(45, min(360, 15 * round(ch["words"] / 120 / 15)))
            lines.append(f"{n}. {ch['title']} ({minutes} min) | keywords: {kws.get(ch['title'], '')}")
    topics = principal.parse_syllabus("\n".join(lines))
    start = principal.today_for()
    cid = db.insert("courses", title=course, subject="Cyber security (Melsoft Academy)", grade="", curriculum="",
                    teacher="", term_start=start.isoformat(), exam_date=(start + timedelta(days=180)).isoformat(),
                    slot_days=db.dumps([0, 2, 4]), slot_minutes=90)
    for i, t in enumerate(topics, 1):
        db.insert("topics", course_id=cid, seq=i, title=t["title"], minutes=t["minutes"], keywords=t["keywords"])
    for mod, f, text, chapters in modules:
        _, count = librarian.ingest_file(cid, f"{mod}.md", text.encode("utf-8"))
        report["loaded"].append({"file": f.name, "module": mod, "chapters": len(chapters), "passages": count})
        report["chapters"] += len(chapters)
        report["passages"] += count
    from app import orchestrator
    orchestrator.job_plan_course(lambda *a, **k: None, cid)
    report["course_id"] = cid
    report["topics"] = len(topics)
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path, help="folder of .docx notes (read only)")
    ap.add_argument("--course", default="Melsoft")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "melsoft")
    ap.add_argument("--replace", action="store_true", help="rebuild the course if it exists")
    a = ap.parse_args()
    r = build(a.src, a.out, a.course, a.replace)
    for item in r["loaded"]:
        print(f"  {item['file']:<32} {item['module']}  {item['chapters']:>2} chapters  {item['passages']:>4} passages")
    for item in r["failed"]:
        print(f"  FAILED {item['file']}: {item['error']}")
    for name in r["skipped"]:
        print(f"  skipped older copy: {name}")
    print(f"Course id {r['course_id']}: {r['topics']} topics, {r['chapters']} chapters, {r['passages']} passages")


if __name__ == "__main__":
    main()
