/* Pieces shared by the prep pages (dev notes 30, 39): View plan (#/class/prep), Show progress
   (#/class/progress) and Review classes (#/class/classes). Moved out of LessonPrep.tsx unchanged, apart
   from the "Review classes" button on the last class card. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api, fmtDate, splitTitle } from "@/lib/api";
import { Icon, NumberTicker } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { inkOn, modHue, tidy, type Coverage, type LastClass, type Pace, type TChapter, type Timeline } from "@/lib/prep";

export const rise = (i: number) => ({ initial: { opacity: 0.85, y: 10 }, whileInView: { opacity: 1, y: 0 },
  viewport: { once: true }, transition: { duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] as const } });
export const initials = (n: string) => n.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export function Head({ title, lede, chip }: { title: string; lede: string; chip?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-h2">{title}</h2><p className="mt-1.5 max-w-[680px] text-muted text-pink-200/75">{lede}</p></div>
      {chip && <span className="rounded-full border border-pink-300/20 bg-white/5 px-3 py-1 text-[12.5px] font-semibold text-pink-200/85">{chip}</span>}
    </div>
  );
}
export function Section({ i, title, lede, children }: { i: number; title: string; lede: string; children: React.ReactNode }) {
  return <motion.section {...rise(i)} className="mt-12 md:mt-16"><Head title={title} lede={lede} />{children}</motion.section>;
}

/* ------------------------------------------------------------------ the road to the exam */

const STATE_WORD: Record<string, string> = { taught: "taught", partial: "part-taught", next: "next", planned: "planned", after_exam: "after the exam" };

