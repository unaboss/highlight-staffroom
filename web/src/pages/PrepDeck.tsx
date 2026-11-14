/* The next lesson as a slide deck (dev note 30). Flip through it like a presentation; every line carries
   its [P#] (course notes) or [T#] (class transcript) citation, and the panel beside the slide shows the
   sources, the way Ask the Commission shows its evidence. The facilitator cuts slides or lines, moves
   slides, adds slides from other passages of the chapter and openly licensed images from Wikimedia
   Commons, and prints the whole bundle. Slide text itself is never typed in, so it stays sourced. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, fmtDate, splitTitle } from "@/lib/api";
import { Icon } from "@/components/ui/kit";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { cn } from "@/lib/utils";
import { Handoff } from "@/pages/Facilitator";
import AgentRun from "@/components/AgentRun";
import { KIND_LABEL, citeParts, plain, srcHue, tidy, usedCites, type Deck, type DeckRes, type Img, type Prep, type PrepLesson, type Slide } from "@/lib/prep";

type Hit = { title: string; thumb: string; width: number; height: number; license: string; artist: string; page: string; description: string };
type Candidate = { pid: number; section: string; preview: string; words: number; cited: boolean; has_slide: boolean };

export default function PrepDeck({ lesson, res, prep, onReload }: { lesson: PrepLesson; res: DeckRes | null; prep: Prep; onReload: () => void }) {
  const [deck, setDeck] = useState<Deck | null>(res?.deck ?? null);
  const [idx, setIdx] = useState(0);
  const [hot, setHot] = useState<string | null>(null);
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "error">("");
  const [answers, setAnswers] = useState(false);
  const [modal, setModal] = useState<"" | "image" | "notes">("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [picBusy, setPicBusy] = useState("");      // Add pictures progress   // the live run finished: show "Review lesson plan"     // watch the plan being written, caught and fixed
  const [approving, setApproving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { setDeck(res?.deck ?? null); setIdx((i) => Math.min(i, Math.max(0, (res?.deck?.slides.length ?? 1) - 1))); }, [res]);

  // flip with the arrow keys, unless typing or a dialog is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!deck || modal || document.querySelector("[role=dialog]") || (t && t.closest("input, textarea, select, [contenteditable], [tabindex='0'][aria-label^='Timeline']"))) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); setIdx((i) => Math.min(deck.slides.length - 1, i + 1)); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [deck, modal]);

  const prepare = async () => {
    setBusy(true);
    try {
      const { job_id } = await api<{ job_id: number }>(`/api/lessons/${lesson.id}/prepare`, { method: "POST" });
      for (let i = 0; i < 90; i++) {
        const j = await api<{ status: string }>(`/api/jobs/${job_id}`);
        if (j.status !== "running") break;
        await new Promise((r) => setTimeout(r, 800));
      }
      onReload();
    } finally { setBusy(false); }
  };

  if (live) return (
    <div className="grid gap-3">
      <div className="relative">
        <AgentRun lessonId={lesson.id} autoStart onDone={() => setDrafted(true)} />
        {/* once the plan is written and checked: shade it and offer the review (dev note 55) */}
        {drafted && (
          <div className="absolute inset-0 grid place-items-center rounded-2xl bg-[#0c0b0e]/60 backdrop-blur-[3px]">
            <div className="grid justify-items-center gap-3 text-center">
              <button onClick={() => { setLive(false); setDrafted(false); onReload(); }} autoFocus
                className="rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-8 py-4 text-lg font-bold text-white shadow-[0_18px_50px_-12px_rgba(230,25,127,.85)] hover:brightness-110">
                Review lesson plan</button>
              <span className="text-sm text-pink-100/80">Edit the slides, add from the notes, add pictures, approve.</span>
            </div>
          </div>
        )}
      </div>
      <div><button onClick={() => { setLive(false); setDrafted(false); onReload(); }} className="rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold hover:border-pink-300/60">Back to the deck</button></div>
    </div>
  );
  if (!res) return <div className="glass p-5 text-pink-200/70">Opening the deck…</div>;
  if (!deck) {
    return (
      <div className="glass flex flex-col gap-4 p-5">
        <Handoff />
        <p className="text-pink-200/75">This lesson isn't prepared yet. The Librarian finds the passages, the Subject Teacher drafts the plan and the Examiner checks every line against the notes. The deck is built from that checked plan.</p>
        <div><ShimmerButton disabled={busy} onClick={() => setLive(true)} className="gap-2 px-5 py-2.5 font-semibold" background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">Write it live</ShimmerButton></div>
      </div>
    );
  }

  const slides = deck.slides;
  const s = slides[Math.min(idx, slides.length - 1)];
  const kept = slides.filter((x) => !x.cut);

  const persist = (next: Slide[], now = false) => {
    setDeck({ ...deck, slides: next });
    setSaving("saving");
    clearTimeout(timer.current);
    const go = async () => {
      try {
        const r = await api<DeckRes>(`/api/lessons/${lesson.id}/deck`, { json: { slides: next } });
        if (r.deck) setDeck(r.deck);
        setSaving("saved");
      } catch { setSaving("error"); }
    };
    if (now) go(); else timer.current = window.setTimeout(go, 450);
  };
  const patch = (fn: (x: Slide) => Slide, now = false) => persist(slides.map((x, k) => (k === idx ? fn(x) : x)), now);
  // one click: find an openly licensed picture (Wikimedia Commons, credited) for each content slide
  const autoPictures = async () => {
    const want = slides.map((x, k) => [x, k] as const).filter(([x]) => !x.image && !x.cut && !["title", "sources", "check"].includes(x.kind));
    let next = [...slides], added = 0;
    for (const [x, k] of want) {
      setPicBusy(`Finding pictures… ${added}/${want.length}`);
      const q = (x.title || x.bullets?.[0]?.text || "").replace(/\[P\d+\]/g, "").split(/\s+/).slice(0, 6).join(" ");
      if (!q.trim()) continue;
      try {
        const { results } = await api<{ results: Hit[] }>(`/api/prep/images?q=${encodeURIComponent(q)}`);
        if (!results?.length) continue;
        const img = await api<Img>("/api/prep/images", { json: { title: results[0].title } });
        next = next.map((y, j) => (j === k ? { ...y, image: img } : y)); added++;
      } catch { /* no picture for this one */ }
    }
    persist(next, true);
    setPicBusy(added ? `Added ${added} pictures` : "No pictures found (needs an internet connection)");
    setTimeout(() => setPicBusy(""), 4000);
  };
  const move = (d: number) => {
    const j = idx + d;
    if (j < 1 || j >= slides.length || slides[j].kind === "sources" || s.kind === "title" || s.kind === "sources") return;
    const next = [...slides];
    [next[idx], next[j]] = [next[j], next[idx]];
    persist(next, true);
    setIdx(j);
  };
  const reset = async () => {
    if (!confirm("Put the deck back to how the agents built it? Your cuts, added slides, images and notes go.")) return;
    const r = await api<DeckRes>(`/api/lessons/${lesson.id}/deck`, { method: "DELETE" });
    setDeck(r.deck); setIdx(0);
  };
  const approve = async () => {
    setApproving(true);
    try { await api(`/api/lessons/${lesson.id}/approve`, { method: "POST" }); onReload(); } finally { setApproving(false); }
  };
  const focusCite = (id: string) => {
    setHot(id);
    panel.current?.querySelector<HTMLElement>(`[data-cite="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const fixed = s.kind === "title" || s.kind === "sources";
  const passed = String(deck.verdict || "").toLowerCase().startsWith("pass");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {res.outdated && <div className="rounded-xl border border-pink-300/25 bg-pink-500/10 px-4 py-2.5 text-sm">The plan was prepared again since you last edited this deck, so the deck was rebuilt from the new plan.</div>}

      {/* the last class stopped early: the plan must pick up what it missed (dev note 64) */}
      {(() => {
        const cov = prep.coverage;
        if (!cov) return null;
        const upto = cov.sections.findIndex((x) => x.name === cov.furthest);
        const missed = cov.sections.filter((x, i) => i <= upto && x.state !== "covered").length;
        if (!missed && cov.pct >= 100) return null;
        return (
          <button onClick={() => setLive(true)} className="no-print flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/60 bg-amber-400/10 px-4 py-3 text-left hover:bg-amber-400/15">
            <span><b className="block text-amber-100">Update required: previous lesson plan not complete</b>
              <span className="text-sm text-amber-100/80">The last class stopped at {tidy(cov.furthest || "")}{missed ? ` and missed ${missed} part${missed > 1 ? "s" : ""}` : ""}. Re-draft the plan to catch up first, then the new content.</span></span>
            <span className="rounded-full bg-amber-300 px-4 py-2 text-sm font-bold text-[#1a1206]">Update the plan</span>
          </button>
        );
      })()}
      {/* toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <button onClick={autoPictures} disabled={!!picBusy} title="Find an openly licensed picture for each slide"
          className="rounded-full border border-pink-300/40 px-4 py-2 text-sm font-semibold text-pink-100 hover:border-pink-300/70 disabled:opacity-70">{picBusy || "Add pictures"}</button>
        <button onClick={() => setLive(true)} title="Watch the agents write, check and fix this plan"
          className="rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-4 py-2 text-sm font-semibold text-white">Re-draft live</button>
        <div className="flex items-center gap-1 rounded-full border border-pink-300/20 bg-white/[.03] p-1">
          <IconBtn label="Previous slide" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}><span className="rotate-180">{Icon.arrow}</span></IconBtn>
          <span className="min-w-[64px] text-center font-mono text-[13px]">{idx + 1} / {slides.length}</span>
          <IconBtn label="Next slide" onClick={() => setIdx(Math.min(slides.length - 1, idx + 1))} disabled={idx === slides.length - 1}>{Icon.arrow}</IconBtn>
        </div>
        {!fixed && <Btn onClick={() => patch((x) => ({ ...x, cut: !x.cut }), true)} active={s.cut}>{s.cut ? "Restore slide" : "Cut slide"}</Btn>}
        {!fixed && <><IconBtn label="Move slide earlier" onClick={() => move(-1)} disabled={idx <= 1}><svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg></IconBtn>
          <IconBtn label="Move slide later" onClick={() => move(1)} disabled={idx >= slides.length - 2}><svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg></IconBtn></>}
        {!fixed && <Btn onClick={() => setModal("image")}>{s.image ? "Change image" : "Add image"}</Btn>}
        <Btn onClick={() => setModal("notes")}>Add from the notes</Btn>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-pink-200/60" aria-live="polite">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? "Couldn't save" : res.edited ? "Your edits are saved" : ""}</span>
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold hover:border-pink-300/60">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2" /><rect x="6" y="14" width="12" height="7" /></svg>Print the bundle</button>
          {lesson.approved
            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-300 px-3 py-2 text-sm font-semibold text-[#1a0d14]">{Icon.check} Approved{lesson.approved_at ? ` · ${fmtDate(lesson.approved_at)}` : ""}</span>
            : <button disabled={approving} onClick={approve} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-4 py-2 text-sm font-semibold text-white">{Icon.check} Approve plan</button>}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* the slide */}
        <div className="min-w-0">
          <SlideView deck={deck} slide={s} n={idx + 1} total={slides.length} kept={kept} lessonDate={lesson.date} hot={hot} setHot={setHot}
            onCite={focusCite} answers={answers} onAnswers={() => setAnswers((a) => !a)}
            onBullet={(id) => patch((x) => ({ ...x, bullets: x.bullets.map((b) => (b.id === id ? { ...b, cut: !b.cut } : b)) }), true)}
            onDropImage={() => patch((x) => ({ ...x, image: null }), true)} />
          <div className="no-print mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-pink-200/70">
            <span className="rounded-full bg-white/[.06] px-2.5 py-1">{KIND_LABEL[s.kind]}</span>
            {s.cut && <span>{s.cut_reason ? `Cut by default: ${s.cut_reason}.` : "Cut: it won't print."} Restore it to keep it.</span>}
            {passed && s.kind !== "added" && s.kind !== "recap" && !fixed && <span className="inline-flex items-center gap-1">{Icon.check} Examiner checked these lines against the notes</span>}
            {s.kind === "added" && <span>Lines lifted word for word from the passage you added.</span>}
            {s.kind === "activity" && <span>The activity is the Subject Teacher's suggestion, not a fact from the notes.</span>}
          </div>
          {!fixed && <textarea value={s.notes} onChange={(e) => patch((x) => ({ ...x, notes: e.target.value }))} rows={2} maxLength={1500}
            placeholder="Your own notes for this slide. They print in the bundle as yours, not as course facts, and learners don't see them."
            className="no-print mt-3 w-full resize-y rounded-xl border border-pink-300/20 bg-[#151318] px-3 py-2 text-[14px] text-pink-100 placeholder:text-pink-200/40" />}
        </div>

        {/* the sources, Ask the Commission style */}
        <aside ref={panel} className="glass max-h-[640px] min-w-0 overflow-y-auto p-4" aria-label="Sources for this slide">
          <SourcePanel deck={deck} slide={s} kept={kept} hot={hot} setHot={setHot} />
        </aside>
      </div>

      {/* every slide at a glance */}
      <div className="no-print flex gap-2.5 overflow-x-auto pb-2" role="tablist" aria-label="Slides">
        {slides.map((x, k) => (
          <button key={x.id} role="tab" aria-selected={k === idx} onClick={() => setIdx(k)}
            className={cn("relative grid aspect-video w-[132px] shrink-0 content-start gap-1 overflow-hidden rounded-lg border p-2 text-left",
              k === idx ? "border-pink-300 bg-[#fff6fa] text-[#1a0d14] shadow-[0_0_18px_-4px_#ff3d9a]" : x.cut ? "hatch border-dashed border-grey/50 bg-zinc-800 text-pink-100/60" : "border-pink-300/20 bg-[#f7eef3] text-[#1a0d14]/85 hover:border-pink-300/60")}>
            <span className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-wide text-pink-600">{k + 1}<span className="font-sans normal-case text-[10px] font-semibold text-[#1a0d14]/50">{KIND_LABEL[x.kind]}</span></span>
            <span className="line-clamp-3 text-[11.5px] font-semibold leading-tight">{x.title}</span>
            {x.image && <span className="absolute bottom-1.5 right-1.5 rounded bg-pink-600 px-1 text-[9px] font-bold text-white">IMG</span>}
            {x.cut && <span className="absolute bottom-1.5 left-1.5 rounded bg-zinc-700 px-1 text-[9px] font-bold uppercase text-pink-100">cut</span>}
          </button>
        ))}
      </div>

      <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-pink-200/65">
        <span>{kept.length} of {slides.length} slides will print · {usedCites(slides).P.length} passages and {usedCites(slides).T.length} transcript lines cited</span>
        <button onClick={reset} className="text-pink-300 hover:underline">Reset the deck</button>
      </div>

      {modal === "image" && <ImageDialog slide={s} onClose={() => setModal("")} onPick={(img) => { patch((x) => ({ ...x, image: img }), true); setModal(""); }} />}
      {modal === "notes" && <NotesDialog lessonId={lesson.id} onClose={() => setModal("")} onAdded={(r, pid) => {
        setModal(""); if (r.deck) { setDeck(r.deck); setIdx(Math.max(0, r.deck.slides.findIndex((x) => x.id === `add${pid}`))); setSaving("saved"); } }} after={s.id} />}
      {createPortal(<PrintBundle deck={deck} prep={prep} lesson={lesson} />, document.body)}
    </div>
  );
}

function Btn({ children, onClick, active }: { children: ReactNode; onClick: () => void; active?: boolean }) {
  return <button onClick={onClick} className={cn("rounded-full border px-3.5 py-2 text-[13.5px] font-semibold", active ? "border-pink-300 bg-pink-500/20 text-pink-50" : "border-pink-300/30 hover:border-pink-300/60")}>{children}</button>;
}
function IconBtn({ children, onClick, label, disabled }: { children: ReactNode; onClick: () => void; label: string; disabled?: boolean }) {
  return <button aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid size-9 place-items-center rounded-full hover:bg-pink-500/15 disabled:opacity-30">{children}</button>;
}

/* ------------------------------------------------------------------ one slide */

function CiteChip({ c, hot, setHot, onCite, small }: { c: { kind: "P" | "T"; n: number }; hot: string | null; setHot: (v: string | null) => void; onCite: (id: string) => void; small?: boolean }) {
  const id = `${c.kind}${c.n}`, on = hot === id;
  return (
    <button type="button" data-chip={id} onMouseEnter={() => setHot(id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(id)} onClick={() => onCite(id)}
      aria-label={c.kind === "P" ? `Source passage ${c.n}` : `Transcript line ${c.n}`}
      className={cn("mx-[0.15em] inline-flex items-center rounded-[0.35em] border px-[0.35em] align-[0.1em] font-mono font-bold leading-[1.35]", small ? "text-[10px]" : "text-[0.62em]",
        c.kind === "P" ? "text-white" : "border-dashed border-zinc-500 bg-zinc-100 text-zinc-700", on && "ring-2 ring-offset-1 ring-[#1a0d14]")}
      style={c.kind === "P" ? { background: srcHue(c.n), borderColor: srcHue(c.n) } : undefined}>{id}</button>
  );
}

function Cited({ text, hot, setHot, onCite }: { text: string; hot: string | null; setHot: (v: string | null) => void; onCite: (id: string) => void }) {
  return <>{citeParts(text).map((p, i) => typeof p === "string" ? <span key={i}>{p}</span> : <CiteChip key={i} c={p} hot={hot} setHot={setHot} onCite={onCite} />)}</>;
}

function SlideView({ deck, slide: s, n, total, kept, lessonDate, hot, setHot, onCite, answers, onAnswers, onBullet, onDropImage }: {
  deck: Deck; slide: Slide; n: number; total: number; kept: Slide[]; lessonDate: string | null; hot: string | null; setHot: (v: string | null) => void;
  onCite: (id: string) => void; answers: boolean; onAnswers: () => void; onBullet: (id: string) => void; onDropImage: () => void;
}) {
  const chars = s.bullets.reduce((a, b) => a + b.text.length + (answers ? (b.answer || "").length : 0), 0);
  const fs = chars > 900 ? 1.45 : chars > 650 ? 1.65 : chars > 420 ? 1.9 : 2.2;
  const t = splitTitle(deck.chapter);
  return (
    <div style={{ containerType: "inline-size" }} className={cn("relative w-full overflow-hidden rounded-[14px] bg-[#fffafc] text-[#1a0d14] shadow-[0_30px_60px_-30px_rgba(0,0,0,.9)] ring-1 ring-pink-300/30", s.cut && "opacity-60")}>
      <div className="absolute inset-x-0 top-0 h-[0.7cqw] min-h-1 bg-gradient-to-r from-pink-600 via-pink-500 to-pink-300" />
      {s.cut && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center"><span className="rotate-[-8deg] rounded-lg border-4 border-zinc-700 px-4 py-1 text-[5cqw] font-black uppercase tracking-widest text-zinc-700/80">Cut</span></div>}
      <div className="flex aspect-video flex-col overflow-y-auto px-[5%] pb-[3.2%] pt-[3.6%]">
        <div className="flex items-center justify-between text-[1.25cqw] font-bold uppercase tracking-[0.14em] text-pink-600">
          <span>{KIND_LABEL[s.kind]}{s.kind !== "title" ? ` · ${t.mod} ${t.kt}` : ""}</span><span className="font-mono text-[#1a0d14]/45">{n} / {total}</span>
        </div>
        {s.kind === "title" ? (
          <div className="my-auto">
            <div className="text-[1.6cqw] font-semibold text-pink-600">{t.mod} {t.kt} · {fmtDate(lessonDate)} · {deck.minutes} min</div>
            <h3 className="mt-[1.2cqw] text-[5.2cqw] font-extrabold leading-[1.02] tracking-[-0.03em] [text-wrap:balance]">{s.title}</h3>
            {deck.stop && <p className="mt-[1.6cqw] text-[2cqw] text-[#1a0d14]/75">Picks up from <b>{tidy(deck.stop)}</b>{deck.stop_from === "transcript" ? " (from the class transcript)" : ""}</p>}
            <p className="mt-[2.4cqw] text-[1.45cqw] text-[#1a0d14]/60">Prepared by the Librarian, Subject Teacher and Examiner from {deck.sources.length} passages of the course notes · Examiner: {deck.verdict || "checking"}{deck.examiner_rounds ? ` after ${deck.examiner_rounds} send-back${deck.examiner_rounds > 1 ? "s" : ""}` : ""}</p>
          </div>
        ) : (
          <>
            <h3 className="mt-[1.4cqw] text-[3.4cqw] font-extrabold leading-[1.08] tracking-[-0.02em] [text-wrap:balance]">{s.title}</h3>
            {s.subtitle && <p className="mt-[0.5cqw] text-[1.45cqw] text-[#1a0d14]/60">{s.subtitle}</p>}
            {s.kind === "sources" ? <SourcesList deck={deck} kept={kept} /> : (
              <div className={cn("mt-[2cqw] grid min-h-0 flex-1 gap-[3%]", s.image ? "grid-cols-[1.45fr_1fr]" : "grid-cols-1")}>
                <ul className="grid content-start gap-[1.1cqw]" style={{ fontSize: `${fs}cqw`, lineHeight: 1.38 }}>
                  {s.bullets.map((b, k) => (
                    <li key={b.id} className={cn("group relative grid grid-cols-[1.4em_1fr] items-start", b.cut && "opacity-35 [&_span]:line-through")}>
                      <span className="pt-[0.05em] font-mono text-[0.8em] font-bold text-pink-600 no-underline">{s.kind === "check" ? `${k + 1}.` : "▸"}</span>
                      <div>
                        <Cited text={b.text} hot={hot} setHot={setHot} onCite={onCite} />
                        {s.kind === "check" && answers && b.answer && <div className="mt-[0.3em] text-[0.82em] text-pink-700"><b>Answer: </b><Cited text={b.answer} hot={hot} setHot={setHot} onCite={onCite} /></div>}
                      </div>
                      {s.kind !== "title" && (
                        <button onClick={() => onBullet(b.id)} title={b.cut ? "Bring this line back" : "Cut this line"} aria-label={b.cut ? "Bring this line back" : "Cut this line"}
                          className="no-print absolute -left-[1.6em] top-0 grid size-[1.3em] place-items-center rounded-full bg-zinc-200 text-[0.7em] font-bold text-zinc-700 opacity-0 transition-opacity hover:bg-pink-500 hover:text-white focus:opacity-100 group-hover:opacity-100">{b.cut ? "↺" : "×"}</button>
                      )}
                    </li>
                  ))}
                </ul>
                {s.image && (
                  <figure className="relative m-0 grid min-h-0 content-start gap-[0.6cqw]">
                    <img src={s.image.src} alt={s.image.title} className="max-h-[26cqw] w-full rounded-[1cqw] object-contain" />
                    <figcaption className="text-[1.05cqw] leading-snug text-[#1a0d14]/60">Image: <a href={s.image.page} target="_blank" rel="noreferrer" className="underline">{s.image.title}</a>. {s.image.credit}</figcaption>
                    <button onClick={onDropImage} className="no-print absolute right-[0.6cqw] top-[0.6cqw] rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-pink-600">Remove</button>
                  </figure>
                )}
              </div>
            )}
            {s.kind === "check" && <button onClick={onAnswers} className="no-print mt-[1.4cqw] self-start rounded-full border border-pink-600/40 px-3 py-1 text-[12px] font-semibold text-pink-700 hover:bg-pink-50">{answers ? "Hide answers" : "Show answers"}</button>}
          </>
        )}
      </div>
    </div>
  );
}

function SourcesList({ deck, kept }: { deck: Deck; kept: Slide[] }) {
  const used = usedCites(kept);
  const src = deck.sources.filter((x) => used.P.includes(x.n)).sort((a, b) => a.n - b.n);
  const lines = deck.transcript.filter((x) => used.T.includes(x.n));
  return (
    <div className="mt-[1.6cqw] columns-2 gap-[3%] text-[1.3cqw] leading-snug">
      {src.map((x) => <p key={x.n} className="mb-[0.6cqw] break-inside-avoid"><b style={{ color: srcHue(x.n) }}>P{x.n}</b> {x.where}</p>)}
      {lines.length > 0 && <p className="mb-[0.6cqw] break-inside-avoid"><b className="text-zinc-600">T1–T{lines.length}</b> Class transcript, {fmtDate(deck.class_date)}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ sources beside the slide */

function SourcePanel({ deck, slide, kept, hot, setHot }: { deck: Deck; slide: Slide; kept: Slide[]; hot: string | null; setHot: (v: string | null) => void }) {
  const cites = slide.kind === "sources" ? usedCites(kept) : usedCites([{ ...slide, cut: false }]);
  const ps = cites.P.map((n) => deck.sources.find((x) => x.n === n)).filter(Boolean) as Deck["sources"];
  const ts = cites.T.map((n) => deck.transcript.find((x) => x.n === n)).filter(Boolean) as Deck["transcript"];
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Cited on this slide</h3>
        <span className="text-[12px] text-pink-200/60">{ps.length} passage{ps.length === 1 ? "" : "s"}{ts.length ? ` · ${ts.length} line${ts.length === 1 ? "" : "s"}` : ""}</span>
      </div>
      {!ps.length && !ts.length && <p className="mt-3 text-[13.5px] text-pink-200/65">{slide.kind === "title" ? "The title slide makes no claims, so nothing to cite." : slide.kind === "gaps" ? "These are what the notes don't cover, so there's nothing to cite. Bring your own material or skip them." : "No citations on this slide."}</p>}
      <div className="mt-3 grid gap-2.5">
        {ts.map((x) => (
          <div key={"T" + x.n} data-cite={`T${x.n}`} onMouseEnter={() => setHot(`T${x.n}`)} onMouseLeave={() => setHot(null)}
            className={cn("rounded-xl border border-l-[3px] border-dashed border-zinc-500/60 border-l-zinc-300 bg-white/[.03] p-3 transition-colors", hot === `T${x.n}` && "bg-white/[.09] ring-1 ring-zinc-300")}>
            <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-pink-200/70">
              <span className="rounded bg-zinc-200 px-1.5 font-mono font-bold text-zinc-800">T{x.n}</span><b className="text-pink-100">{x.speaker}</b>
              <span className="font-mono">{x.at}</span><span>class of {fmtDate(deck.class_date)}</span>
            </div>
            <p className="mt-1.5 text-[13.5px] text-pink-100/90">“{x.text}”</p>
          </div>
        ))}
        {ps.map((x) => (
          <div key={"P" + x.n} data-cite={`P${x.n}`} onMouseEnter={() => setHot(`P${x.n}`)} onMouseLeave={() => setHot(null)}
            className={cn("rounded-xl border border-l-[3px] border-pink-300/10 bg-white/[.03] p-3 transition-colors", hot === `P${x.n}` && "bg-white/[.09]")}
            style={{ borderLeftColor: srcHue(x.n), boxShadow: hot === `P${x.n}` ? `0 0 0 1px ${srcHue(x.n)}` : undefined }}>
            <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-pink-200/70">
              <span className="rounded px-1.5 font-mono font-bold text-white" style={{ background: srcHue(x.n) }}>P{x.n}</span>
              <span className="min-w-0">{x.where}</span>
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-pink-100/90">{x.text}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ dialogs */

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => box.current?.querySelector<HTMLElement>("input, button")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    addEventListener("keydown", onKey, true);
    return () => { removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; before?.focus?.(); };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/70 p-4 backdrop-blur-md" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className={cn("glass flex max-h-[88vh] w-full flex-col p-5 md:p-6", wide ? "max-w-[920px]" : "max-w-[640px]")}>
        <div className="flex items-start justify-between gap-3"><h2 className="text-h3">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full border border-pink-300/25 hover:border-pink-300/60">×</button></div>
        <div className="mt-4 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function ImageDialog({ slide, onClose, onPick }: { slide: Slide; onClose: () => void; onPick: (img: Img) => void }) {
  const [q, setQ] = useState(plain(slide.title).replace(/e\.g\.|\(continued\)|[()]/gi, " ").replace(/\s+/g, " ").trim());
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const search = async () => {
    setErr(""); setHits(null);
    try { setHits((await api<{ results: Hit[] }>(`/api/prep/images?q=${encodeURIComponent(q)}`)).results); }
    catch (e: any) { setErr(String(e.message || e)); setHits([]); }
  };
  useEffect(() => { if (q) search(); }, []);
  const pick = async (h: Hit) => {
    setBusy(h.title); setErr("");
    try { onPick(await api<Img>("/api/prep/images", { json: { title: h.title } })); }
    catch (e: any) { setErr(String(e.message || e)); } finally { setBusy(null); }
  };
  return (
    <Dialog title="Add an image from the internet" onClose={onClose} wide>
      <p className="text-[13.5px] text-pink-200/75">Openly licensed pictures from Wikimedia Commons. The one you pick is downloaded to the school's server, and its author and licence print under it on the slide.</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a picture" aria-label="Search for a picture"
          className="min-w-0 flex-1 rounded-full border border-pink-300/25 bg-[#151318] px-4 py-2 text-[14px] text-pink-100" />
        <button className="rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-4 py-2 text-sm font-semibold text-white">Search</button>
      </form>
      {err && <p className="mt-3 text-sm text-pink-300">{err}</p>}
      {hits === null && <p className="mt-4 text-sm text-pink-200/70">Searching Wikimedia Commons…</p>}
      {hits && !hits.length && !err && <p className="mt-4 text-sm text-pink-200/70">Nothing with a clear licence for that. Try a plainer word, like "fingerprint" or "firewall".</p>}
      {hits && hits.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {hits.map((h) => (
            <li key={h.title} className="grid content-start gap-1.5 rounded-xl border border-pink-300/15 bg-white/[.03] p-2">
              <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-black/30"><img src={h.thumb} alt={h.description || h.title} loading="lazy" className="max-h-full max-w-full object-contain" /></div>
              <span className="line-clamp-2 text-[12px] font-semibold">{h.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "")}</span>
              <span className="truncate text-[11.5px] text-pink-200/65">{h.artist} · {h.license}</span>
              <button disabled={!!busy} onClick={() => pick(h)} className="rounded-full border border-pink-300/30 px-3 py-1.5 text-[12.5px] font-semibold hover:border-pink-300/60 disabled:opacity-50">{busy === h.title ? "Downloading…" : "Add to slide"}</button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function NotesDialog({ lessonId, after, onClose, onAdded }: { lessonId: number; after: string; onClose: () => void; onAdded: (r: DeckRes, pid: number) => void }) {
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => { api<Candidate[]>(`/api/lessons/${lessonId}/deck/passages`).then(setItems).catch((e) => setErr(String(e.message || e))); }, [lessonId]);
  const groups = useMemo(() => {
    const g = new Map<string, Candidate[]>();
    for (const c of items || []) g.set(c.section, [...(g.get(c.section) || []), c]);
    return [...g.entries()];
  }, [items]);
  const add = async (pid: number) => {
    setBusy(pid); setErr("");
    try { onAdded(await api<DeckRes>(`/api/lessons/${lessonId}/deck/slides`, { json: { pid, after } }), pid); }
    catch (e: any) { setErr(String(e.message || e)); } finally { setBusy(null); }
  };
  return (
    <Dialog title="Add a slide from the notes" onClose={onClose} wide>
      <p className="text-[13.5px] text-pink-200/75">Every passage of this chapter. Adding one makes a slide of its key sentences, word for word and cited, after the slide you're on.</p>
      {err && <p className="mt-3 text-sm text-pink-300">{err}</p>}
      {!items && !err && <p className="mt-4 text-sm text-pink-200/70">Reading the chapter…</p>}
      <div className="mt-4 grid gap-5">
        {groups.map(([sec, cs]) => (
          <section key={sec}>
            <h3 className="text-[14px] font-semibold text-pink-100">{tidy(sec)} <span className="font-normal text-pink-200/60">· {cs.length} passage{cs.length === 1 ? "" : "s"}</span></h3>
            <ul className="mt-2 grid gap-2">
              {cs.map((c) => (
                <li key={c.pid} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-pink-300/10 bg-white/[.03] p-3">
                  <p className="text-[13px] leading-relaxed text-pink-100/85">{c.preview}{c.words > 40 ? "…" : ""}</p>
                  <div className="grid justify-items-end gap-1.5">
                    {c.cited && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">in the plan</span>}
                    <button disabled={c.has_slide || busy !== null} onClick={() => add(c.pid)} className="whitespace-nowrap rounded-full border border-pink-300/30 px-3 py-1.5 text-[12.5px] font-semibold hover:border-pink-300/60 disabled:opacity-40">
                      {c.has_slide ? "Has a slide" : busy === c.pid ? "Adding…" : "Add as slide"}</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ the printed bundle */

function PrintText({ text }: { text: string }) {
  return <>{citeParts(text).map((p, i) => typeof p === "string" ? <span key={i}>{p}</span> : <sup key={i} className="cite">[{p.kind}{p.n}]</sup>)}</>;
}

/** What prints: a cover sheet, one landscape page per kept slide with its sources underneath, then every source in full. */
function PrintBundle({ deck, prep, lesson }: { deck: Deck; prep: Prep; lesson: PrepLesson }) {
  const kept = deck.slides.filter((s) => !s.cut);
  const used = usedCites(kept);
  const t = splitTitle(deck.chapter), tl = prep.timeline, last = prep.last_class, cov = prep.coverage;
  const src = (n: number) => deck.sources.find((x) => x.n === n);
  const line = (n: number) => deck.transcript.find((x) => x.n === n);
  const images = kept.filter((s) => s.image);
  return (
    <div id="print-root" className="bundle">
      <section className="page cover">
        <p className="kicker">Lesson bundle · {prep.course.subject || prep.course.title}</p>
        <h1>{t.name || deck.title}</h1>
        <p className="meta">{t.mod} {t.kt} · {fmtDate(lesson.date)} · {deck.minutes} min{deck.stop ? ` · picks up from ${tidy(deck.stop)}` : ""} · Examiner: {deck.verdict || "checking"} · {lesson.approved ? `Approved by the teacher${lesson.approved_at ? " on " + fmtDate(lesson.approved_at) : ""}` : "Draft, not yet approved"}</p>
        <div className="cols">
          <div>
            <h2>Road to the exam</h2>
            <p>{tl.days_to_exam} days to the exam on {fmtDate(tl.exam_date)}. {tl.lessons_left} lessons left across {tl.chapters_left} chapters{tl.after_exam ? `; ${tl.after_exam} land after the exam` : "; every lesson fits"}. Forecast finish {fmtDate(tl.eta)}.</p>
            {prep.pace && <p>At the last class's pace ({prep.pace.advanced} passages a class), the notes take {prep.pace.classes_needed ?? "–"} more classes: projected finish {fmtDate(prep.pace.finish)}, {prep.pace.fits ? "before" : "after"} the exam.</p>}
          </div>
          <div>
            <h2>Last class</h2>
            {last ? <p>{fmtDate(last.held_on)}, {last.minutes} min, {last.present} of {last.register} present. {cov ? `The transcript reached ${cov.furthest ? tidy(cov.furthest) : "no section"} (${cov.pct}% of the chapter).` : ""}</p> : <p>No class recorded yet.</p>}
            {cov && <ul>{cov.sections.map((s) => <li key={s.name}>{tidy(s.name)}: {s.state === "not_reached" ? "not reached" : s.state}</li>)}</ul>}
          </div>
          <div>
            <h2>Slides ({kept.length})</h2>
            <ol>{kept.map((s) => <li key={s.id}>{s.title}</li>)}</ol>
          </div>
        </div>
        <p className="small">Every line on these slides is cited: [P#] is a passage of the course notes, [T#] a line of the class transcript. Sources are under each slide and in full at the back.</p>
      </section>

      {kept.map((s, k) => {
        const c = s.kind === "sources" ? { P: [] as number[], T: [] as number[] } : usedCites([s]);
        return (
          <section key={s.id} className="page">
            <div className="pslide">
              <div className="ptop"><span>{KIND_LABEL[s.kind]} · {t.mod} {t.kt}</span><span>{k + 1} / {kept.length}</span></div>
              <h2 className="ptitle">{s.title}</h2>
              {s.subtitle && <p className="psub">{s.subtitle}</p>}
              {s.kind === "sources" ? (
                <ul className="psources">{used.P.map((n) => <li key={n}>[P{n}] {src(n)?.where}</li>)}{used.T.length > 0 && <li>[T1–T{deck.transcript.length}] Class transcript, {fmtDate(deck.class_date)}</li>}</ul>
              ) : (
                <div className={s.image ? "pbody img" : "pbody"}>
                  <ul>{s.bullets.filter((b) => !b.cut).map((b) => <li key={b.id}><PrintText text={b.text} /></li>)}</ul>
                  {s.image && <figure><img src={s.image.src} alt="" /><figcaption>{s.image.title}. {s.image.credit}</figcaption></figure>}
                </div>
              )}
            </div>
            {(c.P.length > 0 || c.T.length > 0 || s.notes || s.kind === "check") && (
              <div className="under">
                {s.kind === "check" && <><h3>Answers</h3><ol>{s.bullets.filter((b) => !b.cut).map((b) => <li key={b.id}><PrintText text={b.answer || ""} /></li>)}</ol></>}
                {s.notes && <><h3>Facilitator's own notes</h3><p>{s.notes}</p></>}
                {(c.P.length > 0 || c.T.length > 0) && <h3>Sources on this slide</h3>}
                {c.T.map((n) => { const x = line(n); return x ? <p key={"T" + n} className="q"><b>[T{n}]</b> {x.speaker}, {x.at}: “{x.text}”</p> : null; })}
                {c.P.map((n) => { const x = src(n); return x ? <p key={"P" + n} className="q"><b>[P{n}]</b> {x.where}: “{x.text.length > 420 ? x.text.slice(0, 418).replace(/\s+\S*$/, "") + "…" : x.text}”</p> : null; })}
              </div>
            )}
          </section>
        );
      })}

      <section className="page">
        <h1>Sources in full</h1>
        <h2>Course notes</h2>
        {used.P.map((n) => { const x = src(n); return x ? <p key={n} className="q"><b>[P{n}]</b> {x.where}<br />{x.text}</p> : null; })}
        {used.T.length > 0 && <><h2>Class transcript, {fmtDate(deck.class_date)}</h2>
          {used.T.map((n) => { const x = line(n); return x ? <p key={n} className="q"><b>[T{n}]</b> {x.at} {x.speaker}: “{x.text}”</p> : null; })}</>}
        {images.length > 0 && <><h2>Image credits</h2>{images.map((s) => <p key={s.id} className="q">{s.image!.title}: {s.image!.credit}. {s.image!.page}</p>)}</>}
      </section>
    </div>
  );
}
