/* Student landing: the learner's own tower spinning in 3D, then a scroll into the course drawn as a
   tree (7 modules as branches, 79 chapters as leaves), with what to do next on top. Real data from
   /api/ft/{course}/student/{learner}. */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { api, fmtDate, splitTitle } from "@/lib/api";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Icon, confetti } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

type Chap = { topic_id: number; title: string; top: number; quiz: boolean; taught: boolean; state: "mastered" | "covered" | "missed" | "started" | "taught" | "untaught" };
type View = {
  state: "behind" | "ahead" | "done" | "on_track"; percent: number; ahead_by: number; floors: number; due: string | null; queued_status: string | null;
  missed: { topic_id: number; title: string; top: number; minutes: number }[];
  path: { topic_id: number; title: string; top: number; minutes: number }[];
  ready: { topic_id: number; title: string }[]; chapters: Chap[];
};
const FLOOR_HUE = ["#e6197f", "#ff3d9a", "#ff6bb0", "#ff9ccb", "#ffd1e6"];
const short = (t: string) => { const s = splitTitle(t); return s.kt ? `${s.mod} ${s.kt}` : t; };
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}` : `${m} min`);

export default function Landing({ cid, learner, name }: { cid: number; learner: number; name: string }) {
  const [v, setV] = useState<View | null>(null);
  const preview = new URLSearchParams(location.search).get("preview");
  useEffect(() => { api<View>(`/api/ft/${cid}/student/${learner}`).then(setV).catch(() => setV(null)); }, [cid, learner]);
  const view = useMemo(() => {
    if (!v || preview !== "done") return v;
    // Preview only (for demos): show the finished state without changing anyone's results.
    return { ...v, state: "done" as const, percent: 100, missed: [], path: [], floors: 10,
      chapters: v.chapters.map((c) => ({ ...c, state: "mastered" as const, top: 10, quiz: true })) };
  }, [v, preview]);
  if (!view) return <div className="py-6 text-pink-200/70">Building your tower…</div>;
  return (
    <>
      {new URLSearchParams(location.search).get("at") !== "tree" && <Hero v={view} name={name} preview={preview === "done"} />}
      <TreeSection v={view} />
    </>
  );
}

/* ---------------------------------------------------------------- 1. the spinning tower */

function Hero({ v, name, preview }: { v: View; name: string; preview: boolean }) {
  const reduce = useReducedMotion();
  const fired = useRef(false);
  useEffect(() => { if (v.state === "done" && !fired.current) { fired.current = true; setTimeout(() => confetti(true), 600); } }, [v.state]);
  const first = v.path[0];
  const begin = () => { location.hash = first ? `#/play/chapter/${first.topic_id}` : "#/play"; if (!first) document.getElementById("chapters")?.scrollIntoView({ behavior: "smooth" }); };
  const toChapters = () => document.getElementById("chapters")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  const status = v.state === "done" ? <>Course complete. You're exam-ready.</>
    : v.state === "ahead" ? <span className="inline-flex items-center gap-2"><Crown className="size-5 text-pink-200" />Ahead by {v.ahead_by} lesson{v.ahead_by === 1 ? "" : "s"}</span>
    : v.state === "behind" ? <><b className="font-mono text-pink-300">{v.missed.length}</b> chapter{v.missed.length === 1 ? "" : "s"} to catch up</>
    : <>You're keeping pace with the class.</>;
  return (
    <section className="relative -mt-8 flex min-h-[calc(100svh-64px)] flex-col items-center justify-center pb-8 text-center md:-mt-12">
      {preview && <span className="mb-3 rounded-full border border-pink-300/30 px-3 py-1 text-label text-pink-200">Preview: finished state (simulated)</span>}
      <p className="eyebrow">{name.replace(" (sample)", "")}'s tower · {v.floors} floor{v.floors === 1 ? "" : "s"}</p>
      <h1 className="mt-3 text-display">Begin Fast Track cycle</h1>
      <div className="mt-2 w-full"><Tower3D floors={Math.min(14, Math.max(1, v.floors))} state={v.state} spin={!reduce} /></div>
      <ShimmerButton onClick={v.state === "done" ? toChapters : begin} className="mt-4 gap-2 px-7 py-4 text-body font-semibold" background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">
        {v.state === "done" ? "Revise or take a final quiz" : "Begin Fast Track cycle"}{Icon.arrow}
      </ShimmerButton>
      <p className={cn("mt-5 text-[19px] leading-snug text-pink-100", v.state === "ahead" && "rounded-full border border-pink-300/50 bg-pink-300/10 px-4 py-1.5 font-semibold shadow-[0_0_24px_-6px_#ff3d9a]")} aria-live="polite">{status}</p>
      {first && v.state !== "done" && <p className="mt-2 text-muted text-pink-200/70">Starts with {short(first.title)} · about {mins(first.minutes)}</p>}
      {v.state !== "done" && (
        <button onClick={toChapters} className="mt-8 flex items-center gap-2 rounded-full px-4 py-2 text-muted font-semibold text-pink-200/80 hover:bg-white/5 hover:text-white">
          Scroll down to begin
          <motion.svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            animate={reduce ? undefined : { y: [0, 5, 0] }} transition={{ duration: 1.4, repeat: Infinity }}><path d="m6 9 6 6 6-6" /></motion.svg>
        </button>
      )}
    </section>
  );
}

