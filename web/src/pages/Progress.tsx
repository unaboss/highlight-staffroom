/* Show progress (dev note 39): opened from the Covered so far card. The road to the exam, three pace lines
   (the pace needed to finish before the exam, the class's actual pace, the average learner's own pace)
   and a Counsellor button that suggests what to do next to move forward. */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, fmtDate, melsoftCourse } from "@/lib/api";
import { Icon, NumberTicker } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { PrepTimeline, Section, rise } from "@/components/prep-parts";
import { BusyButton, LoadError, PageLoader, Thinking } from "@/components/ui/loading";
import type { CatchUp, Point, Prep, ProgressLines } from "@/lib/prep";

export default function Progress() {
  const [cid, setCid] = useState<number | null>(null);
  const [prep, setPrep] = useState<Prep | null>(null);
  const [lines, setLines] = useState<ProgressLines | null>(null);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    const c = cid ?? (await melsoftCourse())?.id;
    if (!c) throw new Error("No course with notes yet");
    setCid(c);
    const [p, l] = await Promise.all([api<Prep>(`/api/ft/${c}/prep`), api<ProgressLines>(`/api/ft/${c}/progress`)]);
    setPrep(p);
    setLines(l);
  };
  const retry = () => { load().catch((e) => setErr(String(e.message || e))); };
  useEffect(() => { window.scrollTo(0, 0); retry(); }, []);

  if (err) return <LoadError message={err} onRetry={retry} />;
  if (!prep || !lines || !cid) return <PageLoader label="Working out the class's progress" />;
  const tl = prep.timeline, f = lines.facts;
  const gap = Math.round((f.should_be_pct - f.class_pct) * 10) / 10;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href="#/class" className="inline-flex items-center gap-2 text-sm font-semibold text-pink-300 hover:underline">
          <span className="rotate-180">{Icon.arrow}</span>Back to the class</a>
        <a href="#/class/prep" className="inline-flex items-center gap-2 text-sm font-semibold text-pink-300 hover:underline">View plan{Icon.arrow}</a>
      </div>

      <motion.section {...rise(0)} className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Track progress</div>
          <h1 className="mt-2 text-[clamp(32px,4.4vw,56px)] font-bold leading-[1.05] tracking-[-0.03em] [text-wrap:balance]">
            {gap > 0 ? `${gap} points behind the pace` : "On pace for the exam"}</h1>
          <p className="mt-3 text-body text-pink-200/80">The class is {f.class_pct}% through the notes; by today it needs {f.should_be_pct}% to finish by the exam.
            {f.learner_pct != null ? ` The average learner is at ${f.learner_pct}% on Fast Track.` : ""}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 md:flex-col md:items-end">
          <span className="inline-flex h-9 items-center gap-2 rounded-full border border-pink-300/30 bg-pink-500/10 px-3.5 text-muted font-semibold">
            {Icon.clock}<span className="font-mono"><NumberTicker value={tl.days_to_exam} /></span> days to the exam · {fmtDate(tl.exam_date)}</span>
          <span className="text-label text-pink-200/75">{tl.lessons_left} lessons left across {tl.chapters_left} chapters</span>
        </div>
      </motion.section>

      <Section i={1} title="Pace" lede="How far through the course notes, over time. The dashed line is the steady pace that finishes every passage by the exam.">
        <PaceChart d={lines} />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fig v={`${f.per_class}`} k="passages a class so far" />
          <Fig v={f.needed_per_class != null ? `${f.needed_per_class}` : "–"} k="passages a class needed" />
          <Fig v={`${f.passages_left}`} k="passages left" />
          <Fig v={`${f.classes_left}`} k="class slots before the exam" />
        </div>
      </Section>

      <Section i={2} title="What to do next" lede="Ask the Counsellor for a plan to move forward, worked out from the numbers on this page.">
        <CounsellorPlan cid={cid} />
      </Section>

      <Section i={3} title="Road to the exam" lede="Every chapter still to teach, on the dates the timetable gives it. Click a chapter for its sections and lessons; drag or scroll sideways.">
        <PrepTimeline tl={tl} current={prep.lesson?.id ?? null} />
      </Section>
    </>
  );
}

function Fig({ v, k }: { v: string; k: string }) {
  return <div className="glass min-w-0 p-3.5"><b className="block font-mono text-[22px] font-bold tracking-tight">{v}</b><span className="block text-[12px] text-pink-200/75">{k}</span></div>;
}

/* ------------------------------------------------------------------ the three lines */

const LINES = [
  { key: "needed", label: "Needed to finish by the exam", color: "#a1a1aa", dash: "6 5", width: 2 },
  { key: "class", label: "The class", color: "#ff3d9a", dash: undefined, width: 3 },
  { key: "learners", label: "Average learner (Fast Track)", color: "#ffd1e6", dash: undefined, width: 2 },
] as const;

