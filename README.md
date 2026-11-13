# Staffroom

**AI staff for online schools.** Six agents work like the staff of a school. They plan the term against the exam date and write lesson plans from the teacher's own notes. They check every claim before the teacher sees it, read the class recording to see who took part, and draft personal tests. Nothing reaches a learner until the teacher approves it.

Built for **Colleague Zero**, the Melsoft Academy hackathon. The first test site is a cyber security school that teaches on Google Meet and runs exams on Moodle.

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

You need Python 3.10 or newer.

**Windows:** double-click `run.bat`. It opens http://localhost:8000.

**macOS / Linux:**
```sh
./run.sh
```

**By hand:**
```sh
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

**Docker:**
```sh
docker build -t staffroom .
docker run -p 8000:8000 -v staffroom:/data staffroom
```

With no model key it runs in **offline mode**. The staff draft straight from the notes and check with rules in code, so the whole demo works without a network. Add a key in Settings, or in a `.env` file (copy `.env.example`), to use a model.

## Demo script (about 2 minutes)

1. **Home → Run the demo.** This loads the demo course, *Network Security Fundamentals*. The class is two lessons behind, and today's lesson is Firewalls.
2. **Staffroom.** Watch the agents hand off at reading speed. The Librarian finds passages, the Subject Teacher drafts, and the Examiner marks. Then the class recording is read: Thabo and Ayesha are active, Lerato was silent, Sipho left early, and Kagiso was absent. The Examiner catches Sipho saying "firewalls block all viruses". The Counsellor flags three learners, and three tests wait for approval.
3. **Course plan.** The Principal's forecast shows two lessons that won't fit before the exam, with a line drawn at the exam date. Open today's lesson and click a **P1** chip to see the passage. Then type *Firewalls block all viruses* into **Try to trick the Examiner**.
4. **Class report.** Click Sipho to highlight his lines. **Things to revisit** shows his wrong idea next to what the notes actually say.
5. **Tests.** Sipho's test opens with a question about what he said in class. Every memo answer cites the notes. Click **Approve and release**.
6. **Learners.** The mastery heatmap shows the class at a glance.

**Replay the demo** rebuilds only the demo course. Courses you create yourself are never touched.

## Connect your school (Settings)

| Service | What you give it | What Staffroom does |
|---|---|---|
| **Model** | Base URL, model and key for any OpenAI-compatible endpoint. Default: Nemotron Super 49B on Nebius Token Factory | Drafting, revising, search planning, on-topic judgements, and the Examiner's second opinion |
| **ClickUp** | Personal API token (ClickUp → Settings → Apps), then **Set up this course** | Creates a Space with three lists: *Lesson plan*, *Learner follow-ups* and *Tests: needs approval*. Plans, reports and tests become tasks. **Check for approvals** releases a test once its task is closed |
| **Google Meet** | OAuth access token with `meetings.space.readonly` | Pulls the latest class for a meeting code: participant sessions for the register, and transcript entries for the Class Observer. Transcripts must be on in the meeting |
| **Moodle** | Site URL and a web service token | Imports the class list (`core_enrol_get_enrolled_users`) |
| **Notes** | Markdown, text or PDF | The Librarian splits it into passages by chapter, section and page |

You can upload a transcript (`.vtt`) and a register (`.csv` with name, joined, left) on the Class report page instead of using Meet. The demo files are linked at the top of that page.

**New course:** Settings → New course. Write the syllabus one topic per line, like `1. Reconnaissance (90 min) | keywords: OSINT, whois`. With a model, any format works. Then upload your notes.

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

## Tests

```sh
pip install -r requirements.txt
python -m pytest -q
```

The tests run offline. They cover the parsers and the Examiner, run the whole demo story end to end, and check that re-planning keeps taught lessons in place. A fake model slips an unsupported claim into a lesson to prove the Examiner sends it back. The ClickUp and Meet request shapes are checked against a mock transport.

## Privacy

Learner data stays in the school's own SQLite file. Transcripts are read for participation and checked statements only. Tests go to learners only after the teacher approves them.