function Crown({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d="M3 7.5 7.5 11 12 4l4.5 7L21 7.5 19 18H5z" /><rect x="5" y="19" width="14" height="2" rx="1" /></svg>;
}

/** CSS 3D tower: one box per floor, windows drawn with gradients, spinning on its vertical axis. */
function Tower3D({ floors, state, spin }: { floors: number; state: View["state"]; spin: boolean }) {
  const W = 128, H = 23, half = W / 2;
  const glow = state === "ahead" || state === "done" ? "drop-shadow(0 0 36px rgba(255,61,154,.75))" : "drop-shadow(0 0 22px rgba(255,61,154,.45))";
  const face = (hex: string, shade: number): React.CSSProperties => ({
    position: "absolute", width: W, height: H, left: 0, top: 0,
    background: `linear-gradient(rgba(0,0,0,${shade}),rgba(0,0,0,${shade})), repeating-linear-gradient(90deg, ${hex} 0 14px, rgba(255,240,247,.55) 14px 22px, ${hex} 22px 28px), ${hex}`,
    backgroundSize: "auto, 28px 100%, auto", boxShadow: "inset 0 0 0 1px rgba(12,11,14,.55)",
  });
  const towerH = floors * H;
  // fit the tower into its stage (40-44% of the screen height) without crowding the button
  const [stage, setStage] = useState(() => Math.min(400, Math.max(240, innerHeight * 0.44)));
  useEffect(() => { const f = () => setStage(Math.min(400, Math.max(240, innerHeight * 0.44))); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  const fit = Math.min(1, (stage - 70) / towerH);
  return (
    <div className="relative mx-auto grid h-[clamp(240px,44svh,400px)] w-full max-w-[460px] place-items-center overflow-x-clip [perspective:900px]" role="img"
      aria-label={`Your tower: ${floors} floor${floors === 1 ? "" : "s"}${state === "done" ? ", flag on top" : ""}`}>
      <div className="absolute bottom-[6%] h-10 w-56 rounded-[50%] bg-pink-500/25 blur-2xl" />
      <div className="relative [transform-style:preserve-3d]" style={{ width: W, height: towerH, marginTop: 30, filter: glow, scale: String(fit),
        animation: spin ? "ft-spin 16s linear infinite" : undefined, transform: spin ? undefined : "rotateX(-14deg) rotateY(-32deg)" }}>
        {Array.from({ length: floors }, (_, i) => {
          const hex = FLOOR_HUE[Math.min(FLOOR_HUE.length - 1, Math.floor((i / Math.max(1, floors - 1)) * (FLOOR_HUE.length - 1)))];
          const y = towerH - (i + 1) * H;
          return (
            <div key={i} className="absolute left-0 [transform-style:preserve-3d]" style={{ top: y, width: W, height: H }}>
              <div style={{ ...face(hex, 0.05), transform: `translateZ(${half}px)` }} />
              <div style={{ ...face(hex, 0.32), transform: `rotateY(180deg) translateZ(${half}px)` }} />
              <div style={{ ...face(hex, 0.18), transform: `rotateY(90deg) translateZ(${half}px)` }} />
              <div style={{ ...face(hex, 0.4), transform: `rotateY(-90deg) translateZ(${half}px)` }} />
              {i === floors - 1 && <div style={{ position: "absolute", width: W, height: W, left: 0, top: (H - W) / 2, background: hex, transform: `rotateX(90deg) translateZ(${H / 2}px)`, boxShadow: "inset 0 0 0 1px rgba(12,11,14,.55)" }} />}
            </div>
          );
        })}
        {state === "done" && (
          <div className="absolute left-1/2 [transform-style:preserve-3d]" style={{ top: -58 }}>
            <div className="h-[58px] w-[3px] -translate-x-1/2 rounded bg-pink-100" />
            <div className="absolute left-0 top-0 h-[22px] w-[34px] bg-pink-400 shadow-[0_0_18px_#ff3d9a] [clip-path:polygon(0_0,100%_25%,0_55%)]" />
          </div>
        )}
      </div>
      {state === "ahead" && (
        <div className="pointer-events-none absolute left-1/2 [animation:ft-orbit_6s_linear_infinite]" style={{ top: `calc(50% - ${towerH / 2 + 24}px)` }}>
          <span className="grid size-10 -translate-x-1/2 place-items-center rounded-full border border-pink-200/60 bg-pink-500/30 text-pink-100 shadow-[0_0_28px_#ff3d9a]"><Crown className="size-5" /></span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 2 + 3. the course tree, with what to do on top */

type Leaf = { x: number; y: number; r: number; c: Chap; mod: string; order: number };

function layoutTree(chapters: Chap[]) {
  const mods = [...new Set(chapters.map((c) => splitTitle(c.title).mod))];
  const branches: { mod: string; d: string; side: number }[] = [];
  const leaves: Leaf[] = [];
  let order = 0;
  mods.forEach((m, i) => {
    const side = i % 2 ? 1 : -1;
    const y0 = 880 - i * (640 / Math.max(1, mods.length - 1));
    const x1 = 500 + side * (330 + (i % 3) * 30), y1 = y0 - 90;
    const cx = 500 + side * 130, cy = y0 - 10;
    branches.push({ mod: m, side, d: `M 500 ${y0} Q ${cx} ${cy} ${x1} ${y1}` });
    const own = chapters.filter((c) => splitTitle(c.title).mod === m);
    own.forEach((c, k) => {
      const t = 0.22 + (0.78 * (k + 1)) / (own.length + 0.5);
      const bx = (1 - t) * (1 - t) * 500 + 2 * (1 - t) * t * cx + t * t * x1;
      const by = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
      const off = (k % 2 ? 1 : -1) * (14 + (k % 3) * 5);
      leaves.push({ x: bx + (k % 2 ? 4 : -4), y: by + off, r: 8.5, c, mod: m, order: order++ });
    });
  });
  return { mods, branches, leaves };
}

function TreeSection({ v }: { v: View }) {
  const wrap = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [fill, setFill] = useState(reduce ? 1 : 0);
  // Scroll-driven fill from a plain scroll listener (no animation-frame dependency).
  useEffect(() => {
    if (reduce) { setFill(1); return; }
    const onScroll = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r) return;
      const p = (innerHeight - r.top) / (innerHeight * 0.9);
      setFill((f) => Math.max(f, Math.min(1, Math.max(0, p))));   // fills up, never empties
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, [reduce]);
  const treeOpacity = 0.25 + 0.75 * Math.min(1, fill * 2.5);
  const { mods, branches, leaves } = useMemo(() => layoutTree(v.chapters), [v.chapters]);
  const lit = leaves.filter((l) => l.c.state !== "untaught");
  const litOrder = new Map(lit.map((l, i) => [l.c.topic_id, i]));
  const shownUpTo = Math.round(fill * lit.length);
  // ?at=tree opens the page at the course tree (deep link from the facilitator, and for screenshots)
  useEffect(() => { if (new URLSearchParams(location.search).get("at") === "tree") setFill(1); }, []);
  const missedByMod = mods.map((m) => ({ m, items: v.missed.filter((x) => splitTitle(x.title).mod === m) })).filter((g) => g.items.length);

  return (
    <section ref={wrap} className="relative mt-4">
      <div className="pointer-events-none sticky top-16 -z-0 h-[calc(100svh-64px)]" aria-hidden="true">
        <svg style={{ opacity: reduce ? 1 : treeOpacity, transition: "opacity .5s" }} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet"
          className="h-full w-full [filter:drop-shadow(0_0_6px_rgba(255,61,154,.35))]">
          <defs>
            <pattern id="leafHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#27272a" /><line x1="0" y1="0" x2="0" y2="5" stroke="#a1a1aa" strokeWidth="1.4" /></pattern>
          </defs>
          {/* trunk and roots */}
          <path d="M 500 1000 C 488 900, 512 760, 500 640 S 508 330, 500 180" fill="none" stroke="#ff9ccb" strokeWidth="5" strokeLinecap="round" />
          <path d="M 500 990 q -60 4 -120 -2 M 500 990 q 60 4 120 -2" fill="none" stroke="#ff9ccb" strokeWidth="2.2" strokeLinecap="round" opacity=".6" />
          {branches.map((b) => <path key={b.mod} d={b.d} fill="none" stroke="#ff9ccb" strokeWidth="2.6" strokeLinecap="round" />)}
          {branches.map((b, i) => {
            const m = /Q [\d.]+ [\d.]+ ([\d.]+) ([\d.]+)/.exec(b.d)!;
            return <text key={`t${i}`} x={Number(m[1]) + b.side * 10} y={Number(m[2]) - 10} textAnchor={b.side > 0 ? "start" : "end"} fill="#ffd1e6" fontSize="18" fontWeight="700">{b.mod}</text>;
          })}
          {leaves.map((l) => {
            const s = l.c.state, idx = litOrder.get(l.c.topic_id);
            const shown = idx !== undefined && idx < shownUpTo;
            const filled = s === "mastered" || s === "covered" || s === "started";
            return (
              <ellipse key={l.c.topic_id} cx={l.x} cy={l.y} rx={l.r * 1.35} ry={l.r} transform={`rotate(${l.order % 2 ? 28 : -28} ${l.x} ${l.y})`}
                fill={shown && filled ? (s === "mastered" ? "#ffd1e6" : s === "covered" ? "#ff3d9a" : "rgba(255,61,154,.45)") : shown && s === "missed" ? "url(#leafHatch)" : "transparent"}
                stroke={s === "untaught" ? "rgba(255,156,203,.28)" : s === "missed" ? "#a1a1aa" : "#ff9ccb"} strokeWidth={s === "missed" ? 1.6 : 1.4}
                strokeDasharray={s === "missed" ? "3 2" : undefined} className={cn("transition-[fill] duration-700", s === "missed" && !reduce && "animate-pulse")}
                style={shown && s === "mastered" ? { filter: "drop-shadow(0 0 6px #ff3d9a)" } : undefined} />
            );
          })}
        </svg>
      </div>

      <div className="relative z-10 -mt-[calc(100svh-64px)] grid min-h-[calc(100svh-64px)] w-full grid-cols-[minmax(0,1fr)] content-start gap-4 pb-12 pt-[18svh] md:max-w-[640px]">
        <ul className="sr-only">{mods.map((m) => {
          const own = v.chapters.filter((c) => splitTitle(c.title).mod === m);
          return <li key={m}>Module {m}: {own.filter((c) => c.state === "covered" || c.state === "mastered").length} of {own.length} chapters done, {own.filter((c) => c.state === "missed").length} missed</li>;
        })}</ul>
        <Card>
          <h2 className="text-h2">You're {Math.round(v.percent)}% through the course.</h2>
          <p className="mt-2 max-w-[640px] text-body text-pink-200/75">Each leaf is a chapter. Pink leaves are done, hatched ones were taught in class and still need you, faint ones haven't been taught yet.</p>
          <div className="mt-4 flex flex-wrap gap-3 text-label text-pink-200/80">
            <Key fill="#ffd1e6" label="mastered" /><Key fill="#ff3d9a" label="covered" /><Key fill="rgba(255,61,154,.45)" label="started" /><Key hatch label="missed" /><Key label="not taught yet" />
          </div>
        </Card>
        {missedByMod.length > 0 && (
          <Card>
            <h3 className="text-h3">You missed:</h3>
            {missedByMod.map((g) => (
              <div key={g.m} className="mt-2.5">
                <div className="eyebrow">{g.m}</div>
                {g.items.map((x) => (
                  <div key={x.topic_id} className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pink-300/10 bg-white/[.03] px-3 py-2">
                    <span className="min-w-0"><b>{splitTitle(x.title).name}</b><span className="block text-xs text-pink-200/70">{short(x.title)} · about {mins(x.minutes)} · floor {x.top}/10</span></span>
                    <a href={`#/play/chapter/${x.topic_id}`} className="rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-3.5 py-1.5 text-sm font-semibold text-white">Start</a>
                  </div>
                ))}
              </div>
            ))}
          </Card>
        )}
        {v.path.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-h3">Do this next:</h3>
              {v.due && <span className="text-sm text-pink-200/80">Due {fmtDate(v.due)}{v.queued_status ? ` · ${v.queued_status.toLowerCase()}` : ""}</span>}</div>
            <ol className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1.5">{v.path.map((x, i) => (
              <li key={x.topic_id}><a href={`#/play/chapter/${x.topic_id}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-white/5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-pink-400/50 bg-pink-600/25 font-mono text-xs font-bold">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{splitTitle(x.title).name} <span className="text-pink-200/60">· {short(x.title)}</span></span>
                <span className="text-xs text-pink-200/70">{mins(x.minutes)}</span></a></li>))}</ol>
          </Card>
        )}
        <Card>
          <h3 className="text-h3">Ready to test:</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {v.ready.length ? v.ready.slice(0, 10).map((r) => <span key={r.topic_id} className="inline-flex items-center gap-1 rounded-full border border-pink-300/40 bg-pink-300/10 px-2.5 py-1 text-xs">{Icon.check}{short(r.title)}</span>)
              : <span className="text-sm text-pink-200/70">Nothing yet. A topic unlocks once it's covered in class or you clear its first floors.</span>}
            {v.ready.length > 10 && <span className="text-xs text-pink-200/60">+{v.ready.length - 10} more</span>}
          </div>
        </Card>
      </div>
    </section>
  );
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-[20px] border border-pink-300/15 bg-[#0c0b0e]/85 p-5 md:p-6 shadow-[0_24px_48px_-28px_rgba(0,0,0,.9)] backdrop-blur-md">{children}</div>
);
const Key = ({ fill, hatch, label }: { fill?: string; hatch?: boolean; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><i className={cn("inline-block h-2.5 w-3.5 rounded-full border", hatch ? "hatch border-dashed border-grey bg-zinc-800" : "border-pink-300/50")} style={fill ? { background: fill } : undefined} />{label}</span>
);