export function PrepTimeline({ tl, current }: { tl: Timeline; current: number | null }) {
  const [step, setStep] = useState(40);
  const lessons = tl.lessons;
  const idxOf = useMemo(() => new Map(lessons.map((l, i) => [l.id, i])), [lessons]);
  const curChapter = Math.max(0, tl.chapters.findIndex((c) => current != null && c.lessons.includes(current)));
  const [sel, setSel] = useState(curChapter);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  useEffect(() => setSel(curChapter), [curChapter]);

  const pad = 28, top = 34, segY = 60, segH = 34, covY = 98, tickY = 110;
  const W = pad * 2 + lessons.length * step;
  const H = 150;
  const x = (i: number) => pad + i * step;
  const examAt = (() => { const k = lessons.findIndex((l) => l.state === "after_exam"); return k < 0 ? lessons.length : k; })();
  const todayAt = Math.max(0, lessons.findIndex((l) => l.state !== "taught" && (l.date || "9") >= tl.today));

  // keep the selected chapter in view
  useLayoutEffect(() => {
    const c = tl.chapters[sel], el = box.current;
    if (!c || !el) return;
    const a = x(idxOf.get(c.lessons[0]) ?? 0), b = x((idxOf.get(c.lessons[c.lessons.length - 1]) ?? 0) + 1);
    if (a < el.scrollLeft + 40 || b > el.scrollLeft + el.clientWidth - 40) el.scrollTo({ left: Math.max(0, a - el.clientWidth / 3), behavior: "smooth" });
  }, [sel, step]);

  const months: { i: number; label: string }[] = [];
  lessons.forEach((l, i) => {
    const m = (l.date || "").slice(0, 7);
    if (m && (i === 0 || (lessons[i - 1].date || "").slice(0, 7) !== m)) months.push({ i, label: new Date(m + "-01T00:00:00").toLocaleDateString("en-ZA", { month: "short", year: "numeric" }) });
  });
  const mods: { mod: string; a: number; b: number }[] = [];
  tl.chapters.forEach((c) => {
    const a = idxOf.get(c.lessons[0]) ?? 0, b = (idxOf.get(c.lessons[c.lessons.length - 1]) ?? 0) + 1;
    const last = mods[mods.length - 1];
    if (last && last.mod === c.mod && last.b === a) last.b = b; else mods.push({ mod: c.mod || c.kt, a, b });
  });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setSel((s) => Math.min(tl.chapters.length - 1, s + 1)); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
  };
  const c = tl.chapters[sel];
  const hv = hover != null ? tl.chapters[hover] : null;

  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pink-300/10 px-4 py-3 text-[12.5px] text-pink-200/80">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Key cls="bg-pink-300" label="taught" /><Key cls="bg-pink-500/40 ring-1 ring-pink-300" label="next" />
          <Key cls="bg-pink-300/25" label="planned" /><Key cls="hatch bg-zinc-800 ring-1 ring-dashed ring-grey" label="after the exam" />
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1 w-4 rounded bg-white/90 shadow-[0_0_4px_#ff9ccb]" />reached in class (transcript)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 hidden sm:inline">{hv ? `${hv.mod} ${hv.kt} · ${hv.name}` : "Zoom"}</span>
          <button aria-label="Zoom out" onClick={() => setStep((s) => Math.max(16, s - 8))} className="grid size-8 place-items-center rounded-full border border-pink-300/30 font-bold hover:border-pink-300/60">−</button>
          <button aria-label="Zoom in" onClick={() => setStep((s) => Math.min(80, s + 8))} className="grid size-8 place-items-center rounded-full border border-pink-300/30 font-bold hover:border-pink-300/60">+</button>
        </div>
      </div>
      <div ref={box} tabIndex={0} onKeyDown={onKey} aria-label="Timeline of the lessons left before the exam. Use the arrow keys to move between chapters."
        className="cursor-grab overflow-x-auto overscroll-x-contain outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-pink-300/60"
        onPointerDown={(e) => { drag.current = { x: e.clientX, left: box.current!.scrollLeft, moved: false }; }}
        onPointerMove={(e) => { const d = drag.current; if (!d || !(e.buttons & 1)) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 4) d.moved = true; box.current!.scrollLeft = d.left - dx; }}
        onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block select-none" role="img" aria-label={`${tl.lessons_left} lessons left, exam on ${fmtDate(tl.exam_date)}`}>
          <defs>
            <pattern id="tl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#27272a" /><rect width="2" height="6" fill="rgba(161,161,170,.55)" /></pattern>
          </defs>
          {months.map((m) => <g key={m.i}><line x1={x(m.i)} x2={x(m.i)} y1={14} y2={H - 8} stroke="rgba(255,170,210,.08)" /><text x={x(m.i) + 4} y={20} fill="rgba(255,209,230,.6)" fontSize="11" fontWeight="600">{m.label}</text></g>)}
          {mods.map((m) => (
            <g key={m.mod + m.a}>
              <rect x={x(m.a)} y={top} width={(m.b - m.a) * step - 3} height={18} rx={5} fill="rgba(255,170,210,.06)" stroke="rgba(255,170,210,.14)" />
              <text x={x(m.a) + 7} y={top + 13} fill="#ffd1e6" fontSize="11" fontWeight="700">{(m.b - m.a) * step > 60 ? m.mod : ""}</text>
            </g>
          ))}
          {tl.chapters.map((ch, k) => {
            const a = idxOf.get(ch.lessons[0]) ?? 0, b = (idxOf.get(ch.lessons[ch.lessons.length - 1]) ?? 0) + 1;
            const w = (b - a) * step - 3, hue = modHue(ch.mod || "1");
            const fill = ch.state === "taught" ? hue : ch.state === "after_exam" ? "url(#tl-hatch)" : ch.state === "partial" || ch.state === "next" ? hue + "88" : hue + "33";
            const on = k === sel;
            return (
              <g key={ch.topic_id + "-" + a} className="cursor-pointer" onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}
                onClick={() => { if (!drag.current?.moved) setSel(k); }}>
                <title>{`${ch.mod} ${ch.kt}: ${ch.name} · ${ch.lessons.length} lesson${ch.lessons.length > 1 ? "s" : ""} · ${fmtDate(ch.start)}${ch.end !== ch.start ? ` to ${fmtDate(ch.end)}` : ""} · ${STATE_WORD[ch.state]}`}</title>
                <rect x={x(a)} y={segY} width={w} height={segH} rx={7} fill={fill}
                  stroke={on ? "#fff0f7" : ch.state === "after_exam" ? "#a1a1aa" : hue + "aa"} strokeWidth={on ? 2.5 : 1} strokeDasharray={ch.state === "after_exam" ? "4 3" : undefined}
                  style={on ? { filter: "drop-shadow(0 0 8px rgba(255,61,154,.7))" } : undefined} />
                {ch.transcript_pct > 0 && <rect x={x(a)} y={covY} width={Math.max(3, w * ch.transcript_pct / 100)} height={4} rx={2} fill="#fff0f7" style={{ filter: "drop-shadow(0 0 4px #ff9ccb)" }} />}
                {w >= 32 && <text x={x(a) + w / 2} y={segY + 21} textAnchor="middle" fontSize="11.5" fontWeight="700"
                  fill={ch.state === "after_exam" ? "#fff0f7" : ch.state === "taught" ? inkOn(hue) : "#fff0f7"}>{ch.kt || ch.name.slice(0, 4)}</text>}
              </g>
            );
          })}
          {lessons.map((l, i) => (
            <rect key={l.id} x={x(i) + 2} y={tickY} width={step - 7} height={10} rx={3}
              fill={l.state === "taught" ? "#ff9ccb" : l.state === "after_exam" ? "url(#tl-hatch)" : l.id === current ? "#ff3d9a" : l.has_plan ? "rgba(255,156,203,.5)" : "rgba(255,170,210,.16)"}
              stroke={l.id === current ? "#fff0f7" : "none"} strokeWidth={1.5}>
              <title>{`${l.seq}. ${l.title} · ${l.date ? fmtDate(l.date) : "no slot"} · ${STATE_WORD[l.state]}${l.has_plan ? " · plan ready" : ""}`}</title>
            </rect>
          ))}
          <g aria-label="Today">
            <line x1={x(todayAt) - 2} x2={x(todayAt) - 2} y1={28} y2={H - 14} stroke="#ff9ccb" strokeWidth="1.5" strokeDasharray="3 3" />
            <text x={x(todayAt) + 2} y={H - 8} fill="#ff9ccb" fontSize="11" fontWeight="700">today</text>
          </g>
          <g aria-label={`Exam ${fmtDate(tl.exam_date)}`}>
            <line x1={x(examAt) - 2} x2={x(examAt) - 2} y1={26} y2={H - 14} stroke="#ff3d9a" strokeWidth="2" />
            <path d={`M ${x(examAt) - 1} 26 h 15 l -4 5 l 4 5 h -15 z`} fill="#ff3d9a" style={{ filter: "drop-shadow(0 0 6px #ff3d9a)" }} />
            <text x={x(examAt) - 6} y={H - 8} textAnchor="end" fill="#ffd1e6" fontSize="11" fontWeight="700">exam {fmtDate(tl.exam_date)}</text>
          </g>
        </svg>
      </div>
      {c && <ChapterDetail c={c} tl={tl} current={current} onPrev={sel > 0 ? () => setSel(sel - 1) : undefined} onNext={sel < tl.chapters.length - 1 ? () => setSel(sel + 1) : undefined} />}
    </div>
  );
}

