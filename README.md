# Staffroom Fast Track

**AI staff for online schools, and a game that gets learners exam-ready.** Six agents work like the staff of a school. They plan the term against the exam date, write lesson plans from the teacher's own notes, check every claim against those notes, read the class recording to see who took part, and draft personal tests. Learners climb a tower of questions built from the same notes, and every question cites the passage it came from. Nothing reaches a learner until the teacher approves it.

Built for **Colleague Zero**, the Melsoft Academy hackathon.

## What each role sees

**School owner** (`/fast-track/#/school`)
- Every course at a glance: which will finish before its exam, which are at risk, and why.
- One school drawing where each course is a column of windows.

**Facilitator** (`/fast-track/#/class`)
- The course being taught as the headline, the module and section in progress, and days to the exam.
- *Covered so far*: a route map of the chapters, with a pin where the last class stopped.
- *Next lesson*: one row with a **View plan** button. The plan cites the notes line by line, shows the Examiner's verdict, and can be printed or approved. After class, record where you stopped.
- *Exam runway*: one tile per lesson; tiles after the exam flag are striped.
- *Student plans* (own page): the race, each learner's pace and finish date, topics ready to test, catch-up or early release, learners to check, and class participation from the Meet transcript.
- *Tests waiting for approval*.
- **Settings** (gear icon): the AI model and the Google Meet, Moodle and ClickUp connections.

**Student** (`/fast-track/#/play`)
- A 3D tower of the floors they have built, ahead / behind / done, and a **Begin Fast Track cycle** button.
- Scroll down into the course as a tree; each chapter is a ten-floor climb plus a final quiz.
- Every question is five-a-floor, cites a passage, and asks how sure you are first. Time runs out → a full-screen *Time's up* and the passage it came from.

**Demo LMS** (`/lms`): a separate Moodle-style site showing how Fast Track sits inside a school's own LMS.

**Classic Staffroom** (`/staffroom`): the original agent dashboard with the live hand-off board.

## The staff

| Agent | Job | What keeps it honest |
|---|---|---|
| **Principal** | Turns the syllabus into a term of lessons on the timetable, forecasts the finish date, and re-plans when the class falls behind | Pacing is counted in code from real dates, not guessed |
| **Librarian** | Searches the course notes (SQLite FTS5, BM25) and numbers the passages it finds: P1, P2… | It is the only agent that reads the notes; the others can cite only what it hands over |
| **Subject Teacher** | Writes the lesson plan and personal tests, citing a passage for every statement | Citations to passages it wasn't given are stripped before review |
| **Examiner** | Marks every statement and memo answer against the cited passage, and sends unsupported work back (at most twice, then flags it to the teacher) | A grounding score in code: the share of a statement's key words found in the passage. With a model it must also say *Supported*, and under 20% grounding always fails |
| **Class Observer** | Reads the Meet or Teams transcript and register and scores each learner's participation. It passes what learners said about the topic to the Examiner | Minutes, turns, questions and answers are counted in code. Only "on topic" is a judgement |
| **Counsellor** | Keeps mastery 1–5 per learner per topic, flags who needs help, and sets each test one level above mastery | Every flag carries its evidence: transcript lines, quiz marks, minutes present |

**The loop:** Principal plans the term → Librarian finds passages → Subject Teacher drafts → Examiner checks and sends back → teacher teaches → Class Observer scores the class → Examiner checks what learners said → Counsellor flags → Subject Teacher drafts a personal test → Examiner checks the memo → **teacher approves** (in Staffroom or by moving the ClickUp task).

## How it meets the judging questions

- **Breaks work into steps:** each job is a chain of hand-offs between agents, streamed live to the Staffroom board. Every step is stored as an event.
- **Checks its own work and doesn't hallucinate:** the Examiner checks every lesson statement and memo answer against the teacher's notes. The send-back loop is capped at two rounds, then the issue goes to the teacher instead of being hidden. You can type a false statement into "Try to trick the Examiner" on any lesson and watch it fail.
- **Finishes results:** a lesson plan with sources, a class report with evidence, follow-ups, and tests that are ready to approve. With ClickUp connected, all of these become tasks in a course Space.
- **Multi-agent collaboration:** six agents with separate jobs. Only the Librarian reads the notes, and only the Examiner can pass work.
- **Meets a real need:** online teachers lose hours to planning, chasing quiet learners and writing remedial tests, and classes fall behind without anyone noticing until exam week.

## Run it

You need **Python 3.10+** and, to build the React app, **Node 20+**.

**Windows:** double-click `run.bat`. It installs what it needs, builds the app the first time, and opens http://localhost:8001. `run.bat present` hides the dev Note button for presenting.

**By hand (any OS):**
```sh
python -m venv .venv
. .venv/bin/activate                 # Windows: .venv\Scriptsctivate
pip install -r requirements.txt
cd web && npm install && npm run build && cd ..
uvicorn app.main:app --port 8001
```
Open http://localhost:8001 and pick a role. There is no sign-up.

**Docker** (builds the React app and the server in one image):
```sh
docker build -t staffroom .
docker run -p 8000:8000 -e PORT=8000 -v staffroom:/data staffroom
```

### Deploy anywhere that runs Docker

```sh
docker build -t staffroom .
docker run -p 8000:8000 -e PORT=8000 staffroom
```

Health check: `GET /api/health` (returns `{"ok": true, ...}`). The first start loads the demo course in about 20 seconds.

