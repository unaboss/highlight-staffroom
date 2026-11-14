/* Review classes (dev note 39): opened from "Review classes" on the last class card. Every recorded class
   in a scrolling list; pick one for its transcript, the note passages it taught (P1, P2… in chapter order),
   how many learners are caught up on its chapter, and where it sits on the road to the exam. */
import { useEffect, useState } from "react";
import { api, fmtDate, melsoftCourse, splitTitle } from "@/lib/api";
import { Icon } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { Head, PrepTimeline, SOURCE_WORD } from "@/components/prep-parts";
import { LoadError, PageLoader, SkeletonCard } from "@/components/ui/loading";
import { srcHue, tidy, type ClassDetail, type ClassRow, type Timeline } from "@/lib/prep";

export default function ReviewClasses({ sessionId }: { sessionId?: number }) {
  const [cid, setCid] = useState<number | null>(null);
  const [list, setList] = useState<{ classes: ClassRow[]; timeline: Timeline } | null>(null);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    const c = cid ?? (await melsoftCourse())?.id;
    if (!c) throw new Error("No course with notes yet");
    setCid(c);
    setList(await api(`/api/ft/${c}/classes`));
  };
  const retry = () => { load().catch((e) => setErr(String(e.message || e))); };
  useEffect(() => { window.scrollTo(0, 0); retry(); }, []);

  if (err) return <LoadError message={err} onRetry={retry} />;
  if (!list || !cid) return <PageLoader label="Gathering your classes" />;
  const sel = list.classes.find((c) => c.session_id === sessionId) ?? list.classes[0];

  return (
    <>
      <a href="#/class/prep" className="inline-flex items-center gap-2 text-sm font-semibold text-pink-300 hover:underline">
        <span className="rotate-180">{Icon.arrow}</span>Back to View plan</a>
      <div className="mt-4">
        <div className="eyebrow">Review classes</div>
        <h1 className="mt-2 text-[clamp(30px,4vw,48px)] font-bold leading-[1.05] tracking-[-0.03em]">Your classes</h1>
        <p className="mt-2 text-body text-pink-200/80">{list.classes.length} recorded class{list.classes.length === 1 ? "" : "es"}. Pick one to read its transcript and see what it covered.</p>
      </div>

      {!list.classes.length ? (
        <div className="glass mt-8 p-5 text-pink-200/80">No class has been recorded yet. Pull a class from Google Meet in <a href="/fast-track/settings" className="text-pink-300 underline">Settings</a> and it shows up here.</div>
      ) : (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <nav aria-label="Recorded classes" className="glass max-h-[340px] overflow-y-auto p-2 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)]">
            <ol className="grid gap-1.5">
              {list.classes.map((c) => {
                const ch = splitTitle(c.chapter), on = c.session_id === sel?.session_id;
                return (
                  <li key={c.session_id}>
                    <a href={`#/class/classes/${c.session_id}`} aria-current={on ? "true" : undefined}
                      className={cn("block rounded-xl border px-3 py-2.5", on ? "border-pink-300/50 bg-pink-500/12" : "border-transparent hover:bg-white/5")}>
                      <div className="flex items-baseline justify-between gap-2">
                        <b className="font-mono text-[13px]">{fmtDate(c.held_on)}</b>
                        <span className="font-mono text-[12px] text-pink-200/75">{c.pct}% of chapter</span>
                      </div>
                      <div className="mt-0.5 truncate text-[13.5px]">{ch.kt ? `${ch.kt} · ` : ""}{ch.name}</div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-pink-300" style={{ width: `${c.pct}%` }} /></div>
                      <div className="mt-1 text-[11.5px] text-pink-200/60">{c.present} present · {c.minutes} min · {SOURCE_WORD[c.source]}</div>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
          {sel && <ClassView key={sel.session_id} cid={cid} row={sel} tl={list.timeline} />}
        </div>
      )}
    </>
  );
}

function ClassView({ cid, row, tl }: { cid: number; row: ClassRow; tl: Timeline }) {
  const [d, setD] = useState<ClassDetail | null>(null);
  const [err, setErr] = useState("");
  const load = () => { setErr(""); api<ClassDetail>(`/api/ft/${cid}/classes/${row.session_id}`).then(setD).catch((e) => setErr(String(e.message || e))); };
  useEffect(load, [row.session_id]);
  const ch = splitTitle(row.chapter);

  return (
    <div className="min-w-0">
      <Head title={`${fmtDate(row.held_on)} · ${ch.name}`} lede={`${ch.mod} ${ch.kt} · ${row.lesson}`} />
      {err ? <LoadError message={err} onRetry={load} /> : !d ? <SkeletonCard lines={8} label="Opening the class" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fig v={`${d.caught_up.count} of ${d.caught_up.of}`} k="learners caught up on this chapter" />
            <Fig v={`${d.class.present} of ${d.class.register}`} k="present in class" />
            <Fig v={`${d.coverage.pct}%`} k="of the chapter reached" />
            <Fig v={`${d.coverage.lines_matched} of ${d.coverage.lines_total}`} k="lines taught the notes" />
          </div>
          <p className="-mt-2 text-[12px] text-pink-200/60">Caught up: passed at least {d.caught_up.levels} levels of this chapter's Fast Track ladder, counted today.</p>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <section className="glass min-w-0 p-4 md:p-5" aria-label="Transcript">
              <h3 className="text-h3">Transcript</h3>
              <ol className="mt-3 grid max-h-[560px] gap-2 overflow-y-auto pr-1">
                {d.transcript.map((t) => (
                  <li key={t.line} className={cn("rounded-lg px-3 py-2 text-[14px]", t.cites.length ? "border-l-[3px] border-pink-400 bg-white/[.04]" : "bg-transparent")}>
                    <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-pink-200/70">
                      <span className="rounded bg-white/10 px-1.5 font-mono font-bold text-pink-100">{t.at}</span>
                      <b className="text-pink-100">{t.speaker}</b>
                      {t.cites.map((n) => <span key={n} className="rounded px-1.5 font-mono text-[11px] font-bold text-white" style={{ background: srcHue(n) }}>P{n}</span>)}
                    </div>
                    <p className="mt-0.5 text-pink-50/90">{t.text}</p>
                  </li>
                ))}
              </ol>
            </section>
            <section className="glass min-w-0 p-4 md:p-5" aria-label="What was covered">
              <h3 className="text-h3">What was covered</h3>
              <p className="mt-1 text-[13px] text-pink-200/70">The chapter's notes in order. Highlighted passages were taught by a line of the transcript.</p>
              <ol className="mt-3 grid gap-2">
                {d.notes.map((p, k) => (
                  <li key={p.pid}>
                    {(k === 0 || d.notes[k - 1].section !== p.section) && <div className="mb-1 mt-2 text-label font-semibold text-pink-200/80">{tidy(p.section)}</div>}
                    <div className={cn("rounded-lg border px-3 py-2 text-[13.5px]", p.taught ? "border-pink-300/40 bg-pink-500/[.08]" : "border-pink-300/10 text-pink-200/60")}>
                      <span className="mr-2 rounded px-1.5 font-mono text-[11px] font-bold text-white" style={{ background: p.taught ? srcHue(p.n) : "#3f3f46" }}>P{p.n}</span>
                      {p.text.length > 220 ? p.text.slice(0, 218).replace(/\s+\S*$/, "") + "…" : p.text}
                      {!p.taught && <span className="ml-1 text-[11.5px]">(not reached)</span>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      )}
      <div className="mt-8">
        <Head title="Where this class fits" lede="The class's lesson is outlined on the road to the exam." />
        <PrepTimeline tl={tl} current={row.lesson_id} />
      </div>
    </div>
  );
}

function Fig({ v, k }: { v: string; k: string }) {
  return <div className="glass min-w-0 p-3.5"><b className="block font-mono text-[20px] font-bold tracking-tight">{v}</b><span className="block text-[12px] text-pink-200/75">{k}</span></div>;
}
