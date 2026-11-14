/* Lesson prep (dev note 30): shapes returned by /api/ft/{cid}/prep and /api/lessons/{id}/deck. */

export type LessonState = "taught" | "partial" | "next" | "planned" | "after_exam";
export type TLesson = {
  id: number; seq: number; title: string; topic_id: number; part: number; parts: number; date: string | null;
  planned_date: string | null; state: LessonState; has_plan: boolean; verdict: string | null;
};
export type TChapter = {
  topic_id: number; title: string; mod: string; kt: string; name: string; passages: number; lessons: number[];
  start: string | null; end: string | null; state: LessonState; transcript_pct: number; sections: string[];
};
export type Timeline = {
  today: string; exam_date: string; lessons: TLesson[]; chapters: TChapter[]; lessons_left: number;
  before_exam: number; after_exam: number; chapters_left: number; eta: string | null; days_to_exam: number;
};
export type LastClass = {
  session_id: number; lesson_id: number; lesson: string; chapter: string; held_on: string | null;
  source: "meet" | "meet_demo" | "sample" | "upload"; minutes: number; people: { name: string; minutes: number }[];
  present: number; register: number; lines: number; speakers: number; teacher: string; caption: string;
  participation: Record<string, number>; thumbnail: string | null;
};
export type CovSection = { name: string; passages: number; matched: number; state: "covered" | "touched" | "not_reached"; named_at: number | null; lines: number[] };
export type CovCell = { pid: number; section: string; level: "covered" | "touched" | null; line?: number; hits?: number };
export type Evidence = { line: number; at: string; speaker: string; text: string; pid: number; section: string; level: string; where: string };
export type Coverage = {
  session_id: number; lesson_id: number; held_on: string | null; chapter: string; passages_total: number; upto: number;
  pct: number; matched: number; sections: CovSection[]; furthest: string | null;
  ended_on: { section: string; line: number; at: string } | null; cells: CovCell[]; lines_total: number;
  lines_matched: number; evidence: Evidence[];
};
export type Pace = {
  advanced: number; plan_avg: number; remaining: number; classes_needed: number | null; slots_left: number;
  finish: string | null; exam_date: string; fits: boolean;
};
export type NextInfo = {
  lesson_id: number; title: string; chapter: string; continues_from: string | null; sections: string[];
  approved: boolean; approved_at: string | null;
} | null;
export type PrepLesson = {
  id: number; seq: number; title: string; topic_id: number; planned_date: string | null; minutes: number; status: string;
  verdict: string | null; examiner_rounds: number; has_plan: boolean; chapter: string; is_next: boolean;
  continues_from: string | null; approved: boolean; approved_at: string | null; sections: string[]; date: string | null;
};
export type Prep = {
  course: { id: number; title: string; subject: string };
  summary: { stopped: { lesson_id: number; chapter: string; section: string | null; finished: boolean; date: string | null } | null; next: NextInfo; coverage: { pct: number } };
  timeline: Timeline; last_class: LastClass | null; coverage: Coverage | null; pace: Pace | null; lesson: PrepLesson | null;
};

export type Img = { src: string; title: string; license: string; artist: string; page: string; credit: string };
export type Bullet = { id: string; text: string; answer?: string; cut: boolean };
export type Slide = {
  id: string; kind: "title" | "recap" | "fix" | "objectives" | "idea" | "example" | "activity" | "check" | "gaps" | "added" | "sources";
  title: string; subtitle: string; bullets: Bullet[]; cut: boolean; cut_reason?: string; image: Img | null; notes: string;
};
export type Source = { n: number; pid: number | null; where: string; section: string; text: string };
export type TLine = { n: number; line: number; at: string; speaker: string; text: string };
export type Deck = {
  lesson_id: number; title: string; chapter: string; verdict: string | null; examiner_rounds: number; minutes: number;
  stop: string | null; stop_from: "recorded" | "transcript" | null; session_id: number | null; class_date: string | null;
  sources: Source[]; transcript: TLine[]; slides: Slide[];
};
export type DeckRes = { deck: Deck | null; edited: boolean; outdated: boolean; updated_at?: string };

