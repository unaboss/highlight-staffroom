/* Watch a lesson plan being written, checked and corrected, live.
   The plan document fills line by line with its [P#] citations; the Examiner turns a line red when its
   citation doesn't back it, the Subject Teacher rewrites it (before -> after) and the Examiner re-checks.
   Beside it, the agent cycle as nodes with a beam on the active hand-off; a send-back is a red beam going
   backwards. Driven by GET /api/agents/run/{job}/stream (server-sent events). */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { Thinking } from "@/components/ui/loading";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type RunEvent = { id: number; job_id: number; ts: string; agent: string; kind: string; message: string; data: any };
export type LessonPlan = {
  title: string; objectives: string[]; explanation: string[]; worked_example: string; activity: string;
  check_questions: { q: string; answer: string }[]; gaps: string[];
};
export type AgentRunProps = {
  lessonId?: number;           // the lesson to prepare; omitted = the course's next planned lesson
  jobId?: number;              // watch (or replay) a run that already started
  autoStart?: boolean;         // start the prepare job on mount
  demo?: boolean;              // force the scripted demo (one seeded ungrounded line)
  onDone?: (plan: LessonPlan | null, result: any) => void;
  className?: string;
};

type LineState = "drafted" | "ok" | "caught" | "sent" | "fixing" | "fixed" | "still" | "removed";
type Line = { id: string; section: string; text: string; state: LineState; reason?: string; before?: string; after?: string; grounding?: number };
type NodeKey = "principal" | "librarian" | "teacher" | "examiner" | "approve";

const NODES: { key: NodeKey; label: string; role: string }[] = [
  { key: "principal", label: "Principal", role: "assigns the lesson" },
  { key: "librarian", label: "Librarian", role: "finds the passages" },
  { key: "teacher", label: "Subject Teacher", role: "drafts and rewrites" },
  { key: "examiner", label: "Examiner", role: "checks every citation" },
  { key: "approve", label: "You", role: "approve the plan" },
];
const AGENT_NODE: Record<string, NodeKey> = {
  Principal: "principal", Librarian: "librarian", "Subject Teacher": "teacher", Examiner: "examiner", Staffroom: "principal", ClickUp: "principal",
};
const SECTION: Record<string, string> = { objective: "Objectives", explanation: "Key ideas", example: "Worked example", question: "Check questions" };
const PACE = 380;              // ms between steps on replay

/** Apply one event to the run state. Pure, so live and replay share it. */
function reduce(s: RunState, ev: RunEvent): RunState {
  const d = ev.data || {};
  const lines = s.lines.slice();
  const at = (id: string) => lines.findIndex((l) => l.id === id);
  const put = (id: string, patch: Partial<Line>) => { const i = at(id); if (i >= 0) lines[i] = { ...lines[i], ...patch }; };
  let { caught, fixed, edge, done, result } = s;
  const node = AGENT_NODE[ev.agent] ?? s.node;
  if (node !== s.node) edge = { from: s.node, to: node, back: false };
  switch (ev.kind) {
    case "drafted": lines.push({ id: d.id, section: d.section, text: d.line, state: "drafted" }); break;
    case "checked": put(d.id, { state: d.supported ? "ok" : "drafted", grounding: d.grounding, reason: d.reason }); break;
    case "caught": caught += 1; put(d.id, { state: "caught", reason: d.reason, grounding: d.grounding }); break;
    case "handoff":
      if (d.sent_back) { (d.ids || []).forEach((id: string) => put(id, { state: "sent" })); edge = { from: "examiner", to: "teacher", back: true }; }
      break;
    case "rewritten": put(d.id, { state: "fixing", before: d.before, after: d.after, text: d.after }); break;
    case "rechecked":
      if (d.supported) fixed += 1;
      put(d.id, { state: d.supported ? "fixed" : "still", reason: d.supported ? undefined : d.reason, grounding: d.grounding });
      break;
    case "warn": if (d.id && d.before) put(d.id, { state: "removed" }); break;
    case "done":
      if (ev.agent === "Staffroom") { done = "done"; result = d.result || null; edge = { from: "principal", to: "approve", back: false }; }
      break;
    case "error": if (ev.agent === "Staffroom") done = "error"; break;
  }
  if (ev.kind === "checked" || ev.kind === "rechecked") edge = { from: "teacher", to: "examiner", back: false };
  return { lines, caught, fixed, edge, done, result, node: done === "done" ? "approve" : node, last: ev,
           log: [...s.log, ev].slice(-200) };
}

