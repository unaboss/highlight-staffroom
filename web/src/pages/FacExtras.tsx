/* Facilitator page sections: track plans with pace actions, class participation from the Meet
   class report, and tests waiting for approval. All read the existing Staffroom APIs. */
import { useEffect, useState } from "react";
import { api, fmtDate, splitTitle } from "@/lib/api";
import { Icon, SpotlightCard, StatusPill, type Status } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/loading";

export type Track = {
  learner_id: number; name: string; sample: boolean; chapters_done: number; chapters_total: number; pace_per_week: number;
  eta: string | null; status: Status; started: string | null;
  ready: { topic_id: number; title: string }[]; catch_up: { topic_id: number; title: string; top: number }[];
  next_topic: { topic_id: number; title: string } | null;
  actions: { id: number; kind: string; status: string; detail: any; created_at: string }[];
};
export type Summary = {
  today: string; exam_date: string;
  coverage: { passages_total: number; passages_covered: number; pct: number; chapters_total: number; chapters_covered: number };
  stopped: null | { lesson_id: number; title: string; chapter: string; section: string | null; finished: boolean; date: string | null };
  next: null | { lesson_id: number; title: string; chapter: string; continues_from: string | null; sections: string[]; approved: boolean; approved_at: string | null };
  tracks: Track[];
};

