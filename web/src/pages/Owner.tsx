/* Owner: the whole school at a glance. Melsoft is live data; the other courses are labelled demo figures. */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, fmtDate, melsoftCourse, type Board, type Pacing } from "@/lib/api";
import { School } from "@/lib/school";
import { Icon, NumberTicker, SpotlightCard, StatusPill, STATUS_WORD, type Status } from "@/components/ui/kit";
import { ShimmerButton } from "@/components/ui/shimmer-button";

type CourseRow = { title: string; teacher: string; status: Status; students: number; risk: number; real?: boolean; reason?: string; action?: string };
const DEMO: CourseRow[] = [
  { title: "Software Development NQF5", teacher: "T. Mokoena", status: "ok", students: 32, risk: 2 },
  { title: "Data Analytics", teacher: "R. Naidoo", status: "ok", students: 26, risk: 1 },
  { title: "Network Engineering", teacher: "S. Dlamini", status: "risk", students: 24, risk: 5, reason: "3 lessons behind the timetable since the long weekend", action: "Add a catch-up slot" },
  { title: "Cloud Fundamentals", teacher: "L. Botha", status: "ok", students: 30, risk: 1 },
  { title: "UX Design", teacher: "K. Pillay", status: "ok", students: 18, risk: 0 },
  { title: "IT Support A+", teacher: "M. Khumalo", status: "ok", students: 28, risk: 3, reason: "6 learners quiet in the last two classes", action: "Message the facilitator" },
  { title: "Business Analysis", teacher: "P. van Wyk", status: "ok", students: 21, risk: 2 },
];
const rise = (i: number) => ({ initial: { opacity: 0.85, y: 10 }, animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] as const } });