| Variable | Default in the image | What it does |
|---|---|---|
| `PORT` | `8000` | Port the server listens on |
| `FASTTRACK_DATA` | `demo` | `demo` loads only the made-up demo course and the labelled sample learners |
| `FASTTRACK_PUBLIC` | `1` | Settings are read-only, keys come only from env vars, and the Note button is off |
| `STAFFROOM_DEV_NOTES` | `0` | The dev Note button (off in public deploys) |
| `STAFFROOM_DB` | `/data/staffroom.db` | SQLite file; mount a volume at `/data` to keep it between restarts |
| `NEBIUS_API_KEY` | *(empty: offline mode)* | Optional API key for any OpenAI-compatible model (the name is historical) |
| `NEBIUS_BASE_URL` | Nebius | Optional base URL, e.g. `https://api.deepseek.com` |
| `NEBIUS_MODEL` | Nemotron | Optional model, e.g. `deepseek-chat` |

Without `NEBIUS_API_KEY` the public demo runs in offline mode, so visitors can't spend anyone's model credit.

### Deploy on Render (free)

The repo has a `render.yaml` blueprint: a free Docker web service from the `fast-track` branch, health check `/api/health`, public demo mode on. In Render choose **New → Blueprint**, pick this repository, and deploy. The first start loads the demo course in about 20 seconds.

### Demo data or your own notes

- **Demo mode** (`FASTTRACK_DATA=demo`, and the default on an empty database): a made-up course, *Network Security Fundamentals*, from `data/demo/`, plus ten labelled sample learners (Sample 1 to Sample 10) and one sample class run through the agents. Nothing else is loaded.
- **Public mode** (`FASTTRACK_PUBLIC=1`): Settings are read-only and keys can only come from environment variables, and the Note button is off. The Docker image and `render.yaml` turn this on.
- **Your own notes:** import Word, Markdown, text or PDF notes into a course, then add the sample class if you want one:
  ```sh
  python -m tools.import_notes "C:/path/to/notes" --course "My course" --out data/my-course
  python -m tools.seed_sample_class --course "My course"          # --remove takes it out again
  ```
  Everything under `data/` except `data/demo/` is git-ignored, so imported notes and the database stay on your machine.

### Use a model (DeepSeek or any OpenAI-compatible API)

Without a key the agents run in **offline mode**: they draft straight from the notes and check with rules in code, so the whole demo works with no network.

To use a model, open **Settings** (gear icon, owner or facilitator), pick **DeepSeek** (base URL `https://api.deepseek.com`, model `deepseek-chat`), paste the key, **Save**, then **Test connection**. Use `deepseek-chat`; `deepseek-reasoner` doesn't support the JSON replies the agents rely on. OpenAI and Nebius presets work the same way, and **Custom** takes any OpenAI-compatible base URL.

On a server, set the key as environment variables instead: `NEBIUS_API_KEY`, `NEBIUS_BASE_URL` and `NEBIUS_MODEL` (the names are historical; any provider works). The app never sends a saved key back to the browser; it shows only its first three and last four characters.

## Connections (Settings)

| Service | What you give it | What Staffroom does |
|---|---|---|
| **Model** | Base URL, model and key for any OpenAI-compatible endpoint. Default: Nemotron Super 49B on Nebius Token Factory | Drafting, revising, search planning, on-topic judgements, and the Examiner's second opinion |
| **ClickUp** | Personal API token (ClickUp → Settings → Apps), then **Set up this course** | Creates a Space with three lists: *Lesson plan*, *Learner follow-ups* and *Tests: needs approval*. Plans, reports and tests become tasks. **Check for approvals** releases a test once its task is closed |
| **Google Meet** | OAuth access token with `meetings.space.readonly` | Pulls the latest class for a meeting code: participant sessions for the register, and transcript entries for the Class Observer. Transcripts must be on in the meeting |
| **Moodle** | Site URL and a web service token | Imports the class list (`core_enrol_get_enrolled_users`) |
| **Notes** | Markdown, text or PDF | The Librarian splits it into passages by chapter, section and page |

You can upload a transcript (`.vtt`) and a register (`.csv` with name, joined, left) in the classic Staffroom instead of using Meet.

## How it's built

- **FastAPI** back end and one **SQLite** file, with FTS5 full-text search. There is no other server.
- **Agents** in `app/agents/`. `app/orchestrator.py` chains them into jobs on background threads. Every step is an event, streamed to the browser over **SSE** (`/api/events/stream`).
- **Dashboard** is plain HTML, CSS and JavaScript in `app/static/`, with no build step.
- **Integrations** in `app/integrations/`: ClickUp API v2, Google Meet REST v2 and Moodle web services, all using `httpx`.
- The citation and checking approach is adapted from the *Ask the Commission* app: numbered passages, citations required, and a verdict per claim.

```
app/
  agents/      principal, librarian, teacher, examiner, observer, counsellor
  integrations/clickup, meet, moodle
  orchestrator.py   jobs: plan term, prepare lesson, process class, build test, sync ClickUp
  main.py           API + static dashboard
  static/           index.html, app.js, styles.css
data/demo/     course, syllabus, notes, learners, quiz marks, recorded class
tests/         offline tests, including a fake model for the send-back loop
```

- **Fast Track** is a React 19 + Vite + Tailwind app in `web/`, built to `web/dist` and served by FastAPI at `/fast-track`. The 3D school and tower use three.js.

## Tests

```sh
pip install -r requirements.txt
python -m pytest -q
```

The tests run offline. They cover the parsers and the Examiner, run the whole demo story end to end, check that re-planning keeps taught lessons in place, and check that the settings API never returns a saved key. A fake model slips an unsupported claim into a lesson to prove the Examiner sends it back.

## Privacy

Learner data stays in the school's own SQLite file. Transcripts are read for participation and checked statements only. Tests go to learners only after the teacher approves them.
