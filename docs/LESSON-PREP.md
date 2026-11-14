# Lesson prep (dev note 30)

**View plan** on the facilitator page opens `#/class/prep` (or `#/class/prep/<lessonId>` for a later
lesson). It gets the next lesson ready in one place. Code: `app/prep.py` (API) and
`web/src/pages/LessonPrep.tsx` + `PrepDeck.tsx` (page), with shapes in `web/src/lib/prep.ts`.

## What is on the page

1. **Road to the exam.** Every lesson left, grouped by chapter, on the dates the timetable really
   gives it (lessons that no longer fit sit after the exam flag). Click a chapter, or use the arrow
   keys, for its sections, lessons and how much of it the class transcripts reached. Drag or scroll
   sideways; zoom with − and +. "Prep this" or "Open deck" on a later lesson opens its own deck.
2. **Last class.** The latest recorded class: register, length, who led it, participation labels.
   The picture is the Meet recording's thumbnail (Google Drive) when the class was recorded and the
   token can read Drive; otherwise a class card drawn from the register and transcript.
3. **What the class covered.** Each transcript line is matched to the passage of the notes it
   teaches, in code. The map shows each section of the chapter as covered, started or not reached,
   where the class got to, and your recorded stop point. If they differ you can use the transcript's
   stop point. *On the schedule* turns that pace into a projection: passages per class, classes
   needed for the rest of the notes, and the projected finish against the exam.
4. **Lesson deck.** The Examiner-checked plan as slides: title, last-class recap, anything to put
   right from last class, objectives, one slide per key idea, worked example, activity, check
   questions (answers on demand), gaps, sources. Flip with the arrows or ← →. Hover a citation and its
   source lights up beside the slide (the Ask the Commission layout). Slides taught before the stop
   point start cut. You can cut or restore slides and lines, move slides, add a slide from any
   passage of the chapter, add an image, write your own notes, approve the plan, and **Print the
   bundle**: a cover sheet, one landscape page per slide with its sources underneath, then every
   source in full and the image credits. "Save as PDF" in the print dialog gives a file to share.

## How it stays honest

- **Coverage matching** (`match_transcript`): a passage's *distinctive* words are those that are rare
  across the course notes (so "security" doesn't count in a security course). Each transcript line
  votes for the one passage it shares the most rare words with (weighted by rarity); 3 shared words
  touch a passage, 5 cover it. Short lines from the same speaker are also read as a pair. Section
  names spoken aloud count as starting that section. Results are cached per transcript.
- **Slide text is never typed in.** The deck is built from the plan in code (no model call), each
  sentence keeps its `[P#]`, and a sentence without one takes its paragraph's. Saving a deck accepts
  only order, cuts, images and the facilitator's own notes; the text always comes from the server's
  copy. Added slides lift sentences word for word from the passage and cite it.
- **Images** come only from Wikimedia Commons with a licence. The server downloads a copy (at most
  1280 px, JPEG/PNG/GIF/WebP, 8 MB) into `prep-images/` beside the database, keeps the author,
  licence and page in a sidecar file, and prints the credit under the image. A slide can only point
  at an image this server downloaded. Wikimedia refuses scripted clients without a contact in the
  User-Agent, so the request names this app's own address (`public_url` in Settings, else the
  address the page was opened on).
- **The Meet thumbnail** token is only ever sent to Google hosts.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/ft/{cid}/prep?lesson_id=` | Timeline, last class, coverage, pace, the lesson (next by default) |
| GET / POST / DELETE | `/api/lessons/{id}/deck` | Read the deck / save order, cuts, images, notes / reset |
| POST | `/api/lessons/{id}/deck/slides` | `{pid, after}`: a slide from one passage |
| GET | `/api/lessons/{id}/deck/passages` | Passages of the chapter that can be added |
| GET | `/api/prep/images?q=` | Search Wikimedia Commons (licensed images only) |
| POST | `/api/prep/images` | `{title}`: download one and keep its credit |
| GET | `/api/prep/images/{name}` | Serve a downloaded image |
| GET | `/api/ft/sessions/{sid}/thumbnail` | The Meet recording thumbnail, or 404 |

## What the agents need to make presentations and use web images

Today the deck is assembled in code from the checked plan, and the facilitator picks images by hand.
For the agents to do this themselves:

1. **A Presenter agent** that turns a checked plan into slides: one idea per slide, short lines,
   speaker notes, and for each slide a `visual` request (search words, and whether it wants a photo
   or a diagram). It must keep every `[P#]`, so its output goes back through the **Examiner** with the
   same send-back loop as lesson plans. Rewording for slides is where drift creeps in.
2. **An Illustrator agent** with two tools that already exist as endpoints: `search_images(query)`
   and `save_image(title)`, plus one new one, `attach_image(lesson, slide, src, alt)`. Rules it must
   follow: licensed images only (CC0, CC BY, CC BY-SA, public domain), always keep the credit, never
   hotlink, write alt text, no photos of children, and build search words from the notes only, never
   from learner names or the transcript. Checking that a picture really shows the idea needs a
   **vision-capable model**; DeepSeek chat can't see images, so this step needs a second model
   setting (any OpenAI-compatible vision model) or stays with the facilitator.
3. **Diagrams it draws instead of finds** (a firewall rule flow, a timeline): generated as SVG or
   Mermaid from the passages and cited like text. Often better than a stock photo for exam content.
4. **More image sources** behind the same tool: Openverse (openly licensed, no key for light use)
   and optionally Unsplash or Pexels (free API keys, their own attribution rules). Not Google Images:
   no licence data and its terms forbid scraping.
5. **Export a real deck file.** Print to PDF works now. Next: `.pptx` with `python-pptx` (slides,
   images, citations as footnotes, answers and the facilitator's notes as speaker notes), and Google
   Slides through the Slides API so the deck lands in the school's Drive.
6. **Keys and scopes.** Google token: `meetings.space.readonly` (transcripts), `drive.meet.readonly`
   (recording thumbnails), `presentations` (Slides export). `public_url` set in Settings, so image
   requests carry a real contact. Optional `UNSPLASH_ACCESS_KEY` or `PEXELS_API_KEY`.
7. **Limits on the public demo.** Image downloads are small and Wikimedia-only, but a public site
   should cap them per hour and clean `prep-images/` of files no deck uses.