export const MOD_HUE = ["#ffd1e6", "#fff0f7", "#ff9ccb", "#ff3d9a", "#e6197f", "#c00d68", "#8f0a52", "#5c0838"];
export const modHue = (m: string) => MOD_HUE[(parseInt(m.replace(/\D/g, ""), 10) || 1) % MOD_HUE.length];
/** Dark text on the light module hues, light text on the deep ones. */
export const inkOn = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1a0d14" : "#fff0f7";
};

/** One colour per cited passage, Ask the Commission style: the chip and its quote card share it. */
const SRC_HUES = ["#e6197f", "#9333ea", "#0e7490", "#b45309", "#be123c", "#4d7c0f", "#1d4ed8", "#a21caf", "#c2410c", "#047857"];
export const srcHue = (n: number) => SRC_HUES[(n - 1) % SRC_HUES.length];

export type Cite = { kind: "P" | "T"; n: number };
/** Split text into plain runs and [P#] / [T#] markers. */
export function citeParts(text: string): (string | Cite)[] {
  return (text || "").split(/(\[[PT]\d+\])/g).filter(Boolean).map((p) => {
    const m = /^\[([PT])(\d+)\]$/.exec(p);
    return m ? { kind: m[1] as "P" | "T", n: Number(m[2]) } : p;
  });
}
export const citesOf = (text: string) => citeParts(text).filter((p): p is Cite => typeof p !== "string");
/** Notes sometimes leave a bracket open in a heading ("Firewalls (e.g. packet filters"). */
export const tidy = (t: string) => t + ")".repeat(Math.max(0, (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length));
export const plain = (text: string) => (text || "").replace(/\s*\[[PT]\d+\]/g, "").replace(/\s+([.,;:])/g, "$1").trim();

/** Every citation still on the kept slides, in order of first use. */
export function usedCites(slides: Slide[]): { P: number[]; T: number[] } {
  const P: number[] = [], T: number[] = [];
  for (const s of slides) {
    if (s.cut) continue;
    for (const b of s.bullets) {
      if (b.cut) continue;
      for (const c of [...citesOf(b.text), ...citesOf(b.answer || "")]) {
        const list = c.kind === "P" ? P : T;
        if (!list.includes(c.n)) list.push(c.n);
      }
    }
  }
  return { P, T };
}

export const KIND_LABEL: Record<Slide["kind"], string> = {
  title: "Lesson", recap: "Last class", fix: "Put right", objectives: "Objectives", idea: "Key idea", example: "Worked example",
  activity: "Activity", check: "Check", gaps: "Gaps", added: "From the notes", sources: "Sources",
};

/* Show progress, the notes reader and Review classes (dev note 39). */
export type NotePassage = { id: number; text: string; doc: string; page: number | null };
export type Notes = {
  chapter: { topic_id: number; title: string; passages: number }; sections: { name: string; passages: NotePassage[] }[];
  is_next: boolean; next_topic_id: number | null; continues_from: string | null; prev: number | null; next: number | null;
  chapters: { topic_id: number; title: string; passages: number }[];
};
export type Point = { date: string; pct: number };
export type ProgressFacts = {
  class_pct: number; should_be_pct: number; learner_pct: number | null; passages_left: number; classes_left: number;
  classes_held: number; per_class: number; needed_per_class: number | null; learners: number;
  behind: { name: string; pct: number }[]; weak_topics: string[]; days_to_exam: number | null;
};
export type ProgressLines = {
  start: string; today: string; exam_date: string; total: number; needed: Point[]; class: Point[]; learners: Point[]; facts: ProgressFacts;
};
export type CatchUp = { headline: string; steps: { title: string; detail: string }[]; facts: string; online: boolean; model?: string; notice?: string };
export type ClassRow = {
  session_id: number; lesson_id: number; topic_id: number; held_on: string | null; chapter: string; lesson: string;
  source: LastClass["source"]; minutes: number; present: number; register: number; lines: number; pct: number; furthest: string | null;
};
export type ClassDetail = {
  class: LastClass; topic_id: number; coverage: Coverage & { evidence: (Evidence & { n: number | null })[] };
  transcript: { line: number; at: string; speaker: string; text: string; cites: number[] }[];
  notes: { n: number; pid: number; section: string; text: string; taught: boolean }[];
  caught_up: { count: number; of: number; levels: number };
};
