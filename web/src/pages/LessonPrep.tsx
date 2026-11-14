/* View plan (dev notes 30, 39): the notes for the next chapter as a reader you can page back through,
   the last class and what it covered (with Review classes), and the next lesson as a cited slide deck.
   The road to the exam, the pace lines and the Counsellor's plan live on Show progress (#/class/progress). */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, fmtDate, melsoftCourse, splitTitle } from "@/lib/api";
import { Icon, NumberTicker } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { RecordProgress } from "@/pages/Facilitator";
import PrepDeck from "@/pages/PrepDeck";
import { CoverageMap, Head, LastClassCard, Section, rise } from "@/components/prep-parts";
import { LoadError, PageLoader, SkeletonCard } from "@/components/ui/loading";
import { tidy, type Coverage, type DeckRes, type Notes, type Prep } from "@/lib/prep";

export default function LessonPrep({ lessonId }: { lessonId?: number }) {
  const [cid, setCid] = useState<number | null>(null);
  const [prep, setPrep] = useState<Prep | null>(null);
  const [deck, setDeck] = useState<DeckRes | null>(null);
  const [err, setErr] = useState("");

  const load = async () => {
    const c = cid ?? (await melsoftCourse())?.id;
    if (!c) throw new Error("No course with notes yet");
    setCid(c);
    const p = await api<Prep>(`/api/ft/${c}/prep${lessonId ? `?lesson_id=${lessonId}` : ""}`);
    setPrep(p);
    setDeck(p.lesson ? await api<DeckRes>(`/api/lessons/${p.lesson.id}/deck`) : null);
  };
  const retry = () => { setErr(""); load().catch((e) => setErr(String(e.message || e))); };
  useEffect(() => { window.scrollTo(0, 0); retry(); }, [lessonId]);

  if (err) return <LoadError message={err} onRetry={retry} />;
  if (!prep || !cid) return <PageLoader label="Getting the next lesson ready" />;

  const { lesson, timeline: tl, last_class: last, coverage: cov, pace } = prep;
  const ch = splitTitle(lesson?.chapter || lesson?.title || "");
  const lessonName = ch.name || lesson?.title || "Every lesson is taught";
  const recordedStop = prep.summary.stopped && !prep.summary.stopped.finished ? prep.summary.stopped.section : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href="#/class" className="inline-flex items-center gap-2 text-sm font-semibold text-pink-300 hover:underline">
          <span className="rotate-180">{Icon.arrow}</span>Back to the class</a>
        <a href="#/class/progress" className="inline-flex items-center gap-2 text-sm font-semibold text-pink-300 hover:underline">Show progress{Icon.arrow}</a>
      </div>

      {/* 1. Hero: the lesson being prepared */}
      <motion.section {...rise(0)} className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Lesson plan{lesson && !lesson.is_next ? " · a later lesson" : ""}</div>
          <h1 className="mt-2 text-[clamp(32px,4.4vw,56px)] font-bold leading-[1.05] tracking-[-0.03em] [text-wrap:balance]">{lessonName}</h1>
          {lesson && <p className="mt-3 text-body text-pink-200/80">
            {ch.mod} {ch.kt} · {fmtDate(lesson.date)} · {lesson.minutes || 45} min
            {lesson.continues_from ? <> · picks up from <b className="text-pink-100">{tidy(lesson.continues_from)}</b></> : null}
          </p>}
          {lesson && !lesson.is_next && <a href="#/class/prep" className="mt-2 inline-block text-sm text-pink-300 hover:underline">Go to the next lesson instead</a>}
        </div>
      </motion.section>

      {/* 2. The next lesson as a deck, right under the title (dev notes 48, 56) */}
      <section className="mt-5">
        {cov && lesson && <MissedLastClass cov={cov} deck={deck?.deck || null} />}
        {lesson ? <PrepDeck lesson={lesson} res={deck} prep={prep} onReload={() => load()} /> : <div className="glass p-5 text-pink-200/75">Every lesson is taught.</div>}
      </section>



      {/* 3. The last class, and what its transcript covered */}
      <section className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-5 md:mt-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <motion.div {...rise(2)} className="min-w-0">
          <Head title="Last class" lede={last ? `${fmtDate(last.held_on)} · ${splitTitle(last.chapter).mod} ${splitTitle(last.chapter).kt}` : "No class recorded yet"} />
          <LastClassCard last={last} />
        </motion.div>
        <motion.div {...rise(3)} className="flex min-w-0 flex-col">
          <Head title="What the class covered" lede={cov ? `The transcript matched against the notes: ${cov.lines_matched} of ${cov.lines_total} lines taught something from them.` : "Pull a class from Google Meet to see this."} />
          {/* cropped to the Last class card's height on wide screens; scroll inside for the rest (dev note 62) */}
          <div className="max-h-[62svh] overflow-y-auto overscroll-contain rounded-2xl">
            <CoverageMap cov={cov} pace={pace} recordedStop={recordedStop} lessonIsNext={!!lesson?.is_next}
              nextLessonId={prep.summary.next?.lesson_id ?? null} onChanged={() => load()} />
          </div>
        </motion.div>
      </section>


      {lesson?.is_next && prep.summary.next && (
        <Section i={5} title="After class" lede="Record where the class stopped, and the next lesson picks up from there.">
          <RecordProgress next={prep.summary.next} onChanged={() => load()} />
        </Section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ the notes reader */

/** One section of the notes at a time. Back and forward step through sections, crossing into the
    chapter before or after; the chapter list jumps anywhere. Opens where the class stopped. */
function NotesReader({ cid, topicId }: { cid: number; topicId: number | null }) {
  const [notes, setNotes] = useState<Notes | null>(null);
  const [at, setAt] = useState(0);
  const [err, setErr] = useState("");

  const open = (tid: number | null, where: "start" | "end" | "stop") => {
    api<Notes>(`/api/ft/${cid}/notes${tid ? `?topic_id=${tid}` : ""}`).then((n) => {
      setNotes(n);
      const stop = n.continues_from ? n.sections.findIndex((s) => s.name === n.continues_from) : -1;
      setAt(where === "end" ? n.sections.length - 1 : where === "stop" && stop >= 0 ? stop : 0);
      setErr("");
    }).catch((e) => setErr(String(e.message || e)));
  };
  useEffect(() => { open(topicId, "stop"); }, [cid, topicId]);

  if (err) return <LoadError message={err} onRetry={() => open(notes?.chapter.topic_id ?? topicId, "stop")} />;
  if (!notes) return <SkeletonCard lines={6} label="Opening the notes" />;
  const sec = notes.sections[at];
  const ch = splitTitle(notes.chapter.title);
  const back = () => { if (at > 0) setAt(at - 1); else if (notes.prev) open(notes.prev, "end"); };
  const fwd = () => { if (at < notes.sections.length - 1) setAt(at + 1); else if (notes.next) open(notes.next, "start"); };
  const canBack = at > 0 || !!notes.prev, canFwd = at < notes.sections.length - 1 || !!notes.next;

  return (
    <div className="glass grid grid-cols-[minmax(0,1fr)] overflow-hidden md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <nav aria-label="Chapters of the notes" className="max-h-[260px] overflow-y-auto border-b border-pink-300/10 p-3 md:max-h-[560px] md:border-b-0 md:border-r">
        <ol className="grid gap-1">
          {notes.chapters.map((c) => {
            const s = splitTitle(c.title), on = c.topic_id === notes.chapter.topic_id;
            return (
              <li key={c.topic_id}>
                <button onClick={() => { if (!on) open(c.topic_id, c.topic_id === notes.next_topic_id ? "stop" : "start"); }}
                  aria-current={on ? "true" : undefined}
                  className={cn("w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] leading-snug", on ? "bg-pink-500/15 text-pink-50" : "text-pink-200/75 hover:bg-white/5")}>
                  <span className="font-mono text-[11.5px] text-pink-300/80">{s.kt || s.mod}</span> {s.name}
                  {c.topic_id === notes.next_topic_id && <span className="ml-1 rounded-full bg-pink-500 px-1.5 py-px text-[10.5px] font-semibold text-white">next</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="min-w-0 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-pink-200/75">
          <span className="font-semibold">{ch.mod} {ch.kt} · {ch.name}</span>
          <span className="ml-auto font-mono">section {at + 1} of {notes.sections.length}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Sections of this chapter">
          {notes.sections.map((s, k) => (
            <button key={s.name} aria-pressed={k === at} onClick={() => setAt(k)}
              className={cn("rounded-full border px-2.5 py-1 text-[12px]", k === at ? "border-pink-300/60 bg-pink-500/15 text-pink-50" : "border-pink-300/15 text-pink-200/75 hover:border-pink-300/40")}>
              {tidy(s.name)}{s.name === notes.continues_from && <span className="ml-1 text-pink-300">· class stopped here</span>}
            </button>
          ))}
        </div>
        {sec && (
          <article className="mt-5">
            <h3 className="text-h3">{tidy(sec.name)}</h3>
            <div className="mt-3 grid gap-3 text-[15px] leading-relaxed text-pink-50/90">
              {sec.passages.map((p) => (
                <p key={p.id} className="max-w-[72ch]">{p.text}
                  <span className="ml-2 whitespace-nowrap text-[11.5px] text-pink-200/50">{p.doc}{p.page ? `, p. ${p.page}` : ""}</span></p>
              ))}
            </div>
          </article>
        )}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-pink-300/10 pt-4">
          <button disabled={!canBack} onClick={back} className="inline-flex items-center gap-2 rounded-full border border-pink-300/30 px-3.5 py-1.5 text-sm font-semibold text-pink-100 hover:border-pink-300/60 disabled:opacity-30">
            <span className="rotate-180">{Icon.arrow}</span>{at > 0 ? "Previous section" : "Previous chapter"}</button>
          <button disabled={!canFwd} onClick={fwd} className="inline-flex items-center gap-2 rounded-full border border-pink-300/30 px-3.5 py-1.5 text-sm font-semibold text-pink-100 hover:border-pink-300/60 disabled:opacity-30">
            {at < notes.sections.length - 1 ? "Next section" : "Next chapter"}{Icon.arrow}</button>
        </div>
      </div>
    </div>
  );
}

/** What the last class meant to cover but didn't, ticked off as the next plan picks it up. */
function MissedLastClass({ cov, deck }: { cov: Coverage; deck: { sources: { section: string }[] } | null }) {
  const upto = cov.sections.findIndex((x) => x.name === cov.furthest);
  const missed = cov.sections.filter((x, i) => i <= upto && x.state !== "covered");
  if (!missed.length) return null;
  const norm = (t: string) => tidy(t).toLowerCase().replace(/^kt\d+\s*/, "");
  const inPlan = (name: string) => !!deck?.sources.some((src) => norm(src.section).includes(norm(name)) || norm(name).includes(norm(src.section)));
  const done = missed.filter((m) => inPlan(m.name)).length;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-pink-300/20 bg-pink-500/[.06] px-3.5 py-2.5">
      <b className="mr-1 text-sm">Missed last class</b>
      {missed.map((m) => {
        const ok = inPlan(m.name);
        return <span key={m.name} title={ok ? "Covered in this plan" : "Not in this plan yet"}
          className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
            ok ? "border-pink-300/60 bg-pink-300/15 text-pink-50" : "border-dashed border-pink-300/40 text-pink-200/80")}>
          {ok ? Icon.check : <span aria-hidden="true">○</span>}{tidy(m.name)}</span>;
      })}
      <span className="ml-auto text-xs text-pink-200/70">{done}/{missed.length} in this plan · catch-up first, then new</span>
    </div>
  );
}
