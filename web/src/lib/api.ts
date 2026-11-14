/* The same FastAPI JSON endpoints the plain app uses. No backend changes. */

export async function api<T = any>(path: string, opts: { json?: unknown; method?: string } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method };
  if (opts.json !== undefined) {
    init.method = "POST";
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `Request failed (${r.status})`);
  return body as T;
}

export type Course = { id: number; title: string; chapters: number };
export type Pacing = {
  today: string; exam_date: string; total: number; taught: number; lessons_left: number; slots_left: number;
  eta: string | null; shortfall: number; behind_schedule: number; days_to_exam: number; at_risk: string[]; at_risk_ids: number[];
};
export type Learner = {
  id: number; name: string; sample: boolean; xp: number; streak: number; best_streak: number; answered: number; correct: number;
  sure_wrong: number; sure_right: number; levels: number; chapters: Record<string, { top: number; quiz: number | null }>;
};
export type Board = { topics: { id: number; seq: number; title: string }[]; learners: Learner[] };

export async function melsoftCourse(): Promise<Course | null> {
  const cs = await api<Course[]>("/api/ft/courses");
  const picked = Number(store("ftn.course"));                      // the cohort the teacher switched to
  return cs.find((c) => c.id === picked) || cs.find((c) => /melsoft/i.test(c.title)) || cs[0] || null;
}

export function store(k: string, v?: string | null): string | null {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch { /* storage unavailable */ }
  return null;
}

export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "–";

export const splitTitle = (t: string) => {
  const m = /^([A-Z]{2,4}-\d+)\s+([A-Z]{1,3}\d+):\s*(.*)$/.exec(t || "");
  return m ? { mod: m[1], kt: m[2], name: m[3] } : { mod: "Other", kt: "", name: t || "" };
};
