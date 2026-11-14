/* Student landing (dev notes 44-46). Left: one level meter per chapter of the module the class has
   finished (KM-01 for now), then a single Begin Fast Track button. Centre: the course drawn as a tree
   — the trunk is the whole course, each branch a module, each leaf a chapter, and the ten small circles
   on a leaf are that chapter's floors, filled as they are cleared. Branches the class hasn't started are
   dashed. Picking the trunk, a branch or a leaf sets how deep the Fast Track goes (see lib/pick.ts).
   Real data from /api/ft/{course}/student/{learner}. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, splitTitle } from "@/lib/api";
import { fastTrackTarget, finished, nextFloor, pickKey, taughtModules, type Pick } from "@/lib/pick";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Icon, confetti } from "@/components/ui/kit";
import { LoadError, Skeleton, SkeletonCard, useLoad } from "@/components/ui/loading";
import { cn } from "@/lib/utils";

type Chap = { topic_id: number; title: string; top: number; quiz: boolean; taught: boolean; state: "mastered" | "covered" | "missed" | "started" | "taught" | "untaught" };
type View = {
  state: "behind" | "ahead" | "done" | "on_track"; percent: number; ahead_by: number; floors: number; due: string | null; queued_status: string | null;
  missed: { topic_id: number; title: string; top: number; minutes: number }[];
  path: { topic_id: number; title: string; top: number; minutes: number }[];
  ready: { topic_id: number; title: string }[]; chapters: Chap[];
};
/** A chapter as the landing uses it: split title, and whether its module counts as taught in class. */
type C = Chap & { mod: string; kt: string; name: string; inClass: boolean };

// ten steps of one hue, climbing in lightness: floor 1 is deep pink, floor 10 nearly white
const METER = ["#c00d68", "#d8127a", "#e6197f", "#f22b8e", "#ff3d9a", "#ff5ca8", "#ff7ab7", "#ff9ccb", "#ffb8d9", "#ffd1e6"];
const short = (c: { mod: string; kt: string }) => `${c.mod} ${c.kt}`.trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export default function Landing({ cid, learner }: { cid: number; learner: number; name?: string }) {
  const preview = new URLSearchParams(location.search).get("preview");
  const { data: v, error, loading, retry } = useLoad(() => api<View>(`/api/ft/${cid}/student/${learner}`), [cid, learner]);
  const view = useMemo(() => {
    if (!v || preview !== "done") return v;
    // Preview only (for demos): show the finished state without changing anyone's results.
    return { ...v, state: "done" as const, percent: 100, missed: [], path: [], floors: 10,
      chapters: v.chapters.map((c) => ({ ...c, state: "mastered" as const, top: 10, quiz: true })) };
  }, [v, preview]);
  if (error && !loading) return <LoadError className="mt-6" message={error} onRetry={retry} />;
  if (loading || !view) return <HeroSkeleton />;
  return <Hero key={learner} v={view} preview={preview === "done"} />;
}

