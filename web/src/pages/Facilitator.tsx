/* Facilitator: exam clocks, the lesson runway, the route through the modules, the next lesson with
   the agent hand-off (21st.dev Animated Beam), the race, and learners to check. Real Melsoft data. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { api, fmtDate, melsoftCourse, splitTitle, type Board, type Learner, type Pacing } from "@/lib/api";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Icon, Modal, NumberTicker, ProgressRing, SpotlightCard } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { TestsWaiting, TrackSummary, type Summary } from "@/pages/FacExtras";

const MOD_HUE = ["#ffd1e6", "#fff0f7", "#ff9ccb", "#ff3d9a", "#e6197f", "#c00d68", "#8f0a52", "#5c0838"];
const modHue = (m: string) => MOD_HUE[(parseInt(m.replace(/\D/g, ""), 10) || 1) % MOD_HUE.length];
const rise = (i: number) => ({ initial: { opacity: 0.85, y: 10 }, whileInView: { opacity: 1, y: 0 },
  viewport: { once: true }, transition: { duration: 0.8, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] as const } });
const initials = (n: string) => n.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

type Lesson = { id: number; seq: number; title: string; topic_id: number; topic?: string; planned_date: string | null; status: string };
type State = { course: any; pacing: Pacing; lessons: Lesson[]; topics: { id: number; title: string }[]; sessions: any[]; tests: any[] };

export default function Facilitator() {
  const [st, setSt] = useState<State | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cid, setCid] = useState<number | null>(null);
  const [fac, setFac] = useState<Summary | null>(null);

  const load = async () => {
    const c = cid ?? (await melsoftCourse())?.id;
    if (!c) throw new Error("No course with notes yet");
    setCid(c);
    const [s, b, f] = await Promise.all([api<State>(`/api/state/${c}`), api<Board>(`/api/ft/${c}/board`), api<Summary>(`/api/ft/${c}/facilitator`)]);
    setSt(s); setBoard(b); setFac(f);
    // the next lesson starts from where the class stopped (a part-taught chapter continues)
    setPlan(f.next ? await api(`/api/lessons/${f.next.lesson_id}`) : null);
  };
  useEffect(() => { load().catch((e) => setErr(String(e.message || e))); }, []);

  const prepare = async (id: number) => {
    setBusy(true);
    try {
      const { job_id } = await api<{ job_id: number }>(`/api/lessons/${id}/prepare`, { method: "POST" });
      for (let i = 0; i < 60; i++) {
        const j = await api<{ status: string }>(`/api/jobs/${job_id}`);
        if (j.status !== "running") break;
        await new Promise((r) => setTimeout(r, 700));
      }
      await load();
    } finally { setBusy(false); }
  };

  if (err) return <div className="glass p-6">Couldn't open the class: {err}</div>;
  if (!st || !board || !fac) return <div className="py-6 text-pink-200/70">Opening the class…</div>;

  const p = st.pacing, short = p.shortfall || 0, next = st.lessons.find((l) => l.id === fac.next?.lesson_id) || st.lessons.find((l) => l.status === "Planned");
  const termDays = Math.max(1, Math.round((+new Date(st.course.exam_date) - +new Date(st.course.term_start)) / 864e5));
  const mods = [...new Set(st.topics.map((t) => splitTitle(t.title).mod))];
  const curChapter = (fac.stopped && !fac.stopped.finished ? fac.stopped.chapter : fac.next?.chapter) || fac.stopped?.chapter || st.topics[0]?.title || "";
  const ct = splitTitle(curChapter);
  const modTopics = st.topics.filter((t) => splitTitle(t.title).mod === ct.mod);
  const taughtIds = new Set(st.lessons.filter((l) => l.status !== "Planned").map((l) => l.topic_id));
  const partialFrac = fac.stopped && !fac.stopped.finished && fac.next?.sections.length
    ? (fac.next.sections.indexOf(fac.stopped.section || "") + 1) / fac.next.sections.length : 0;
  const doneCh = modTopics.filter((t) => taughtIds.has(t.id)).length;
  // The headline is the course or qualification itself (e.g. "Cyber security"), not the module code.
  const courseName = String(st.course.subject || st.course.title).replace(/\s*\([^)]*\)\s*$/, "") || st.course.title;
  const cur = { mod: ct.mod, kt: ct.kt, name: ct.name, section: fac.stopped && !fac.stopped.finished ? fac.stopped.section : null,
    doneCh, totalCh: modTopics.length, pct: modTopics.length ? (100 * (doneCh + partialFrac)) / modTopics.length : 0 };

  return (
    <>
      {/* 1. Hero: the module being taught right now; the exam countdown is a small pill beside it */}
      <motion.section {...rise(0)} className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Now teaching</div>
          <h1 className="mt-2 text-display [text-wrap:balance]">{courseName}</h1>
          <p className="mt-2 max-w-[640px] text-h2 [text-wrap:balance]"><span className="text-pink-300">{cur.mod}</span> · {cur.name}</p>
          <p className="mt-2 text-body text-pink-200/80">
            {cur.kt} {cur.section ? <>· in progress at <b className="text-pink-100">{cur.section}</b></> : "· starts next lesson"}
          </p>
          <div className="mt-3 max-w-[640px]">
            <div className="mb-1.5 flex justify-between text-label text-pink-200/70"><span>{cur.mod} progress</span><span>{cur.doneCh} of {cur.totalCh} chapters taught</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-pink-600 to-pink-300" initial={{ width: 0 }} animate={{ width: `${Math.max(2, cur.pct)}%` }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
          <span className="inline-flex h-9 items-center gap-2 rounded-full border border-pink-300/30 bg-pink-500/10 px-3.5 text-muted font-semibold">
            {Icon.clock}<span className="font-mono"><NumberTicker value={p.days_to_exam} /></span> days to {st.course.title} exam · {fmtDate(p.exam_date)}
          </span>
          <span className="text-label text-pink-200/70">{fac.coverage.pct}% of exam content covered · forecast finish {fmtDate(p.eta)}</span>
          {short ? <span className="hatch inline-flex items-center gap-1.5 rounded-full border border-dashed border-grey bg-zinc-800 px-2.5 py-1 text-xs">{Icon.clock}{short} lesson{short > 1 ? "s" : ""} after the exam</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-300 px-2.5 py-1 text-xs font-semibold text-[#1a0d14]">{Icon.check} every lesson fits</span>}
        </div>
      </motion.section>

      {/* 2. Covered so far (route map as it was) beside the next lesson */}
      <section className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <motion.div {...rise(1)} className="min-w-0">
          <Head title="Covered so far" compact lede={fac.stopped
            ? `Last lesson stopped at ${splitTitle(fac.stopped.chapter).mod} ${splitTitle(fac.stopped.chapter).kt}${fac.stopped.section ? ` · ${fac.stopped.section}` : ""}${fac.stopped.finished ? " (chapter finished)" : ""}${fac.stopped.date ? ` on ${fmtDate(fac.stopped.date)}` : ""}.`
            : "Nothing taught yet. Record where today's class stopped on the next lesson, and the pin moves here."} />
          <div className="glass p-2.5"><RouteMap st={st} board={board} stopped={fac.stopped} /></div>
        </motion.div>
        <motion.div {...rise(2)} className="min-w-0">
          <Head title="Next lesson" compact lede={next ? `${fmtDate(next.planned_date)} · ${splitTitle(next.title).mod} ${splitTitle(next.title).kt}` : "Nothing planned"} />
          <NextLesson lesson={plan} busy={busy} onPrepare={prepare} next={fac.next} onChanged={() => load()} />
        </motion.div>
      </section>

      <Section i={3} title="Exam runway" lede="One tile per lesson, in teaching order. The flag is the exam; striped tiles land after it." chip={`${p.taught} taught · ${p.lessons_left} to go`}>
        <div className="glass p-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(13px,1fr))] gap-[5px]">
            {st.lessons.map((l, i) => {
              const risky = p.at_risk_ids.includes(l.id), done = l.status !== "Planned", isNext = next?.id === l.id;
              const flag = short && i === p.slots_left + p.taught;
              return (
                <span key={l.id} className="contents">
                  {flag && <span className="grid place-items-center text-pink-300 [filter:drop-shadow(0_0_8px_rgba(255,156,203,.8))]" title={`Exam ${fmtDate(p.exam_date)}`}>
                    <svg viewBox="0 0 18 26" className="h-[26px] w-[18px]" fill="currentColor"><rect x="1" width="2" height="26" rx="1" /><path d="M3 1h13l-3 5 3 5H3z" /></svg></span>}
                  <motion.span initial={{ opacity: 0, scaleY: 0.4 }} whileInView={{ opacity: 1, scaleY: 1 }} viewport={{ once: true }}
                    transition={{ delay: i * 0.009, duration: 0.5 }} title={`${l.seq}. ${l.title} · ${l.planned_date ? fmtDate(l.planned_date) : "after the exam"}`}
                    className={cn("aspect-[1/1.6] rounded-[4px] border", risky ? "hatch border-dashed border-grey bg-zinc-800" : "", isNext && "outline outline-2 outline-offset-2 outline-pink-100")}
                    style={risky ? undefined : { borderColor: modHue(splitTitle(l.topic || l.title).mod) + "77",
                      background: done ? modHue(splitTitle(l.topic || l.title).mod) : modHue(splitTitle(l.topic || l.title).mod) + "40" }} />
                </span>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[12.5px] text-pink-200/80">
            {mods.map((m) => <span key={m}><i className="mr-1.5 inline-block size-2.5 rounded-[3px] align-[-1px]" style={{ background: modHue(m) }} />{m}</span>)}
          </div>
        </div>
      </Section>

      <Section i={4} title="Student track plans" lede="Who is on pace for the exam. Open a learner for their own plan.">
        <TrackSummary data={fac} />
      </Section>

      <a href="#/learners" className="mt-4 inline-flex items-center gap-2 text-sm text-pink-300 hover:underline">The race, learners to check and class participation are on the Student plans page{Icon.arrow}</a>


      <Section i={5} title="Tests waiting for approval" lede="Personal tests drafted by the agents. Learners only see them after you approve.">
        <TestsWaiting tests={st.tests || []} reload={() => load()} />
      </Section>
    </>
  );
}

function Head({ title, lede, chip, compact }: { title: string; lede: string; chip?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", compact ? "mb-2.5" : "mb-4")}>
      <div><h2 className="text-h2">{title}</h2><p className={cn("max-w-[640px] text-pink-200/75", compact ? "mt-1 text-muted" : "mt-2 text-body")}>{lede}</p></div>
      {chip && <span className="rounded-full border border-pink-300/20 bg-white/5 px-3 py-1 text-[12.5px] font-semibold text-pink-200/85">{chip}</span>}
    </div>
  );
}
function Section({ i, title, lede, chip, children }: { i: number; title: string; lede: string; chip?: string; children: React.ReactNode }) {
  return <motion.section {...rise(i)} className="mt-12 md:mt-[72px]"><Head title={title} lede={lede} chip={chip} />{children}</motion.section>;
}

function Clock({ value, max, color, big, small, label, sub }: { value: number; max: number; color: string; big: number; small: string; label: string; sub: string }) {
  return (
    <div className="grid justify-items-center gap-2.5 text-center">
      <ProgressRing value={value} max={max} color={color} size={140}>
        <b className="block font-mono text-[28px] font-bold tracking-[-0.04em]"><NumberTicker value={big} /></b>
        <small className="text-xs text-pink-200/70">{small}</small>
      </ProgressRing>
      <div className="font-semibold">{label}<span className="block text-[13px] font-normal text-pink-200/70">{sub}</span></div>
    </div>
  );
}

function RouteMap({ st, board, stopped }: { st: State; board: Board; stopped: Summary["stopped"] }) {
  const mods = [...new Set(st.topics.map((t) => splitTitle(t.title).mod))];
  const W = 560, rowH = 120, perRow = 3;
  const pts = mods.map((m, i) => { const row = Math.floor(i / perRow), col = i % perRow; return { m, x: row % 2 ? W - 90 - col * 190 : 90 + col * 190, y: 70 + row * rowH }; });
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    d += a.y === b.y ? ` L ${b.x} ${b.y}` : ` C ${a.x + (a.x > W / 2 ? 80 : -80)} ${a.y}, ${b.x + (b.x > W / 2 ? 80 : -80)} ${b.y}, ${b.x} ${b.y}`;
  }
  const taught = new Set(st.lessons.filter((l) => l.status !== "Planned").map((l) => l.topic_id));
  const nextMod = splitTitle(st.lessons.find((l) => l.status === "Planned")?.title || "").mod;
  const H = 70 + Math.ceil(pts.length / perRow - 1) * rowH + 70;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Route through ${mods.length} modules`}>
      <path d={d} fill="none" stroke="rgba(255,170,210,.08)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <motion.path d={d} fill="none" stroke="#ff3d9a" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 10" opacity={0.55}
        animate={{ strokeDashoffset: [0, -16] }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} />
      {pts.map((pt) => {
        const topics = st.topics.filter((t) => splitTitle(t.title).mod === pt.m);
        const t = topics.filter((x) => taught.has(x.id)).length;
        const practised = topics.filter((x) => board.learners.some((l) => (l.chapters[x.id]?.top || 0) > 0)).length;
        const share = topics.length ? practised / topics.length : 0, hue = modHue(pt.m), here = pt.m === nextMod, r = 22, c = 2 * Math.PI * r;
        return (
          <g key={pt.m}>
            {stopped && splitTitle(stopped.chapter).mod === pt.m && (
              <g aria-label="Stopped here">
                <path d={`M ${pt.x} ${pt.y - 26} l -9 -14 a 10.5 10.5 0 1 1 18 0 z`} fill="#ffd1e6" stroke="#0c0b0e" strokeWidth="1.5" style={{ filter: "drop-shadow(0 0 6px #ff3d9a)" }} />
                <circle cx={pt.x} cy={pt.y - 44} r="3.5" fill="#c00d68" />
                <text x={pt.x + 16} y={pt.y - 38} fill="#ffd1e6" fontSize="11.5" fontWeight="700">Stopped here</text>
              </g>
            )}
            {here && <motion.circle cx={pt.x} cy={pt.y} fill={hue} animate={{ r: [26, 36, 26], opacity: [0.25, 0.05, 0.25] }} transition={{ duration: 2.4, repeat: Infinity }} />}
            <circle cx={pt.x} cy={pt.y} r={r} fill="#0c0b0e" stroke="rgba(255,170,210,.14)" strokeWidth="3" />
            <motion.circle cx={pt.x} cy={pt.y} r={r} fill="none" stroke={hue} strokeWidth="3" strokeLinecap="round" transform={`rotate(-90 ${pt.x} ${pt.y})`}
              initial={{ strokeDasharray: `0 ${c}` }} whileInView={{ strokeDasharray: `${c * Math.max(share, 0.02)} ${c}` }} viewport={{ once: true }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }} style={{ filter: `drop-shadow(0 0 6px ${hue})` }} />
            <circle cx={pt.x} cy={pt.y} r={t === topics.length && t ? 12 : 6} fill={hue} />
            <text x={pt.x} y={pt.y + 44} textAnchor="middle" fill="#fff0f7" fontSize="13" fontWeight="600">{pt.m}{here ? " · next" : ""}</text>
            <text x={pt.x} y={pt.y + 60} textAnchor="middle" fill="rgba(255,209,230,.72)" fontSize="11.5">{t}/{topics.length} taught · {practised} practised</text>
          </g>
        );
      })}
    </svg>
  );
}

const AGENTS = [
  { name: "Librarian", color: "#ff9ccb", icon: <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5M8 7h7" /></svg> },
  { name: "Subject Teacher", color: "#ff3d9a", icon: <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg> },
  { name: "Examiner", color: "#ffd1e6", icon: <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg> },
];

function Handoff() {
  const box = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLDivElement>(null), b = useRef<HTMLDivElement>(null), c = useRef<HTMLDivElement>(null);
  const refs = [a, b, c];
  return (
    <div ref={box} className="relative flex items-center justify-between px-1 py-1.5">
      {AGENTS.map((ag, i) => (
        <div key={ag.name} className="relative z-10 grid justify-items-center gap-1.5 text-[12.5px] font-semibold text-pink-200/85">
          <div ref={refs[i]} className="grid size-[46px] place-items-center rounded-[14px] border border-pink-300/25 bg-[#151318]" style={{ color: ag.color, boxShadow: `0 0 24px -6px ${ag.color}` }}>{ag.icon}</div>
          {ag.name}
        </div>
      ))}
      <AnimatedBeam containerRef={box} fromRef={a} toRef={b} duration={2.4} pathColor="#ff9ccb" gradientStartColor="#ff3d9a" gradientStopColor="#ffd1e6" startYOffset={-10} endYOffset={-10} />
      <AnimatedBeam containerRef={box} fromRef={b} toRef={c} duration={2.4} delay={1.2} pathColor="#ff9ccb" gradientStartColor="#ff3d9a" gradientStopColor="#ffd1e6" startYOffset={-10} endYOffset={-10} />
    </div>
  );
}

/** Record where today's class stopped: a section of the chapter, or the whole chapter finished. */
function RecordProgress({ next, onChanged }: { next: Summary["next"]; onChanged: () => void }) {
  const [sec, setSec] = useState(next?.continues_from || next?.sections[0] || "");
  const [saving, setSaving] = useState(false);
  if (!next) return null;
  const save = async (finished: boolean) => {
    setSaving(true);
    try { await api(`/api/lessons/${next.lesson_id}/progress`, { json: { stopped_section: finished ? null : sec, finished } }); onChanged(); }
    finally { setSaving(false); }
  };
  return (
    <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-pink-300/15 bg-white/[.03] p-3 text-sm">
      <b className="mr-1">After class:</b>
      <label className="flex min-w-0 items-center gap-2">stopped at
        <select value={sec} onChange={(e) => setSec(e.target.value)} className="min-w-0 max-w-[260px] rounded-lg border border-pink-300/25 bg-[#151318] px-2 py-1.5 text-pink-100">
          {next.sections.map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>
      <button disabled={saving} onClick={() => save(false)} className="rounded-full border border-pink-300/30 px-3 py-1.5 font-semibold hover:border-pink-300/60">Save stop point</button>
      <button disabled={saving} onClick={() => save(true)} className="rounded-full border border-pink-300/30 px-3 py-1.5 font-semibold hover:border-pink-300/60">Finished the chapter</button>
    </div>
  );
}

/** The next lesson stays small: its name, where it's at, and a "View plan" button that opens the full plan. */
function NextLesson(props: { lesson: any; busy: boolean; onPrepare: (id: number) => void; next: Summary["next"]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const { lesson, next } = props;
  if (!lesson) return <div className="glass p-5 text-pink-200/70">Every lesson is taught.</div>;
  const passed = String(lesson.verdict || "").toLowerCase().startsWith("pass");
  const state = !lesson.plan ? "Not prepared yet" : next?.approved ? "Approved" : passed ? "Examiner passed · waiting for your approval" : lesson.verdict || "Checking";
  return (
    <div className="grid gap-3">
      <div className="glass flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <b className="block truncate text-body">{splitTitle(lesson.title).name}</b>
          <span className="text-label text-pink-200/70">{next?.continues_from ? `Picks up from ${next.continues_from} · ` : ""}{state}</span>
        </div>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(230,25,127,.75)]">
          {open ? "Hide plan" : "View plan"}<span className={cn("transition-transform", open && "rotate-90")}>{Icon.arrow}</span></button>
      </div>
      {open && <PlanCard {...props} />}
    </div>
  );
}

function PlanCard({ lesson, busy, onPrepare, next, onChanged }: { lesson: any; busy: boolean; onPrepare: (id: number) => void; next: Summary["next"]; onChanged: () => void }) {
  const [pas, setPas] = useState<any>(null);
  const [approving, setApproving] = useState(false);
  if (!lesson) return <div className="glass p-5 text-pink-200/70">Every lesson is taught.</div>;
  if (!lesson.plan) {
    return (
      <div className="glass flex flex-col gap-4 p-5">
        {next?.continues_from && <p className="text-sm text-pink-200/80">Picks up from <b>{next.continues_from}</b>, where the last class stopped.</p>}
        <Handoff />
        <p className="text-pink-200/75">Not prepared yet. The Librarian finds the passages, the Subject Teacher drafts and the Examiner checks every line against the notes.</p>
        <div><ShimmerButton disabled={busy} onClick={() => onPrepare(lesson.id)} className="gap-2 px-5 py-2.5 font-semibold" background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">{busy ? "The staff are working…" : "Prepare it now"}</ShimmerButton></div>
      </div>
    );
  }
  const items = new Map<string, any>(((lesson.review || {}).items || []).map((it: any) => [it.text, it]));
  // Start from the stop point: keep lines whose cited passages sit at or after the section the class stopped in.
  const order = next?.sections || [];
  const from = next?.continues_from ? order.indexOf(next.continues_from) : -1;
  const secOf = (n: number) => { const p = (lesson.passages || []).find((x: any) => x.n === n); return p ? String(p.section || "").replace(/^KT\d+\s*/, "") : ""; };
  const fromHere = (t: string) => from < 0 || [...t.matchAll(/\[P(\d+)\]/g)].some((m) => order.indexOf(secOf(Number(m[1]))) >= from);
  const lines: string[] = [...(lesson.plan.objectives || []), ...(lesson.plan.explanation || [])].filter(fromHere).slice(0, 8);
  const approve = async () => { setApproving(true); try { await api(`/api/lessons/${lesson.id}/approve`, { method: "POST" }); onChanged(); } finally { setApproving(false); } };
  const passed = String(lesson.verdict || "").toLowerCase().startsWith("pass");
  const cite = (text: string) => text.split(/(\[P\d+\])/g).map((part, i) => {
    const m = /^\[P(\d+)\]$/.exec(part);
    if (!m) return <span key={i}>{part}</span>;
    const n = Number(m[1]);
    return <button key={i} onClick={() => setPas((lesson.passages || []).find((x: any) => x.n === n))}
      className="mx-0.5 rounded-md border border-pink-400/50 bg-pink-600/25 px-1.5 font-mono text-[11.5px] font-bold text-pink-100 hover:bg-pink-600/45">P{n}</button>;
  });
  return (
    <SpotlightCard className="flex flex-col gap-4 p-5">
      {createPortal(<PrintablePlan lesson={lesson} lines={lines} next={next} />, document.body)}
      <div className="no-print"><Handoff /></div>
      {next?.continues_from && <p className="text-sm text-pink-200/80">Picks up from <b>{next.continues_from}</b>, where the last class stopped.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-h3">{splitTitle(lesson.title).name}</h3>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", passed ? "bg-pink-300 text-[#1a0d14]" : "bg-pink-500 text-white")}>
          {passed ? "Examiner passed" : lesson.verdict || "Checking"}{lesson.examiner_rounds ? ` · ${lesson.examiner_rounds} send-backs` : ""}
        </span>
      </div>
      <ul className="grid gap-2.5">
        {lines.map((t) => {
          const it = items.get(t), ok = !it || String(it.verdict || "").startsWith("Supported");
          const txt = t.length > 170 ? t.slice(0, 167).replace(/\s+\S*$/, "") + "… " + ((t.match(/\[P\d+\]\s*$/) || [""])[0]) : t;
          return (
            <li key={t} className="grid grid-cols-[24px_1fr] items-start gap-2.5 text-[14.5px]">
              <span title={it?.reason || "Checked"} className={cn("grid size-[22px] place-items-center rounded-[7px] border",
                ok ? "border-pink-300/50 bg-pink-300/15 text-pink-200 shadow-[0_0_10px_-3px_#ff9ccb]" : "hatch border-dashed border-grey bg-zinc-800 text-pink-100")}>{ok ? Icon.check : Icon.clock}</span>
              <span>{cite(txt)}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap justify-between gap-2 text-[13px] text-pink-200/70">
        <span>{(lesson.passages || []).length} passages from the notes · every line ticked against its source</span>
        <a className="no-print text-pink-300 underline-offset-4 hover:underline" href="/staffroom#plan">Review in Staffroom</a>
      </div>
      <div className="no-print flex flex-wrap items-center gap-2.5">
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold hover:border-pink-300/60">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2" /><rect x="6" y="14" width="12" height="7" /></svg>Print plan</button>
        {next?.approved
          ? <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-300 px-3 py-1.5 text-sm font-semibold text-[#1a0d14]">{Icon.check} Approved{next.approved_at ? ` · ${fmtDate(next.approved_at)}` : ""}</span>
          : <button disabled={approving} onClick={approve} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-4 py-2 text-sm font-semibold text-white">{Icon.check} Approve plan</button>}
      </div>
      <RecordProgress next={next} onChanged={onChanged} />
      <Modal open={!!pas} title={pas ? `P${pas.n} · ${pas.where}` : ""} onClose={() => setPas(null)} primary={{ label: "Close", onClick: () => setPas(null) }}>
        <p className="max-h-[50vh] overflow-auto text-left text-pink-100/90">{pas?.text}</p>
      </Modal>
    </SpotlightCard>
  );
}

export function Lanes({ learners }: { learners: Learner[] }) {
  const ls = [...learners].sort((a, b) => b.levels - a.levels || b.xp - a.xp);
  if (!ls.length) return <div className="py-5 text-pink-200/70">No learners yet. Share the student game and they appear here as they climb.</div>;
  const top = Math.max(10, ...ls.map((l) => l.levels));
  return (
    <>
      {ls.map((l, i) => {
        const w = `${(100 * l.levels) / top}%`;
        return (
          <div key={l.id} className="grid grid-cols-[1fr_64px] items-center gap-x-3 gap-y-2 border-t border-pink-300/10 py-3.5 first:border-t-0 sm:grid-cols-[160px_1fr_80px] sm:gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-pink-900 text-xs font-bold text-white">{initials(l.name)}</span>
              <b className="truncate font-semibold">{l.name.replace(" (sample)", "")}</b>
              {l.sample && <span className="rounded-full border border-pink-300/20 px-1.5 text-[11px] text-pink-200/70">sample</span>}
            </div>
            <div className="relative col-span-2 row-start-2 h-3 rounded-full bg-white/5 sm:col-span-1 sm:row-start-auto" style={{ backgroundImage: "repeating-linear-gradient(90deg,transparent 0 calc(10% - 1px),rgba(255,170,210,.1) calc(10% - 1px) 10%)" }}>
              <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-zinc-500/30 via-zinc-400 to-pink-400"
                initial={{ width: 0 }} whileInView={{ width: w }} viewport={{ once: true }} transition={{ duration: 1.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }} />
              <motion.div className="absolute top-1/2 -ml-[11px] -mt-[11px] size-[22px] rounded-full bg-white shadow-[0_0_0_4px_rgba(255,61,154,.3),0_0_22px_rgba(255,61,154,.75)]"
                initial={{ left: 0 }} whileInView={{ left: w }} viewport={{ once: true }} transition={{ duration: 1.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }} />
            </div>
            <div className="text-right font-mono text-[15px] font-bold"><NumberTicker value={l.levels} /> lv
              <small className="block font-sans text-[11.5px] font-medium text-pink-200/70"><NumberTicker value={l.xp} /> XP</small></div>
          </div>
        );
      })}
    </>
  );
}

export function Checks({ learners }: { learners: Learner[] }) {
  const out: { l: Learner; why: string; ev: string; sev: number }[] = [];
  for (const l of learners) {
    const acc = l.answered ? l.correct / l.answered : null;
    let why = "", ev = "", sev = 0;
    if (l.sure_wrong >= 3) { why = `Confidently wrong ${l.sure_wrong} times`; ev = `Said “Certain” and missed it. ${l.sure_right} certain answers were right.`; sev = Math.min(1, l.sure_wrong / 10); }
    if (acc !== null && acc < 0.6 && l.answered >= 5) { why = `Getting ${Math.round(100 * (1 - acc))}% wrong`; ev = `${l.correct} of ${l.answered} answers right${l.levels ? `, ${l.levels} levels cleared` : ", no level cleared yet"}.`; sev = 1 - acc; }
    else if (l.answered >= 5 && l.levels === 0) { why = "Stuck on the first rung"; ev = `${l.answered} answers, no level cleared.`; sev = 0.7; }
    if (why) out.push({ l, why, ev, sev });
  }
  out.sort((a, b) => b.sev - a.sev);
  if (!out.length) return <div className="glass p-5 text-pink-200/75">Nobody needs a check right now.</div>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
      {out.slice(0, 6).map((c) => (
        <SpotlightCard key={c.l.id} className="grid gap-3 p-[18px]">
          <div className="flex items-center gap-2.5">
            <span className="grid size-[30px] place-items-center rounded-full bg-gradient-to-br from-pink-700 to-zinc-800 text-xs font-bold text-white">{initials(c.l.name)}</span>
            <b>{c.l.name.replace(" (sample)", "")}</b>{c.l.sample && <span className="rounded-full border border-pink-300/20 px-1.5 text-[11px] text-pink-200/70">sample</span>}
          </div>
          <div className="text-[14.5px]">{c.why}</div>
          <div className="h-1.5 overflow-hidden rounded bg-white/5"><motion.i className="block h-full rounded bg-gradient-to-r from-pink-900 to-pink-400"
            initial={{ width: 0 }} whileInView={{ width: `${Math.round(100 * c.sev)}%` }} viewport={{ once: true }} transition={{ duration: 1.2 }} /></div>
          <div className="text-[13px] text-pink-200/70">{c.ev}</div>
        </SpotlightCard>
      ))}
    </div>
  );
}

/** A plain copy of the plan that only exists on paper: black on white, one page, sources listed. */
function PrintablePlan({ lesson, lines, next }: { lesson: any; lines: string[]; next: Summary["next"] }) {
  const cited = new Set(lines.flatMap((t) => [...t.matchAll(/\[P(\d+)\]/g)].map((m) => Number(m[1]))));
  return (
    <div id="print-root">
      <h1>Lesson plan: {splitTitle(lesson.title).name}</h1>
      <p className="meta">{splitTitle(lesson.title).mod} {splitTitle(lesson.title).kt} · {fmtDate(lesson.planned_date)} · {lesson.minutes || 90} min
        {next?.continues_from ? ` · picks up from ${next.continues_from}` : ""} · Examiner: {lesson.verdict || "checked"}{next?.approved ? " · Approved by the teacher" : " · Draft"}</p>
      <h2>Objectives and explanation</h2>
      <ol>{lines.map((t) => <li key={t}>{t}</li>)}</ol>
      {lesson.plan.worked_example && <><h2>Worked example</h2><p>{lesson.plan.worked_example}</p></>}
      {lesson.plan.activity && <><h2>Activity</h2><p>{lesson.plan.activity}</p></>}
      <h2>Sources from the course notes</h2>
      <ul className="src">{(lesson.passages || []).filter((p: any) => cited.has(p.n)).map((p: any) => <li key={p.n}>[P{p.n}] {p.where}</li>)}</ul>
    </div>
  );
}