export default function Owner() {
  const [data, setData] = useState<{ courses: CourseRow[]; pacing: Pacing; title: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const c = await melsoftCourse();
      if (!c) throw new Error("No course with notes yet");
      const [st, board] = await Promise.all([api<any>(`/api/state/${c.id}`), api<Board>(`/api/ft/${c.id}/board`)]);
      const p: Pacing = st.pacing;
      const risk = board.learners.filter((l) => (l.answered >= 5 && l.correct / l.answered < 0.6) || l.sure_wrong >= 3).length;
      const real: CourseRow = { title: st.course.title, teacher: st.course.teacher || "Facilitator", real: true,
        status: p.shortfall ? "late" : p.behind_schedule ? "risk" : "ok", students: board.learners.length, risk,
        reason: p.shortfall ? `${p.shortfall} lessons land after the exam on ${fmtDate(p.exam_date)}` : undefined, action: "Re-plan the term" };
      setData({ courses: [real, ...DEMO], pacing: p, title: st.course.title });
    })().catch((e) => setErr(String(e.message || e)));
  }, []);

  if (err) return <div className="glass p-6">Couldn't load the school: {err}</div>;
  if (!data) return <div className="py-6 text-pink-200/70">Walking the corridors…</div>;

  const { courses } = data;
  const onTrack = courses.filter((c) => c.status === "ok").length;
  const atRisk = courses.reduce((s, c) => s + c.risk, 0);
  const students = courses.reduce((s, c) => s + c.students, 0);
  const attention = courses.filter((c) => c.reason).sort((a, b) => (a.status === "late" ? -1 : 0) - (b.status === "late" ? -1 : 0) || b.risk - a.risk);
  attention.push({ title: "Whole school", teacher: "Admissions", status: "risk", students: 0, risk: atRisk,
    reason: `${atRisk} learners show drop-out signals: quiet, failing or absent`, action: "Open the list" });

  return (
    <>
      <section className="grid items-center gap-6 lg:grid-cols-[1.5fr_1fr]">
        <motion.div {...rise(0)} className="min-w-0">
          <p className="eyebrow">Whole school</p>
          <h1 className="mt-3 text-display [text-wrap:balance]">
            {onTrack} of {courses.length} courses will finish before their exams.
          </h1>
          <SpotlightCard className="mt-6 px-3.5 pb-3 pt-5">
            <School id="ownSchool" columns={courses.map((c) => c.status)} className="[filter:drop-shadow(0_0_6px_rgba(255,61,154,.4))]" />
            <div className="relative mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px] text-pink-200/80 sm:grid-cols-4">
              {courses.map((c) => (
                <span key={c.title} className="flex min-w-0 items-center gap-1.5" title={`${c.title}: ${STATUS_WORD[c.status]}`}>
                  <StatusPill s={c.status} label={false} /><span className="truncate">{c.title}</span>
                </span>
              ))}
            </div>
          </SpotlightCard>
        </motion.div>
        <motion.div {...rise(1)} className="min-w-0">
          <div className="glass grid grid-cols-2 gap-px overflow-hidden">
            {[
              { v: onTrack, suffix: `/${courses.length}`, label: "courses on track" },
              { v: atRisk, label: `students at risk, of ${students}`, tone: "text-pink-300" },
              { v: 46, suffix: " h", label: "teacher hours the agents saved this month", tone: "text-pink-100" },
              { v: 81, suffix: "%", label: "forecast pass rate" },
            ].map((k, i) => (
              <div key={i} className="bg-[#0c0b0e]/60 px-5 pb-4 pt-5">
                <b className={`stat block ${k.tone || ""}`}>
                  <NumberTicker value={k.v} delay={0.2 + i * 0.1} />{k.suffix && <small className="text-[0.5em] text-pink-200/60">{k.suffix}</small>}
                </b>
                <span className="mt-2 block text-label text-pink-200/80">{k.label}</span>
              </div>
            ))}
            <div className="col-span-2 bg-[#0c0b0e]/60 px-5 pb-4 pt-5">
              <b className="stat block text-pink-300">
                <small className="text-[0.5em] text-pink-200/60">R </small><NumberTicker value={atRisk * 14500} delay={0.6} />
              </b>
              <span className="mt-2 block text-label text-pink-200/80">fees at risk from likely drop-outs (R14 500 each)</span>
            </div>
          </div>
          <p className="mt-3 text-label text-pink-200/65">{data.title} is live data. The other {DEMO.length} courses, hours saved and pass rate are demo figures.</p>
        </motion.div>
      </section>

      <motion.section {...rise(2)} className="mt-12 md:mt-[72px]">
        <h2 className="text-h2">Needs your attention</h2>
        <p className="mt-2 text-body text-pink-200/75">Ranked by what costs the school most if nobody acts this week.</p>
        <div className="mt-4 grid gap-2.5">
          {attention.map((c, i) => (
            <SpotlightCard key={c.title} className="grid grid-cols-[34px_1fr] items-center gap-3.5 px-4 py-3.5 sm:grid-cols-[34px_1fr_auto]">
              <span className="grid size-[30px] place-items-center rounded-lg border border-pink-400/45 bg-pink-600/25 font-mono text-[13px] font-bold">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><b className="font-semibold">{c.title}</b><StatusPill s={c.status} />
                  {c.real && <span className="rounded-full border border-pink-300/50 bg-pink-300/15 px-2 py-0.5 text-xs font-semibold">live</span>}</div>
                <div className="mt-0.5 text-[13.5px] text-pink-200/80">{c.reason} · {c.teacher}</div>
              </div>
              <div className="col-start-2 sm:col-start-auto">
                {c.real ? (
                  <a href="#/class"><ShimmerButton className="gap-2 px-4 py-2 text-sm font-semibold" background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">{c.action}{Icon.arrow}</ShimmerButton></a>
                ) : (
                  <button className="rounded-full border border-pink-300/25 bg-white/5 px-4 py-2 text-sm font-semibold hover:border-pink-300/50">{c.action}</button>
                )}
              </div>
            </SpotlightCard>
          ))}
        </div>
      </motion.section>
    </>
  );
}