function HeroSkeleton() {
  return (
    <section className="grid min-h-[calc(100svh-64px)] items-center gap-8 pb-8 md:grid-cols-[minmax(250px,300px)_minmax(0,1fr)]">
      <div className="grid gap-2.5">
        {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-9 rounded-full" />)}
        <Skeleton className="mt-5 h-14 rounded-full" />
      </div>
      <SkeletonCard lines={6} label="Loading your course tree" className="mx-auto aspect-square w-full max-w-[720px]" />
    </section>
  );
}

/* ---------------------------------------------------------------- the hero: meters, button, tree */

function Hero({ v, preview }: { v: View; preview: boolean }) {
  const fired = useRef(false);
  useEffect(() => { if (v.state === "done" && !fired.current) { fired.current = true; setTimeout(() => confetti(true), 600); } }, [v.state]);

  const { chapters, mods, taught } = useMemo(() => {
    const split = v.chapters.map((c) => ({ ...c, ...splitTitle(c.title) }));
    const mods = [...new Set(split.map((c) => c.mod))];
    const taught = taughtModules(mods);
    // Only the taught module counts as covered in class, whatever the API says (dev note 45).
    const chapters: C[] = split.map((c) => ({ ...c, inClass: taught.has(c.mod) }));
    return { chapters, mods, taught };
  }, [v.chapters]);

  const [pick, setPick] = useState<Pick>({ kind: "trunk" });
  const target = fastTrackTarget(pick, chapters, taught);
  const nextUp = fastTrackTarget({ kind: "trunk" }, chapters, taught);   // the chapter that needs completing next
  const focus = chapters.filter((c) => c.inClass);
  const picked = pick.kind === "trunk" ? "whole course" : pick.kind === "branch" ? pick.mod : target ? short(target) : "";
  const nf = target ? nextFloor(target) : null;
  const begin = () => { if (target) location.hash = `#/play/chapter/${target.topic_id}`; };

  return (
    <section className="relative -mt-8 grid min-h-[calc(100svh-64px)] items-center gap-8 pb-8 md:-mt-12 md:grid-cols-[minmax(250px,300px)_minmax(0,1fr)] md:gap-6">
      <div className="flex min-w-0 flex-col items-stretch text-left">
        {preview && <span className="mb-3 self-start rounded-full border border-pink-300/30 px-3 py-1 text-label text-pink-200">Preview: finished state (simulated)</span>}
        <div className="eyebrow">{[...taught].join(", ")} · done in class</div>
        {/* one vertical bar: each pill is a chapter, filled from the bottom as its floors are cleared (dev note 69) */}
        <div className="relative mt-3">
          <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-[22px] rounded-full border border-pink-300/15 bg-white/[.04]" />
          <ul className="relative grid gap-1 py-1" aria-label="Chapter levels">
            {focus.map((c) => {
              const on = pick.kind === "leaf" && pick.id === c.topic_id, next = nextUp?.topic_id === c.topic_id;
              const lvl = finished(c) ? 10 : Math.min(10, c.top), col = METER[Math.max(0, lvl - 1)];
              return (
                <li key={c.topic_id}>
                  <button type="button" onClick={() => setPick({ kind: "leaf", id: c.topic_id })} aria-pressed={on}
                    aria-label={`${short(c)} ${c.name}: ${finished(c) ? "finished" : `floor ${c.top} of 10`}${next ? ", do this next" : ""}`}
                    className="group flex h-9 w-full min-w-0 items-center gap-3 text-left">
                    <span aria-hidden="true" className={cn("relative ml-[4px] h-full w-[14px] shrink-0 overflow-hidden rounded-full bg-pink-300/10 transition-shadow",
                      on ? "ring-2 ring-pink-200 shadow-[0_0_14px_-2px_#ff3d9a]" : "group-hover:ring-1 group-hover:ring-pink-300/50")}>
                      <i className="absolute inset-x-0 bottom-0 rounded-full" style={{ height: `${lvl * 10}%`, background: col, boxShadow: lvl ? `0 0 8px -1px ${col}` : undefined }} />
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate rounded-full px-2 py-1 text-[13.5px]", on && "bg-pink-300/15")}>
                      <b className="font-mono text-[12px] text-pink-400">{c.kt}</b>{" "}
                      <span className={cn(next ? "font-semibold text-pink-100 motion-safe:animate-pulse" : "text-pink-100/85")}>{c.name}</span>
                      <span className="ml-1.5 font-mono text-[11px] text-pink-200/50">{finished(c) ? "done" : `${c.top}/10`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <ShimmerButton onClick={begin} disabled={!target} className="mt-6 gap-2 px-6 py-3.5 text-body font-semibold"
          background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">
          <span className="flex min-w-0 flex-wrap justify-center gap-x-1.5 whitespace-normal text-center leading-tight">
            <span>Begin Fast Track</span><span className="whitespace-nowrap text-pink-100">· {picked}</span>
          </span>{Icon.arrow}
        </ShimmerButton>
        <p className="mt-3 text-muted text-pink-200/80">Select a branch, a leaf or the trunk to set your Fast Track.</p>
        {target && (
          <p className="mt-1 text-[13px] text-pink-200/60" aria-live="polite">
            Starts on {short(target)} · {nf === null ? "complete, revise it" : nf === 11 ? "final quiz" : `floor ${nf} of 10`}
            {!target.inClass && " · not taught in class yet"}
          </p>
        )}
      </div>
      <CourseTree chapters={chapters} mods={mods} taught={taught} pick={pick} onPick={setPick} nextId={nextUp?.topic_id} />
    </section>
  );
}

/** A horizontal ten-block level meter, lit up to the chapter's top floor. */
/* ---------------------------------------------------------------- the course tree */

type Leaf = { x: number; y: number; c: C };
type Branch = { mod: string; d: string; side: number; end: [number, number]; leaves: Leaf[]; inClass: boolean };
const TRUNK = "M 500 1000 C 488 900, 512 760, 500 640 S 508 330, 500 130";

function layoutCourse(chapters: C[], mods: string[], taught: Set<string>): Branch[] {
  const n = mods.length;
  return mods.map((m, i) => {
    const side = i % 2 ? 1 : -1;
    const y0 = 860 - i * (640 / Math.max(1, n - 1));
    const x1 = 500 + side * 370, y1 = y0 - 95, cx = 500 + side * 150, cy = y0 - 8;
    const own = chapters.filter((c) => c.mod === m);
    const leaves = own.map((c, k) => {
      const t = 0.2 + (0.78 * (k + 0.5)) / Math.max(1, own.length);
      const bx = (1 - t) ** 2 * 500 + 2 * (1 - t) * t * cx + t * t * x1;
      const by = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1;
      // tangent, then step off the branch alternately on either side of it
      const tx = 2 * (1 - t) * (cx - 500) + 2 * t * (x1 - cx), ty = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy);
      // long modules (over 12 chapters) get a second row of leaves on each side so they don't overlap
      const row = own.length > 12 && k % 4 >= 2 ? 52 : 26;
      const len = Math.hypot(tx, ty) || 1, off = k % 2 ? row : -row;
      return { x: bx - (ty / len) * off, y: by + (tx / len) * off, c };
    });
    return { mod: m, side, d: `M 500 ${y0} Q ${cx} ${cy} ${x1} ${y1}`, end: [x1, y1] as [number, number], leaves, inClass: taught.has(m) };
  });
}

/** Enter or Space on an SVG "button". */
const press = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };

function CourseTree({ chapters, mods, taught, pick, onPick, nextId }:
  { chapters: C[]; mods: string[]; taught: Set<string>; pick: Pick; onPick: (p: Pick) => void; nextId?: number }) {
  const branches = useMemo(() => layoutCourse(chapters, mods, taught), [chapters, mods, taught]);
  const sel = pickKey(pick);
  const nextLeaf = branches.flatMap((b) => b.leaves).find((l) => l.c.topic_id === nextId);
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <svg viewBox="0 0 1000 1000" className="h-auto w-full overflow-visible [filter:drop-shadow(0_0_6px_rgba(255,61,154,.3))]" role="group" aria-label="Course tree: pick the trunk, a module branch or a chapter leaf">
        {/* trunk: the whole course */}
        <g role="button" tabIndex={0} aria-pressed={sel === "trunk"} aria-label="Trunk: the whole course"
          onClick={() => onPick({ kind: "trunk" })} onKeyDown={press(() => onPick({ kind: "trunk" }))} className="group cursor-pointer outline-none">
          <title>The whole course</title>
          <path d={TRUNK} fill="none" stroke="transparent" strokeWidth="40" pointerEvents="stroke" />
          <path d={TRUNK} fill="none" stroke={sel === "trunk" ? "#fff0f7" : "#ff9ccb"} strokeWidth={sel === "trunk" ? 9 : 6} strokeLinecap="round"
            style={sel === "trunk" ? { filter: "drop-shadow(0 0 10px #ff3d9a)" } : undefined} className="transition-[stroke,stroke-width] duration-200 group-hover:stroke-white" />
          <path d={TRUNK} fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="6 8" className="opacity-0 group-focus-visible:opacity-100" transform="translate(16 0)" />
          <path d="M 500 990 q -60 4 -120 -2 M 500 990 q 60 4 120 -2" fill="none" stroke="#ff9ccb" strokeWidth="2.2" strokeLinecap="round" opacity=".6" />
        </g>

        {branches.map((b) => {
          const on = sel === `b:${b.mod}`;
          const done = b.leaves.filter((l) => finished(l.c)).length;
          return (
            <g key={b.mod}>
              {/* branch: one module */}
              <g role="button" tabIndex={0} aria-pressed={on} onClick={() => onPick({ kind: "branch", mod: b.mod })} onKeyDown={press(() => onPick({ kind: "branch", mod: b.mod }))}
                aria-label={`Branch ${b.mod}: ${b.leaves.length} chapters, ${done} finished${b.inClass ? "" : ", not started in class"}`} className="group cursor-pointer outline-none">
                <title>{`${b.mod}${b.inClass ? "" : " · not started in class"}`}</title>
                <path d={b.d} fill="none" stroke="transparent" strokeWidth="30" pointerEvents="stroke" />
                <path d={b.d} fill="none" strokeLinecap="round" className="transition-[stroke,stroke-width] duration-200 group-hover:stroke-white"
                  stroke={on ? "#fff0f7" : b.inClass ? "#ff9ccb" : "rgba(255,156,203,.45)"} strokeWidth={on ? 5 : b.inClass ? 3.4 : 2.4}
                  strokeDasharray={b.inClass ? undefined : "10 9"} style={on ? { filter: "drop-shadow(0 0 8px #ff3d9a)" } : undefined} />
                <text x={b.end[0] + b.side * 12} y={b.end[1] - 8} textAnchor={b.side > 0 ? "start" : "end"} fontSize="22" fontWeight="700"
                  fill={on ? "#fff" : b.inClass ? "#ffd1e6" : "rgba(255,209,230,.55)"} className="group-focus-visible:underline">{b.mod}</text>
                {!b.inClass && <text x={b.end[0] + b.side * 12} y={b.end[1] + 14} textAnchor={b.side > 0 ? "start" : "end"} fontSize="13" fill="rgba(255,209,230,.45)">not started</text>}
              </g>
              {/* leaves: its chapters, ten subtopic circles each */}
              {b.leaves.map((l) => <LeafNode key={l.c.topic_id} l={l} on={sel === `l:${l.c.topic_id}`} onPick={onPick} next={l.c.topic_id === nextId} />)}
            </g>
          );
        })}

        {/* the chapter that needs completing next: its name pulses */}
        {nextLeaf && (
          <text x={Math.min(980, Math.max(20, nextLeaf.x))} y={nextLeaf.y - 30} textAnchor={nextLeaf.x < 200 ? "start" : nextLeaf.x > 800 ? "end" : "middle"}
            fontSize="21" fontWeight="700" fill="#fff0f7" stroke="#0c0b0e" strokeWidth="5" paintOrder="stroke" pointerEvents="none"
            className="motion-safe:animate-pulse">{`${nextLeaf.c.kt} · ${clip(nextLeaf.c.name, 30)}`}</text>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-label text-pink-200/80">
        <span className="inline-flex items-center gap-1.5"><Dots n={10} of={6} />subtopics done fill in</span>
        <span className="inline-flex items-center gap-1.5"><svg width="26" height="6" aria-hidden="true"><path d="M1 3h24" stroke="rgba(255,156,203,.6)" strokeWidth="2" strokeDasharray="5 4" /></svg>not started in class</span>
        <span className="inline-flex items-center gap-1.5"><b className="font-semibold text-pink-100 motion-safe:animate-pulse">Name</b>do this next</span>
      </div>
    </div>
  );
}

function LeafNode({ l, on, next, onPick }: { l: Leaf; on: boolean; next: boolean; onPick: (p: Pick) => void }) {
  const { c, x, y } = l, top = c.quiz ? 10 : Math.min(10, c.top);
  const choose = () => onPick({ kind: "leaf", id: c.topic_id });
  const status = finished(c) ? "finished" : c.top ? `${c.top} of 10 subtopics done` : "not started";
  return (
    <g role="button" tabIndex={0} aria-pressed={on} onClick={choose} onKeyDown={press(choose)} className="group cursor-pointer outline-none"
      aria-label={`${short(c)} ${c.name}: ${status}${c.inClass ? "" : ", not taught in class yet"}${next ? ", do this next" : ""}`}>
      <title>{`${short(c)} · ${c.name}`}</title>
      <circle cx={x} cy={y} r="24" fill="transparent" />
      <circle cx={x} cy={y} r="21" fill={on ? "rgba(255,61,154,.18)" : "none"} stroke={on ? "#fff" : next ? "#ff9ccb" : "transparent"} strokeWidth={on ? 2.4 : 1.4}
        className={cn("transition-[stroke] duration-200 group-hover:stroke-white group-focus-visible:stroke-white", next && !on && "motion-safe:animate-pulse")} />
      {Array.from({ length: 10 }, (_, k) => {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2, lit = k < top;
        return <circle key={k} cx={x + Math.cos(a) * 13} cy={y + Math.sin(a) * 13} r="4.1"
          fill={lit ? METER[k] : "transparent"} fillOpacity={c.inClass ? 1 : 0.5}
          stroke={lit ? "none" : c.inClass ? "rgba(255,156,203,.6)" : "rgba(255,156,203,.25)"} strokeWidth="1.2" />;
      })}
      {finished(c) && <circle cx={x} cy={y} r="4" fill="#fff0f7" style={{ filter: "drop-shadow(0 0 5px #ff3d9a)" }} />}
    </g>
  );
}

/** The legend's little leaf: n subtopic circles, the first `of` filled. */
function Dots({ n, of }: { n: number; of: number }) {
  return (
    <svg viewBox="0 0 30 30" className="size-4" aria-hidden="true">
      {Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2 - Math.PI / 2;
        return <circle key={k} cx={15 + Math.cos(a) * 10} cy={15 + Math.sin(a) * 10} r="3.2" fill={k < of ? METER[k] : "transparent"} stroke={k < of ? "none" : "rgba(255,156,203,.6)"} strokeWidth="1" />; })}
    </svg>
  );
}