const short = (t: string) => { const s = splitTitle(t); return s.kt ? `${s.mod} ${s.kt}` : t; };
const addDays = (iso: string, d: number) => { const x = new Date(iso + "T00:00:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const statusWord: Record<Status, string> = { ok: "on track", risk: "at risk", late: "behind" };

/** 4 + 5: each learner's pace, ETA, status, ready-to-test topics and a pace-based action. */
export function TrackPlans({ cid, data, reload }: { cid: number; data: Summary; reload: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const queue = async (t: Track, kind: "catch_up" | "release_early", detail: any) => {
    setBusy(t.learner_id);
    try { await api(`/api/ft/${cid}/actions`, { json: { learner_id: t.learner_id, kind, detail } }); reload(); } finally { setBusy(null); }
  };
  if (!data.tracks.length) return <div className="glass p-5 text-pink-200/75">No learners yet.</div>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {data.tracks.map((t) => {
        const pending = t.actions.find((a) => a.status === "Pending approval");
        const behind = t.status !== "ok";
        const due = data.today && addDays(data.today, 14) < data.exam_date ? addDays(data.today, 14) : data.exam_date;
        const locked = t.chapters_total - t.ready.length;
        return (
          <SpotlightCard key={t.learner_id} className="grid gap-3 p-[18px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2"><a href={`#/learners/${t.learner_id}`} className="truncate font-bold hover:text-pink-300 hover:underline">{t.name.replace(" (sample)", "")}</a>
                {t.sample && <span className="rounded-full border border-pink-300/20 px-1.5 text-[11px] text-pink-200/70">sample</span>}</div>
              <StatusPill s={t.status} label={false} /><span className="sr-only">{statusWord[t.status]}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat v={t.pace_per_week ? `${t.pace_per_week}` : "–"} l="chapters / week" />
              <Stat v={`${t.chapters_done}/${t.chapters_total}`} l="chapters done" />
              <Stat v={t.eta ? fmtDate(t.eta) : "no pace yet"} l={`ETA · ${statusWord[t.status]}`} />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-pink-200/70">Ready to test <span className="font-normal">({t.ready.length} unlocked · {locked} locked until covered)</span></div>
              <div className="flex flex-wrap gap-1.5">
                {t.ready.slice(0, 6).map((r) => <span key={r.topic_id} title={r.title} className="inline-flex items-center gap-1 rounded-full border border-pink-300/40 bg-pink-300/10 px-2 py-0.5 text-xs">{Icon.check}{short(r.title)}</span>)}
                {t.ready.length > 6 && <span className="rounded-full border border-pink-300/20 px-2 py-0.5 text-xs text-pink-200/70">+{t.ready.length - 6} more</span>}
                {!t.ready.length && <span className="text-xs text-pink-200/60">Nothing yet: topics unlock once covered in class or in Fast Track.</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-pink-300/10 pt-3 text-sm">
              {pending ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-pink-300/40 px-2.5 py-1 text-xs font-semibold text-pink-100">
                  {Icon.clock} {pending.kind === "catch_up" ? "Catch-up queued" : "Early release queued"} · pending teacher approval</span>
              ) : behind ? (
                <>
                  <span className="min-w-0 text-pink-200/80">Catch-up: {t.catch_up.length ? t.catch_up.map((c) => short(c.title)).join(", ") : "start the first chapter"} · due {fmtDate(due)}</span>
                  <button disabled={busy === t.learner_id} onClick={() => queue(t, "catch_up", { topics: t.catch_up.map((c) => c.topic_id), due })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-pink-300/30 px-3 py-1.5 text-xs font-semibold hover:border-pink-300/60 disabled:opacity-60">{busy === t.learner_id && <Spinner className="size-3.5" />}Queue catch-up</button>
                </>
              ) : (
                <>
                  <span className="min-w-0 text-pink-200/80">Ahead: release {t.next_topic ? short(t.next_topic.title) : "the next assignment"} early</span>
                  <button disabled={busy === t.learner_id} onClick={() => queue(t, "release_early", { topic: t.next_topic?.topic_id })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-pink-300/30 px-3 py-1.5 text-xs font-semibold hover:border-pink-300/60 disabled:opacity-60">{busy === t.learner_id && <Spinner className="size-3.5" />}Queue early release</button>
                </>
              )}
            </div>
          </SpotlightCard>
        );
      })}
    </div>
  );
}
const Stat = ({ v, l }: { v: string; l: string }) => (
  <div className="rounded-xl border border-pink-300/10 bg-white/[.03] px-2 py-2"><b className="block font-mono text-[15px]">{v}</b><span className="text-[11px] text-pink-200/65">{l}</span></div>
);

/** 6a: who took part in the latest class, from the Meet transcript report. */
export function Participation({ sessions }: { sessions: { id: number; has_report: number; held_on: string; lesson: string; source?: string }[] }) {
  const latest = sessions.find((s) => s.has_report);
  const [rep, setRep] = useState<any>(null);
  useEffect(() => { if (latest) api(`/api/sessions/${latest.id}`).then(setRep).catch(() => setRep(null)); }, [latest?.id]);
  if (!latest) return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 p-5">
      <p className="text-pink-200/75">No class read yet. Upload a Google Meet transcript (or pull it from Meet) and the Class Observer scores who took part, with the transcript lines as evidence.</p>
      <a href="/staffroom#class" className="rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold hover:border-pink-300/60">Read a class in Staffroom</a>
    </div>
  );
  const learners = rep?.report?.learners || [];
  return (
    <div className="glass p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-pink-200/75">
        <span className="flex flex-wrap items-center gap-2">{/sample/i.test(latest.source || "") && <span className="rounded-full border border-pink-300/30 px-2 py-0.5 text-[11px] font-semibold text-pink-200">sample class</span>}{latest.lesson} · {fmtDate(latest.held_on)} · {rep?.report?.class_minutes ?? "–"} min</span>
        <a href="/staffroom#class" className="text-pink-300 underline-offset-4 hover:underline">Full class report</a>
      </div>
      <div className="grid gap-2">
        {learners.map((l: any) => (
          <div key={l.learner_id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-pink-300/10 pt-2 first:border-t-0 first:pt-0">
            <div className="min-w-0"><b>{l.name}</b> <span className="text-sm text-pink-200/70">· {l.label} · {l.why}</span></div>
            <b className="font-mono">{l.score}</b>
            {(l.evidence || []).slice(0, 2).map((e: any, i: number) => (
              <p key={i} className="col-span-2 truncate border-l-2 border-pink-400/50 pl-2 text-[13px] text-pink-100/75">{typeof e === "string" ? e : e.text}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 6b: personal tests drafted by the agents, released only when the teacher approves. */
export function TestsWaiting({ tests, reload }: { tests: any[]; reload: () => void }) {
  const waiting = tests.filter((t) => t.status === "Needs approval");
  const [busy, setBusy] = useState<number | null>(null);
  if (!waiting.length) return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 p-5">
      <p className="text-pink-200/75">No tests waiting. Personal tests are drafted from each learner's weak topics, checked against the notes, and stay hidden until you approve them.</p>
      <a href="/staffroom#tests" className="rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold hover:border-pink-300/60">All tests in Staffroom</a>
    </div>
  );
  return (
    <div className="grid gap-2.5">
      {waiting.map((t) => (
        <SpotlightCard key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0"><b>{t.title}</b><div className="text-sm text-pink-200/75">{t.name} · {t.questions} questions · {t.verdict || "checked"}</div></div>
          <div className="flex gap-2">
            <a href={`/staffroom#tests/${t.id}`} className={cn("rounded-full border border-pink-300/25 px-3.5 py-1.5 text-sm font-semibold")}>Review</a>
            <button disabled={busy === t.id} onClick={async () => { setBusy(t.id); try { await api(`/api/tests/${t.id}/approve`, { method: "POST" }); reload(); } finally { setBusy(null); } }}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{busy === t.id && <Spinner className="size-3.5" />}Approve and release</button>
          </div>
        </SpotlightCard>
      ))}
    </div>
  );
}

/** The facilitator page keeps only a glance: counts by status and each learner as a chip that
    opens their own plan page. The full plans live on #/learners. */
export function TrackSummary({ data }: { data: Summary }) {
  const n = (s: Status) => data.tracks.filter((t) => t.status === s).length;
  const tiles: [Status, string][] = [["ok", "on track"], ["risk", "at risk"], ["late", "behind"]];
  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex gap-4">
        {tiles.map(([s, l]) => (
          <a key={s} href="#/learners" className="text-center hover:text-pink-200"><b className="block font-mono text-[22px] leading-none">{n(s)}</b><span className="text-label text-pink-200/70">{l}</span></a>
        ))}
      </div>
      <a href="#/learners" className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-4 py-2 text-sm font-semibold text-white">
        View student plans{Icon.arrow}</a>
    </div>
  );
}