type RunState = {
  lines: Line[]; caught: number; fixed: number; node: NodeKey; edge: { from: NodeKey; to: NodeKey; back: boolean } | null;
  done: "" | "done" | "error"; result: any; last: RunEvent | null; log: RunEvent[];
};
const EMPTY: RunState = { lines: [], caught: 0, fixed: 0, node: "principal", edge: null, done: "", result: null, last: null, log: [] };

export default function AgentRun({ lessonId, jobId, autoStart = false, demo, onDone, className }: AgentRunProps) {
  const [job, setJob] = useState<number | null>(jobId ?? null);
  const [st, setSt] = useState<RunState>(EMPTY);
  const [phase, setPhase] = useState<"idle" | "starting" | "live" | "replay" | "done">("idle");
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState<{ demo?: boolean; notice?: string | null; online?: boolean }>({});
  const recorded = useRef<RunEvent[]>([]);
  const es = useRef<EventSource | null>(null);
  const timer = useRef<number | null>(null);
  const doneSent = useRef(false);

  const stop = () => { es.current?.close(); es.current = null; if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stop, []);

  const watch = useCallback((id: number) => {
    stop();
    recorded.current = []; doneSent.current = false;
    setSt(EMPTY); setPhase("live"); setErr("");
    const src = new EventSource(`/api/agents/run/${id}/stream`);
    es.current = src;
    src.onmessage = (m) => {
      const ev = JSON.parse(m.data) as RunEvent;
      recorded.current.push(ev);
      setSt((s) => reduce(s, ev));
    };
    src.addEventListener("end", () => { src.close(); es.current = null; setPhase("done"); });
    src.onerror = () => { if (src.readyState === EventSource.CLOSED) { setErr("The live stream closed."); setPhase("done"); } };
  }, []);

  const start = useCallback(async () => {
    stop(); setPhase("starting"); setErr(""); setSt(EMPTY);
    try {
      const r = await api<{ job_id: number; demo: boolean; notice: string | null; online: boolean }>("/api/agents/run",
        { json: { lesson_id: lessonId ?? null, demo: !!demo } });
      setMeta(r); setJob(r.job_id);
      watch(r.job_id);
    } catch (e: any) { setErr(e.message || String(e)); setPhase("idle"); }
  }, [lessonId, demo, watch]);

  const replay = useCallback(() => {
    const evs = recorded.current.slice();
    if (!evs.length) { if (job) watch(job); return; }
    stop(); setSt(EMPTY); setPhase("replay");
    let i = 0;
    const step = () => {
      if (i >= evs.length) { setPhase("done"); return; }
      const ev = evs[i++];
      setSt((s) => reduce(s, ev));
      timer.current = window.setTimeout(step, ["drafted", "checked"].includes(ev.kind) ? PACE / 2 : PACE);
    };
    step();
  }, [job, watch]);

  useEffect(() => {
    if (jobId) { setJob(jobId); watch(jobId); }
    else if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, autoStart]);

  useEffect(() => {
    if (st.done === "done" && phase !== "replay" && !doneSent.current) {
      doneSent.current = true;
      onDone?.(st.result?.plan ?? null, st.result);
    }
  }, [st.done, st.result, phase, onDone]);

  const running = phase === "starting" || phase === "live" || phase === "replay";
  const verdict = st.result?.verdict as string | undefined;
  return (
    <section className={cn("rounded-2xl border border-pink-300/20 bg-[#120f15]/90 p-4 text-pink-100 md:p-6", className)} aria-label="Live agent run">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight">Watch the plan being written</h2>
          <p className="text-sm text-pink-200/65">Every line carries a [P#] citation. The Examiner checks each one against the notes; anything the notes don't back goes back to the Subject Teacher.</p>
        </div>
        <Badge caught={st.caught} fixed={st.fixed} />
        <div className="flex gap-2">
          {(phase === "done" || phase === "replay") && recorded.current.length > 0 && (
            <button onClick={replay} disabled={phase === "replay"} className="rounded-full border border-pink-300/35 px-3.5 py-1.5 text-sm font-semibold hover:bg-pink-500/10 disabled:opacity-40">Replay</button>
          )}
          <button onClick={start} disabled={running}
            className="rounded-full bg-pink-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-pink-400 disabled:opacity-40">
            {phase === "idle" ? "Prepare the lesson" : "Run again"}
          </button>
        </div>
      </header>
      {meta.notice && <p className="mb-3 text-xs text-pink-200/60">{meta.notice}</p>}
      {meta.demo && phase !== "idle" && <p className="mb-3 text-xs text-pink-200/50">Demo run: the first draft carries one plausible line the notes don't support, so you can see it caught and fixed.</p>}
      {err && <p role="alert" className="mb-3 text-sm text-red-300">{err}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <PlanDoc st={st} running={running} phase={phase} />
        <div className="flex flex-col gap-4">
          <Cycle node={st.node} edge={st.edge} active={running} message={st.last?.message} />
          {running && <Thinking who={st.last?.agent || "The Principal"} doing={doingFor(st.last)} steps={st.log.slice(-4).map((e) => `${e.agent}: ${e.message}`)} />}
          {st.done === "done" && (
            <p className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
              {verdict === "Passed" ? "Every line is backed by the notes. The plan is ready for your approval." : `Plan ${String(verdict || "").toLowerCase()}: check the flagged lines before approving.`}
            </p>
          )}
          {st.done === "error" && <p role="alert" className="text-sm text-red-300">{st.last?.message}</p>}
        </div>
      </div>
    </section>
  );
}

function doingFor(ev: RunEvent | null): string {
  if (!ev) return "starting the run";
  const k = ev.kind;
  if (k === "drafted") return "writing the plan";
  if (k === "checked" || k === "reject" || k === "pass") return "checking each citation";
  if (k === "caught") return "catching a line the notes don't back";
  if (k === "handoff") return "handing over";
  if (k === "rewritten") return "rewriting from the cited passage";
  if (k === "rechecked") return "re-checking the rewrite";
  return "working";
}

function Badge({ caught, fixed }: { caught: number; fixed: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold tabular-nums",
      caught ? "border-pink-300/40 bg-pink-500/10" : "border-pink-300/20 text-pink-200/70")} aria-live="polite">
      <span className="text-red-300">Caught {caught}</span><span aria-hidden className="text-pink-200/40">·</span><span className="text-emerald-300">Fixed {fixed}</span>
    </span>
  );
}

/** "text [P3]" with the citation as a chip. */
function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[P\d+\])/g).filter(Boolean);
  return <>{parts.map((p, i) => /^\[P\d+\]$/.test(p)
    ? <span key={i} className="ml-1 rounded bg-pink-100 px-1.5 py-0.5 align-[1px] font-mono text-[11px] font-semibold text-pink-700">{p.slice(1, -1)}</span>
    : <span key={i}>{p}</span>)}</>;
}

