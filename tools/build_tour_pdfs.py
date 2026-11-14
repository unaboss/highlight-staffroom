"""Build one PDF per presenting tour (web/src/lib/tours.json) into docs/presenting/: a screenshot of
each step's page with its caption and timing. Screenshots are taken from a server running the made-up
demo course (FASTTRACK_DATA=demo), so no private course content ends up in the PDFs.

    FASTTRACK_DATA=demo FASTTRACK_PUBLIC=1 uvicorn app.main:app --port 8010   # in another terminal
    python -m tools.build_tour_pdfs --base http://localhost:8010
"""

import argparse
import base64
import html
import json
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TOURS = REPO / "web" / "src" / "lib" / "tours.json"
OUT = REPO / "docs" / "presenting"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def chrome(*args: str, timeout: int = 90) -> None:
    with tempfile.TemporaryDirectory() as prof:
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={prof}", *args],
                       capture_output=True, timeout=timeout)


def shot(base: str, role: str, route: str, path: Path) -> None:
    if not path.exists():
        chrome("--window-size=1440,900", "--virtual-time-budget=9000", f"--screenshot={path}",
               f"{base}/fast-track/?role={role}{route}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8010")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    for tour in json.loads(TOURS.read_text(encoding="utf-8")):
        total = round(sum(s["ms"] for s in tour["steps"]) / 1000)
        rows = []
        for i, st in enumerate(tour["steps"], 1):
            img = tmp / f"{tour['role']}{st['route'].replace('/', '_').replace('#', '')}.png"
            shot(a.base, tour["role"], st["route"], img)
            src = "data:image/png;base64," + base64.b64encode(img.read_bytes()).decode() if img.exists() else ""
            rows.append(f'''<div class="step"><div class="n">{i}</div>
              {f'<img src="{src}">' if src else '<div class="ph"></div>'}
              <div class="t"><b>{html.escape(st["say"])}</b><span>{html.escape(st["route"])} · {round(st["ms"] / 1000)} s</span></div></div>''')
        page = f'''<!doctype html><meta charset="utf-8"><title>{html.escape(tour["title"])}</title>
<style>
  @page {{ size: A4; margin: 14mm }}
  body {{ font: 13px/1.45 "Segoe UI", Inter, sans-serif; color: #1a0d14; margin: 0 }}
  h1 {{ font-size: 22px; margin: 0 }} .sub {{ color: #8a5a72; margin: 2px 0 12px }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px }}
  .step {{ position: relative; border: 1px solid #f0c6dc; border-radius: 10px; overflow: hidden; break-inside: avoid }}
  .step img, .ph {{ display: block; width: 100%; aspect-ratio: 16/10; object-fit: cover; object-position: top; background: #0c0b0e }}
  .n {{ position: absolute; left: 8px; top: 8px; width: 22px; height: 22px; border-radius: 50%; background: #e6197f; color: #fff;
        font-weight: 700; display: grid; place-items: center; font-size: 12px }}
  .t {{ padding: 7px 9px }} .t b {{ display: block; font-weight: 600 }} .t span {{ color: #8a5a72; font-size: 11px }}
</style>
<h1>{html.escape(tour["title"])}</h1>
<p class="sub">Classroom Fast Track · presenting tour · about {total} s · signed in as {html.escape(tour["role"])} · press the small "i" on the right to play it</p>
<div class="grid">{"".join(rows)}</div>'''
        src = tmp / f"{tour['id']}.html"
        src.write_text(page, encoding="utf-8")
        pdf = OUT / f"tour-{tour['id']}.pdf"
        chrome("--no-pdf-header-footer", f"--print-to-pdf={pdf}", src.as_uri())
        print(pdf.relative_to(REPO), "ok" if pdf.exists() else "FAILED")


if __name__ == "__main__":
    main()