function PaceChart({ d }: { d: ProgressLines }) {
  const W = 760, H = 300, l = 44, r = 18, t = 18, b = 34;
  const day = (iso: string) => new Date(iso + "T00:00:00").getTime();
  const x0 = day(d.start), x1 = Math.max(day(d.exam_date), day(d.today));
  const x = (iso: string) => l + ((day(iso) - x0) / Math.max(1, x1 - x0)) * (W - l - r);
  const y = (p: number) => t + (1 - p / 100) * (H - t - b);
  const path = (pts: Point[]) => pts.map((p, k) => `${k ? "L" : "M"} ${x(p.date).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(" ");
  const series: Record<string, Point[]> = { needed: d.needed, class: d.class, learners: d.learners };
  const months: string[] = [];
  for (let m = new Date(Number(d.start.slice(0, 4)), Number(d.start.slice(5, 7)), 1); m.getTime() <= x1; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`);     // the 1st of each month after the start
  }
  const last = (pts: Point[]) => pts[pts.length - 1];
  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-pink-300/10 px-4 py-3 text-[12.5px] text-pink-200/85">
        {LINES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} /></svg>{s.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[520px]" role="img"
          aria-label={`Class at ${d.facts.class_pct}% of the notes, ${d.facts.should_be_pct}% needed by today${d.facts.learner_pct != null ? `, average learner at ${d.facts.learner_pct}%` : ""}`}>
          {[0, 25, 50, 75, 100].map((p) => (
            <g key={p}><line x1={l} x2={W - r} y1={y(p)} y2={y(p)} stroke="rgba(255,170,210,.09)" />
              <text x={l - 8} y={y(p) + 4} textAnchor="end" fill="rgba(255,209,230,.6)" fontSize="11">{p}%</text></g>
          ))}
          {months.map((m) => (
            <text key={m} x={x(m)} y={H - 12} fill="rgba(255,209,230,.6)" fontSize="11">
              {new Date(m + "T00:00:00").toLocaleDateString("en-ZA", { month: "short" })}</text>
          ))}
          <line x1={x(d.today)} x2={x(d.today)} y1={t} y2={H - b} stroke="#ff9ccb" strokeDasharray="3 3" />
          <text x={x(d.today) + 4} y={t + 10} fill="#ff9ccb" fontSize="11" fontWeight="700">today</text>
          <line x1={x(d.exam_date)} x2={x(d.exam_date)} y1={t} y2={H - b} stroke="#ff3d9a" strokeWidth="2" />
          <text x={x(d.exam_date) - 4} y={t + 10} textAnchor="end" fill="#ffd1e6" fontSize="11" fontWeight="700">exam {fmtDate(d.exam_date)}</text>
          {LINES.map((s) => {
            const pts = series[s.key];
            if (!pts?.length) return null;
            const e = last(pts);
            return (
              <g key={s.key}>
                <path d={path(pts)} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round"
                  style={s.key === "class" ? { filter: "drop-shadow(0 0 5px rgba(255,61,154,.6))" } : undefined} />
                {s.key !== "needed" && pts.map((p) => <circle key={p.date} cx={x(p.date)} cy={y(p.pct)} r={s.key === "class" ? 3.5 : 2.5} fill={s.color}><title>{`${s.label}: ${p.pct}% on ${fmtDate(p.date)}`}</title></circle>)}
                {s.key !== "needed" && <text x={x(e.date) + 6} y={y(e.pct) + 4} fill={s.color} fontSize="11.5" fontWeight="700">{e.pct}%</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {!d.learners.length && <p className="border-t border-pink-300/10 px-4 py-2.5 text-[12.5px] text-pink-200/65">No learners on the register yet, so there is no learner line.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ the Counsellor */

function CounsellorPlan({ cid }: { cid: number }) {
  const [plan, setPlan] = useState<CatchUp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ask = async () => {
    setBusy(true); setErr("");
    try { setPlan(await api<CatchUp>(`/api/ft/${cid}/progress/plan`, { method: "POST" })); }
    catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="glass grid gap-4 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-pink-700 text-[13px] font-bold text-white">Co</span>
        <div className="min-w-0 flex-1"><b>Counsellor</b><p className="text-[13px] text-pink-200/75">Reads the pace, who is behind and the weak chapters, and suggests what to do next.</p></div>
        <BusyButton onClick={ask} busy={busy} busyLabel="Asking…"
          className="rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(230,25,127,.75)]">
          {plan ? "Ask again" : "Ask the Counsellor"}{Icon.arrow}</BusyButton>
      </div>
      {busy && <Thinking who="The Counsellor" doing="thinking" className="rounded-xl border border-pink-300/15 bg-white/[.03] p-4"
        steps={["Reading the pace lines", "Checking who is behind and the weak chapters", "Writing a plan"]} />}
      {err && !busy && (
        <LoadError message={`The Counsellor couldn't answer: ${err}`} onRetry={ask} />
      )}
      {plan && !busy && (
        <div className="grid gap-3">
          <p className="text-[16px] font-semibold text-pink-50">{plan.headline}</p>
          <ol className="grid gap-2.5">
            {plan.steps.map((s, k) => (
              <li key={k} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-pink-300/12 bg-white/[.03] p-3.5">
                <span className="grid size-7 place-items-center rounded-full bg-pink-300 font-mono text-[13px] font-bold text-[#1a0d14]">{k + 1}</span>
                <div><b className="text-[14.5px]">{s.title}</b><p className="mt-0.5 text-[14px] text-pink-100/85">{s.detail}</p></div>
              </li>
            ))}
          </ol>
          <details className="text-[12.5px] text-pink-200/70">
            <summary className="cursor-pointer">What the Counsellor was given</summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{plan.facts}</pre>
          </details>
          {plan.notice && <p className="text-[12.5px] text-pink-200/80">{plan.notice}</p>}
          <p className={cn("text-[12px]", "text-pink-200/55")}>{plan.online ? `Written by the model (${plan.model}) from these numbers.` : "Worked out in code from these numbers (no model used)."}</p>
        </div>
      )}
    </div>
  );
}