function PlanDoc({ st, running, phase }: { st: RunState; running: boolean; phase: string }) {
  const reduceMotion = useReducedMotion();
  const doc = useRef<HTMLElement>(null);
  // a fixed-height page: while the staff write, it follows the newest line; afterwards you scroll it
  useEffect(() => { if (running && doc.current) doc.current.scrollTo({ top: doc.current.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" }); }, [st.lines.length, running, reduceMotion]);
  const groups = ["objective", "explanation", "example", "question"].map((k) => [k, st.lines.filter((l) => l.section === k)] as const).filter(([, ls]) => ls.length);
  return (
    <article ref={doc} className="h-[62svh] min-h-[320px] overflow-y-auto overscroll-contain rounded-xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-[0_20px_50px_-24px_rgba(0,0,0,.6)] md:p-5" aria-label="Lesson plan draft">
      <h3 className="mb-3 text-[15px] font-semibold text-zinc-900">{st.result?.plan?.title || "Lesson plan"}</h3>
      {!st.lines.length && (phase === "idle"
        ? <p className="text-sm text-zinc-500">Press <b>Prepare the lesson</b> to watch the staff write the next plan.</p>
        : running ? <p className="text-sm text-zinc-500">The Librarian is finding the passages for this lesson…</p> : null)}
      <div className="grid gap-4">
        {groups.map(([k, ls]) => (
          <div key={k}>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-pink-700">{SECTION[k] || k}</div>
            <ul className="grid gap-1.5">
              <AnimatePresence initial={false}>
                {ls.map((l) => (
                  <motion.li key={l.id} layout={!reduceMotion}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className={cn("rounded-lg border px-3 py-2 text-[14px] leading-relaxed transition-colors duration-300",
                      l.state === "caught" || l.state === "sent" || l.state === "still" ? "border-red-300 bg-red-50" :
                      l.state === "fixed" ? "border-emerald-300 bg-emerald-50" :
                      l.state === "fixing" ? "border-amber-300 bg-amber-50" :
                      l.state === "removed" ? "border-zinc-200 opacity-50 line-through" : "border-transparent bg-zinc-50")}>
                    {l.before && l.after ? (
                      <div className="grid gap-1">
                        <div className="text-red-700/80 line-through decoration-red-500/70"><Cited text={l.before} /></div>
                        <div className="flex gap-2"><span aria-hidden className="text-pink-600">→</span><span className="text-zinc-900"><Cited text={l.after} /></span></div>
                      </div>
                    ) : <Cited text={l.text} />}
                    <LineNote l={l} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        ))}
      </div>
    </article>
  );
}

function LineNote({ l }: { l: Line }) {
  const tag = (cls: string, children: ReactNode) => <div className={cn("mt-1 text-xs", cls)}>{children}</div>;
  if (l.state === "caught") return tag("text-red-700", <>Examiner: {l.reason}</>);
  if (l.state === "sent") return tag("text-red-700", <>Sent back to the Subject Teacher. {l.reason}</>);
  if (l.state === "fixing") return tag("text-amber-700", "Rewritten from the cited passage. Re-checking…");
  if (l.state === "fixed") return tag("text-emerald-700", <>✓ Re-checked: supported{l.grounding != null ? ` (${Math.round(l.grounding * 100)}% grounded)` : ""}</>);
  if (l.state === "still") return tag("text-red-700", <>Still not supported: {l.reason}</>);
  if (l.state === "ok") return tag("text-emerald-700/80", "✓ supported");
  return null;
}

function Cycle({ node, edge, active, message }: { node: NodeKey; edge: RunState["edge"]; active: boolean; message?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const refs: Record<NodeKey, RefObject<HTMLDivElement | null>> = {
    principal: useRef<HTMLDivElement>(null), librarian: useRef<HTMLDivElement>(null), teacher: useRef<HTMLDivElement>(null),
    examiner: useRef<HTMLDivElement>(null), approve: useRef<HTMLDivElement>(null),
  };
  const EDGES: [NodeKey, NodeKey, number][] = [
    ["principal", "librarian", 0], ["librarian", "teacher", 0], ["teacher", "examiner", 0], ["examiner", "principal", 0], ["principal", "approve", 0],
  ];
  const on = (a: NodeKey, b: NodeKey) => !!edge && ((edge.from === a && edge.to === b) || (edge.from === b && edge.to === a));
  return (
    <div ref={box} className="relative grid gap-3 rounded-xl border border-pink-300/15 bg-black/20 p-4" aria-label="Agent cycle">
      {NODES.map((n) => {
        const live = node === n.key;
        return (
          <div key={n.key} ref={refs[n.key]}
            className={cn("relative z-10 rounded-xl border px-3 py-2 transition-all duration-300",
              n.key === "examiner" || n.key === "librarian" ? "ml-10" : n.key === "teacher" ? "ml-5" : "",
              live ? "border-pink-300/70 bg-[#2a1220] shadow-[0_0_24px_-4px_rgba(255,61,154,.65)]" : "border-pink-300/15 bg-[#151117]")}>
            <div className="text-sm font-semibold">{n.label}</div>
            <div className="truncate text-xs text-pink-200/60">{live && active && message ? message : n.role}</div>
          </div>
        );
      })}
      {EDGES.map(([a, b]) => (
        <AnimatedBeam key={`${a}-${b}`} containerRef={box} fromRef={refs[a]} toRef={refs[b]} curvature={0} duration={1.6}
          pathColor="#f9a8d4" pathOpacity={0.12}
          gradientStartColor={on(a, b) && !edge?.back ? "#ff3d9a" : "transparent"}
          gradientStopColor={on(a, b) && !edge?.back ? "#ffd1e8" : "transparent"} />
      ))}
      {/* the send-back: Examiner -> Subject Teacher, red, running backwards */}
      <AnimatedBeam containerRef={box} fromRef={refs.teacher} toRef={refs.examiner} curvature={-40} reverse duration={1.2}
        startXOffset={60} endXOffset={60} pathColor="#f87171" pathOpacity={edge?.back ? 0.35 : 0}
        gradientStartColor={edge?.back ? "#ef4444" : "transparent"} gradientStopColor={edge?.back ? "#fca5a5" : "transparent"} />
    </div>
  );
}
