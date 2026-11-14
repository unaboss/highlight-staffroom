# PROGRESS: Classroom Fast Track (CFT)

## Handoff

**Now:** Classroom Fast Track (CFT) is being prepared for the hackathon hand-in. Working branch
`fast-track-melsoft` (local; several threads commit here). Public deploy = one squashed, privacy-checked
commit on local `fast-track-publish`, pushed to `origin fast-track` only when the owner writes "push".
- Deploy: `docker build -t staffroom .` then `docker run -p 8000:8000 -e PORT=8000 staffroom`. Health check
  `/api/health`. The image defaults to `FASTTRACK_DATA=demo`, `FASTTRACK_PUBLIC=1`, `FASTTRACK_PUBLIC_AI=1`.
- Live AI on the host (secrets, never in the repo): `NEBIUS_API_KEY` (or `LLM_API_KEY`) = the DeepSeek key,
  `NEBIUS_BASE_URL=https://api.deepseek.com`, `NEBIUS_MODEL=deepseek-chat`. Caps (all optional):
  `FASTTRACK_AI_PER_IP_HOUR=100`, `FASTTRACK_AI_PER_DAY=3000`, `FASTTRACK_AI_TOKENS_PER_DAY=5000000`,
  `FASTTRACK_AI_MAX_TOKENS=900`. One Principal question or one lesson draft = one action. At a cap the
  app gives the offline answer with a calm notice. No key = offline everywhere. See `app/ai_gate.py`.
- Notes: the Note button works on the laptop (dev-notes/, `tools/notes_watcher.py` claims each note in 10 s)
  and on the public demo (cited history in `data/demo/notes-history.json`, rebuilt by
  `python -m tools.build_notes_history`; visitor notes capped and never acted on).
- The Docker image has not been test-built on the laptop (Docker Desktop's engine would not start).

**Next:** merge the student-landing (notes 44-46) and self-correction (AgentRun) branches when their
subagents report; mount AgentRun on View plan's prepare action; rebuild the squashed commit.

**Blocked:** nothing. Never commit `data/melsoft/`, `dev-notes/`, `screenshots/`, `.env`, `.claude/` or the database.

## Adding a page

Pages live in `web/src/pages/`, and all routes are decided in one place: the route chain at the bottom of
`web/src/App.tsx` (hash routes: `#/<page>/<sub>`). To add a page without clashing with other threads:
1. Create `web/src/pages/MyPage.tsx` (default export). Use `components/ui/loading.tsx` for its loading and
   error states and `components/ui/kit.tsx` for cards and pills.
2. In `App.tsx`, import it and add one flag next to the others, e.g.
   `const mine = page === "class" && sub[0] === "mine";`, then one branch in the route chain
   (`mine ? <MyPage /> : ...`). Staff pages sit under `#/class/...`; learner pages under `#/play/...`.
3. Link to it from the page that leads there (a button or `<a href="#/class/mine">`), and give the new page a
   "Back to …" link.
4. Server data: add endpoints in a new `app/<feature>.py` with an `APIRouter`, included in `app/main.py`
   with one `app.include_router(...)` line. Any model call goes through `ai_gate.for_action(ip)`.
5. Tests in `tests/test_<feature>.py`; run `python -m pytest -q` and `cd web && npm run build`.

## Lesson prep (dev note 30, branch `fast-track-view-plan`)

**View plan** now opens `#/class/prep`: the road to the exam (interactive timeline), the last Meet class
with its thumbnail or a drawn class card, which sections the transcript covered and the pace that implies,
and the lesson as a cited slide deck (cut/add slides, Wikimedia Commons images, print the bundle).
The inline plan card on the facilitator page is gone; prepare, approve and "after class" live on the prep
page. Details and what the agents still need for presentations and web images: `docs/LESSON-PREP.md`.
Deck edits are stored in table `ft_decks`; downloaded images in `prep-images/` beside the database.

## Show progress, View plan notes, Review classes (dev note 39, branch `fast-track-track-progress`)

The prep page is split in three. **Show progress** (`#/class/progress`, button on Covered so far): the road
to the exam, three pace lines in % of the notes (needed to finish by the exam, the class, the average
learner's Fast Track) and a Counsellor button for a catch-up plan (`POST /api/ft/{cid}/progress/plan`, one
live-AI action through `ai_gate`, offline rules otherwise). **View plan** (`#/class/prep`): the next chapter's notes as a reader with
back/forward through earlier sections and chapters (`GET /api/ft/{cid}/notes`), the last class with a
**Review classes** button, coverage, the deck and After class. **Review classes** (`#/class/classes[/sid]`):
every class with transcript, P#-cited passages it taught, learners caught up (3+ Fast Track levels on the
chapter) and the timeline. Shared pieces: `web/src/components/prep-parts.tsx`; server: `app/progress.py`.
The sample class seed adds made-up past classes (`sample class (past)`, Sample learners only).
On a public deploy these endpoints serve the demo course only.

## Local run

`run.bat` serves the real Melsoft course on http://localhost:8001 (the DeepSeek key is saved in the local
database). `run.bat present` hides the dev Note button. Notes left with the Note button land in `dev-notes/`.