function Key({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><i className={cn("inline-block size-2.5 rounded-[3px]", cls)} />{label}</span>;
}

function ChapterDetail({ c, tl, current, onPrev, onNext }: { c: TChapter; tl: Timeline; current: number | null; onPrev?: () => void; onNext?: () => void }) {
  const ls = tl.lessons.filter((l) => c.lessons.includes(l.id));
  return (
    <div className="grid gap-4 border-t border-pink-300/10 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:p-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-md px-2 py-0.5 font-mono text-[12px] font-bold" style={{ background: modHue(c.mod || "1"), color: inkOn(modHue(c.mod || "1")) }}>{c.mod} {c.kt}</span>
          <span className="text-label text-pink-200/70">{STATE_WORD[c.state]}</span>
          <span className="ml-auto flex gap-1">
            <button aria-label="Previous chapter" disabled={!onPrev} onClick={onPrev} className="grid size-8 place-items-center rounded-full border border-pink-300/25 disabled:opacity-30"><span className="rotate-180">{Icon.arrow}</span></button>
            <button aria-label="Next chapter" disabled={!onNext} onClick={onNext} className="grid size-8 place-items-center rounded-full border border-pink-300/25 disabled:opacity-30">{Icon.arrow}</button>
          </span>
        </div>
        <h3 className="mt-2 text-h3">{c.name}</h3>
        <p className="mt-1 text-muted text-pink-200/75">{c.passages} passages of notes in {c.sections.length} section{c.sections.length === 1 ? "" : "s"}
          {c.transcript_pct ? ` · ${c.transcript_pct}% reached in class (transcript)` : ""}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.sections.map((s) => <span key={s} className="rounded-full border border-pink-300/15 bg-white/[.04] px-2.5 py-1 text-[12.5px] text-pink-100/90">{tidy(s)}</span>)}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-label font-semibold text-pink-200/80">Lessons</div>
        <ul className="mt-2 grid gap-1.5">
          {ls.map((l) => (
            <li key={l.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[13.5px]", l.id === current ? "border-pink-300/50 bg-pink-500/10" : "border-pink-300/10 bg-white/[.02]")}>
              <span className="font-mono text-pink-200/70">{fmtDate(l.date)}</span>
              <span className="min-w-0 flex-1 truncate">{l.parts > 1 ? `Part ${l.part} of ${l.parts}` : "One lesson"}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", l.state === "after_exam" ? "hatch bg-zinc-800 text-pink-100" : l.state === "taught" ? "bg-pink-300 text-[#1a0d14]" : "bg-white/10 text-pink-100")}>{STATE_WORD[l.state]}</span>
              {l.state !== "taught" && (l.id === current
                ? <span className="text-[12.5px] font-semibold text-pink-300">this lesson</span>
                : <a href={`#/class/prep/${l.id}`} className="text-[12.5px] font-semibold text-pink-300 hover:underline">{l.has_plan ? "Open deck" : "Prep this"}</a>)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the last class */

export const SOURCE_WORD: Record<LastClass["source"], string> = { meet: "Google Meet", meet_demo: "Google Meet (demo class)", sample: "Sample class", upload: "Uploaded transcript" };

export function LastClassCard({ last }: { last: LastClass | null }) {
  const [fail, setFail] = useState(false);
  if (!last) return (
    <div className="glass grid gap-3 p-5 text-pink-200/80">
      <p>No class has been recorded yet. Connect Google Meet in Settings and pull the class after it ends; its transcript is matched against the notes here.</p>
      <a href="/fast-track/settings" className="text-sm font-semibold text-pink-300 hover:underline">Open Settings</a>
    </div>
  );
  const labels = Object.entries(last.participation || {}).sort((a, b) => b[1] - a[1]);
  const real = !!last.thumbnail && !fail;
  return (
    <div className="glass overflow-hidden">
      <div className="relative aspect-video w-full bg-[#121014]">
        {real ? <img src={last.thumbnail!} alt={`Recording of the class on ${fmtDate(last.held_on)}`} onError={() => setFail(true)} className="size-full object-cover" />
          : <ClassCard last={last} />}
      </div>
      <div className="grid gap-3 p-4 md:p-5">
        <p className="text-label text-pink-200/65">{real ? "Thumbnail of the Meet recording (Google Drive)." : last.source === "meet" ? "No recording thumbnail came back from Google Drive, so this card is drawn from the register and transcript." : "Drawn from the class register and transcript. A live Meet class with a recording shows the recording's own thumbnail here."}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13.5px] sm:grid-cols-3">
          <Fact k="Source" v={SOURCE_WORD[last.source]} />
          <Fact k="Length" v={`${last.minutes} min`} />
          <Fact k="Present" v={`${last.present} of ${last.register}`} />
          <Fact k="Transcript" v={`${last.lines} lines · ${last.speakers} voices`} />
          <Fact k="Led by" v={last.teacher || "–"} />
          <Fact k="Chapter" v={`${splitTitle(last.chapter).mod} ${splitTitle(last.chapter).kt}`} />
        </dl>
        {labels.length > 0 && <div className="flex flex-wrap gap-1.5">{labels.map(([k, v]) => <span key={k} className="rounded-full border border-pink-300/20 bg-white/[.04] px-2.5 py-1 text-[12px]">{k} <b className="font-mono">{v}</b></span>)}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href={`#/class/classes/${last.session_id}`}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(230,25,127,.75)]">
            Review classes{Icon.arrow}</a>
          <a href="/fast-track/settings" className="text-[13px] text-pink-300 hover:underline">Pull a newer class from Google Meet in Settings</a>
        </div>
      </div>
    </div>
  );
}

export function Fact({ k, v }: { k: string; v: string }) {
  return <div className="min-w-0"><dt className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-pink-200/55">{k}</dt><dd className="truncate">{v}</dd></div>;
}

/** A Meet-style still drawn from the register: one tile per person, the facilitator highlighted, the last thing they said as a caption. */
export function ClassCard({ last }: { last: LastClass }) {
  const people = (last.people.length ? last.people : [{ name: last.teacher || "Facilitator", minutes: last.minutes }]).slice(0, 12);
  const n = people.length, cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols);
  const W = 640, H = 360, gx = 10, top = 38, bottom = 64;
  const tw = (W - 32 - gx * (cols - 1)) / cols, th = Math.min((H - top - bottom - gx * (rows - 1)) / rows, tw * 0.62);
  const gridH = rows * th + (rows - 1) * gx, y0 = top + (H - top - bottom - gridH) / 2;
  const cap = last.caption.length > 96 ? last.caption.slice(0, 94).replace(/\s+\S*$/, "") + "…" : last.caption;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block size-full" role="img" aria-label={`Class card: ${n} people, ${last.minutes} minutes`}>
      <defs><linearGradient id="cc-av" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#e6197f" /><stop offset="1" stopColor="#5c0838" /></linearGradient></defs>
      <rect width={W} height={H} fill="#121014" />
      <circle cx={22} cy={20} r={5} fill="#ff3d9a" />
      <text x={34} y={24} fill="#ffd1e6" fontSize="13" fontWeight="700">{splitTitle(last.chapter).mod} {splitTitle(last.chapter).kt} · {splitTitle(last.chapter).name.slice(0, 44)}</text>
      <text x={W - 16} y={24} textAnchor="end" fill="rgba(255,209,230,.7)" fontSize="12" fontFamily="ui-monospace, monospace">{fmtDate(last.held_on)} · {last.minutes} min</text>
      {people.map((p, k) => {
        const c = k % cols, r = Math.floor(k / cols), tx = 16 + c * (tw + gx), ty = y0 + r * (th + gx), lead = p.name === last.teacher;
        const late = p.minutes < last.minutes * 0.6;
        return (
          <g key={p.name + k}>
            <rect x={tx} y={ty} width={tw} height={th} rx={10} fill="#1e171d" stroke={lead ? "#ff3d9a" : "rgba(255,170,210,.12)"} strokeWidth={lead ? 3 : 1} />
            <circle cx={tx + tw / 2} cy={ty + th / 2 - 6} r={Math.min(th, tw) * 0.2} fill="url(#cc-av)" opacity={late ? 0.45 : 1} />
            <text x={tx + tw / 2} y={ty + th / 2 - 6 + Math.min(th, tw) * 0.07} textAnchor="middle" fill="#fff" fontSize={Math.min(th, tw) * 0.16} fontWeight="700">{initials(p.name)}</text>
            <text x={tx + 8} y={ty + th - 8} fill={late ? "rgba(255,209,230,.5)" : "#ffd1e6"} fontSize="11" fontWeight="600">{p.name.slice(0, 18)}{late ? " · left early" : ""}</text>
          </g>
        );
      })}
      <rect x={16} y={H - 50} width={W - 32} height={38} rx={8} fill="rgba(0,0,0,.6)" />
      <text x={28} y={H - 26} fill="#fff0f7" fontSize="13"><tspan fontWeight="700" fill="#ff9ccb">{(last.teacher || "Facilitator").slice(0, 16)}: </tspan>{cap}</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ what the plan set out to cover */

/** The lesson plan's points as a list; a point is struck through once the transcript reached one of
    the passages it cites (dev note 40). */
function PlanChecklist({ lessonId, cells }: { lessonId: number; cells: Coverage["cells"] }) {
  const [plan, setPlan] = useState<{ items: string[]; pidOf: Map<number, number> } | null>(null);
  useEffect(() => {
    api<any>(`/api/lessons/${lessonId}`).then((l) => {
      const items: string[] = [...(l.plan?.objectives || []), ...(l.plan?.explanation || [])];
      setPlan({ items, pidOf: new Map((l.passages || []).map((p: any) => [p.n, p.pid ?? p.id])) });
    }).catch(() => setPlan({ items: [], pidOf: new Map() }));
  }, [lessonId]);
  if (!plan || !plan.items.length) return null;
  const reached = new Set(cells.filter((c) => c.level).map((c) => c.pid));
  const done = (t: string) => [...t.matchAll(/\[P(\d+)\]/g)].some((m) => reached.has(plan.pidOf.get(Number(m[1])) as number));
  const n = plan.items.filter(done).length;
  return (
    <div className="rounded-xl border border-pink-300/15 bg-white/[.03] p-3.5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <b className="text-[14px]">What the plan set out to cover</b>
        <span className="font-mono text-[12px] text-pink-200/70">{n} of {plan.items.length} covered</span>
      </div>
      <ul className="grid gap-1.5 pl-5 text-[14px] [list-style:disc]">
        {plan.items.map((t) => {
          const d = done(t);
          return <li key={t} className={cn(d ? "text-pink-200/60 line-through decoration-pink-400 decoration-2" : "text-pink-50")}>
            {t.replace(/\s*(\[P\d+\])+\s*$/, "")}{d && <span className="sr-only"> (covered)</span>}</li>;
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ what the transcript covered */

export function CoverageMap({ cov, pace, recordedStop, lessonIsNext, nextLessonId, onChanged }: {
  cov: Coverage | null; pace: Pace | null; recordedStop: string | null; lessonIsNext: boolean; nextLessonId: number | null; onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  if (!cov) return <div className="glass p-5 text-pink-200/75">No transcript yet. When a class is pulled from Google Meet, each line is matched to the passage of the notes it teaches, and the map shows how far the class got.</div>;
  const ch = splitTitle(cov.chapter);
  const differs = cov.furthest && recordedStop && cov.furthest !== recordedStop;
  const canUse = lessonIsNext && nextLessonId === cov.lesson_id && cov.furthest && cov.furthest !== recordedStop;
  const useStop = async () => {
    setSaving(true);
    try { await api(`/api/lessons/${cov.lesson_id}/progress`, { json: { stopped_section: cov.furthest, finished: false } }); onChanged(); }
    finally { setSaving(false); }
  };
  return (
    <div className="glass grid grid-cols-[minmax(0,1fr)] gap-4 p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <b className="min-w-0 truncate">{ch.mod} {ch.kt} · {ch.name}</b>
        <span className="font-mono text-[13px] text-pink-200/80">{cov.pct}% of the chapter reached</span>
      </div>
      <PlanChecklist lessonId={cov.lesson_id} cells={cov.cells} />
      <ol className="grid gap-2.5" aria-label="Sections of the chapter, in reading order">
        {cov.sections.map((s) => {
          const cells = cov.cells.filter((c) => c.section === s.name);
          const here = s.name === cov.furthest, rec = s.name === recordedStop;
          return (
            <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-[6px] border text-[10px]",
                  s.state === "covered" ? "border-pink-300 bg-pink-300 text-[#1a0d14]" : s.state === "touched" ? "border-pink-300/70 bg-pink-500/25 text-pink-100" : "border-dashed border-grey/60 text-transparent")}>
                  {s.state !== "not_reached" ? Icon.check : "·"}</span>
                <span className={cn("truncate text-[14px]", s.state === "not_reached" && "text-pink-200/55")}>{tidy(s.name)}</span>
                {here && <span className="shrink-0 rounded-full bg-pink-500 px-2 py-0.5 text-[11px] font-semibold text-white">class got to here</span>}
                {rec && <span className="shrink-0 rounded-full border border-pink-300/40 px-2 py-0.5 text-[11px] font-semibold text-pink-100">your stop point</span>}
              </div>
              <span className="text-right font-mono text-[12px] text-pink-200/70">{s.matched}/{s.passages}</span>
              <div className="col-span-2 flex flex-wrap gap-[3px]" aria-hidden="true">
                {cells.map((c) => <i key={c.pid} title={c.level ? `Matched transcript line ${(c.line ?? 0) + 1} (${c.hits} shared words)` : "Not matched"}
                  className={cn("inline-block h-[9px] w-[14px] rounded-[2px]", c.level === "covered" ? "bg-pink-300 shadow-[0_0_6px_-1px_#ff9ccb]" : c.level === "touched" ? "bg-pink-500/60" : s.state === "not_reached" ? "bg-white/[.05]" : "bg-white/10")} />)}
              </div>
            </li>
          );
        })}
      </ol>
      {(differs || canUse) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pink-300/20 bg-pink-500/[.07] px-3 py-2.5 text-[13.5px]">
          <span className="min-w-0 flex-1">{recordedStop ? <>Your record says the class stopped at <b>{tidy(recordedStop)}</b>; the transcript reaches <b>{tidy(cov.furthest || "")}</b>.</> : <>The transcript reaches <b>{tidy(cov.furthest || "")}</b>, and no stop point is recorded yet.</>}</span>
          {canUse && <button disabled={saving} onClick={useStop} className="rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-3.5 py-1.5 text-[13px] font-semibold text-white">Use the transcript's stop point</button>}
        </div>
      )}
      {pace && <PaceBox pace={pace} />}
    </div>
  );
}

function PaceBox({ pace }: { pace: Pace }) {
  return (
    <div className="rounded-2xl border border-pink-300/15 bg-black/20 p-4">
      <div className="text-label font-semibold text-pink-200/80">On the schedule</div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat big={pace.advanced} label="passages last class" sub={`plan: ${pace.plan_avg} a lesson`} />
        <Stat big={pace.classes_needed ?? 0} label="classes to finish" sub={`${pace.slots_left} slots before the exam`} />
        <div className="min-w-0">
          <b className="block truncate font-mono text-[22px] font-bold tracking-tight">{pace.finish ? fmtDate(pace.finish) : "–"}</b>
          <span className="block text-[12px] text-pink-200/75">projected finish</span>
          <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", pace.fits ? "bg-pink-300 text-[#1a0d14]" : "hatch bg-zinc-800 text-pink-100 outline outline-1 outline-dashed outline-grey")}>
            {pace.fits ? Icon.check : Icon.clock}{pace.fits ? "before the exam" : "after the exam"}</span>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-pink-200/60">At the last class's pace through the notes. A projection from {pace.advanced ? "one class" : "no progress yet"}; it firms up as more classes come in from Meet.</p>
    </div>
  );
}

function Stat({ big, label, sub }: { big: number; label: string; sub: string }) {
  return <div className="min-w-0"><b className="block font-mono text-[22px] font-bold tracking-tight"><NumberTicker value={big} /></b>
    <span className="block text-[12px] text-pink-200/75">{label}</span><span className="block text-[11.5px] text-pink-200/55">{sub}</span></div>;
}

