/* Student: pick a chapter, climb a tower of ten floors, then the final quiz on the roof.
   Same /api/ft endpoints as the plain game; every question cites the passage it came from. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api, melsoftCourse, splitTitle, store } from "@/lib/api";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Icon, Modal, NumberTicker, SpotlightCard, confetti } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { moduleSummary, taughtModules } from "@/lib/pick";
import Landing from "@/pages/Landing";

const QUIZ = 11;
const SKILL: Record<string, string> = { Recall: "recall", Explain: "explain", "Spot the mistake": "spot", Apply: "apply", Analyse: "analyse", "Final quiz": "quiz" };
// one hue, climbing in lightness: the tower brightens as it grows
const HUE: Record<string, string> = { recall: "#e6197f", explain: "#ff3d9a", spot: "#ff6bb0", apply: "#ff9ccb", analyse: "#ffd1e6", quiz: "#fff0f7" };
const SURE: [string, string][] = [["guess", "Guessing"], ["fair", "Fairly sure"], ["certain", "Certain"]];
const SURE_X: Record<string, number> = { guess: 0.5, fair: 1, certain: 1.5 };

type Chapter = { id: number; seq: number; title: string; passages: number; mastery: number | null; levels: Record<string, { best: number; total: number; stars: number; passed: boolean }> };
type Data = { course: string; learners: { id: number; name: string; level?: number; sample?: boolean }[]; learner_id: number | null; stats: any; chapters: Chapter[]; skills: Record<string, string>; blurbs: Record<string, string> };
type Q = any;
type Run = { level: number; data: any; i: number; answers: { ok: boolean; sure: string; xp: number }[]; xp: number; streak: number };

const topOf = (c: Chapter) => { let t = 0; for (let i = 1; i <= 10; i++) if (c.levels?.[i]?.passed) t = i; return t; };
const Star = ({ on }: { on: boolean }) => <svg viewBox="0 0 24 24" className={cn("size-3.5", on ? "text-pink-200 drop-shadow-[0_0_5px_rgba(255,209,230,.7)]" : "text-pink-300/15")} fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>;

export default function Student({ sub }: { sub: string[] }) {
  const [cid, setCid] = useState<number | null>(null);
  const [learner, setLearner] = useState<number | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");

  // One login only: the student plays as a demo learner straight away (their own profile if
  // there is one, otherwise the first learner), and can switch from the header chip.
  const load = async (c: number, lid: number | null) => {
    let d = await api<Data>(`/api/ft/${c}/chapters${lid ? `?learner_id=${lid}` : ""}`);
    if (!lid || d.learner_id !== lid) {
      const own = d.learners.find((l) => !/\(sample\)/.test(l.name)) || d.learners[0];
      if (!own) { setData(d); return; }
      lid = own.id;
      store(`ftn.learner.${c}`, String(lid));
      d = await api<Data>(`/api/ft/${c}/chapters?learner_id=${lid}`);
    }
    setLearner(lid); setData(d);
  };
  useEffect(() => {
    (async () => {
      const c = await melsoftCourse(); if (!c) throw new Error("No course with notes yet");
      const q = Number(new URLSearchParams(location.search).get("learner")) || Number(store(`ftn.learner.${c.id}`)) || null;
      setCid(c.id); await load(c.id, q);
    })().catch((e) => setErr(String(e.message || e)));
  }, []);
  const choose = async (id: number) => { store(`ftn.learner.${cid}`, String(id)); await load(cid!, id); };

  if (err) return <div className="glass p-6">Fast Track couldn't start: {err}</div>;
  if (!data || !cid) return <div className="py-6 text-pink-200/70">Opening the game…</div>;
  if (!learner) return <Who data={data} cid={cid} onPick={choose} />;   // only when the course has no learners at all
  const me = data.learners.find((l) => l.id === learner);
  const slot = document.getElementById("hdr-slot");
  const chip = slot && createPortal(<PlayingAs me={me?.name || "Learner"} learners={data.learners} onPick={choose} />, slot);
  const chapter = sub[0] === "chapter" ? data.chapters.find((c) => c.id === Number(sub[1])) : null;
  return <>{chip}{chapter
    ? <Tower key={chapter.id} c={chapter} data={data} learner={learner} reload={() => load(cid, learner)} />
    : <><Landing cid={cid} learner={learner} name={me?.name || "Your"} /><div id="chapters" className="scroll-mt-20 pt-6"><Picker data={data} learner={learner} /></div></>}</>;
}

/** "Playing as NAME" chip in the header; switching learner is a small menu, no new page, no password. */
function PlayingAs({ me, learners, onPick }: { me: string; learners: Data["learners"]; onPick: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-full border border-pink-300/25 bg-white/5 px-3 py-1 text-[13px] font-semibold text-pink-100 hover:border-pink-300/50">
        <span className="hidden sm:inline">Playing as</span> <span className="text-pink-300">{me.replace(" (sample)", "")}</span><span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul role="listbox" className="glass absolute right-0 top-full z-30 mt-2 max-h-72 min-w-[200px] overflow-auto p-1.5">
          {learners.map((l) => (
            <li key={l.id}><button role="option" aria-selected={l.name === me} onClick={() => { setOpen(false); onPick(l.id); }}
              className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm hover:bg-pink-500/15">
              <span>{l.name.replace(" (sample)", "")}</span><span className="font-mono text-xs text-pink-300">Level {l.level ?? 0}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Who({ data, cid, onPick }: { data: Data; cid: number; onPick: (id: number) => void }) {
  const [name, setName] = useState("");
  const people = data.learners.filter((l) => !l.sample && !/\(sample\)/.test(l.name));
  return (
    <SpotlightCard className="mx-auto mt-[6vh] max-w-[520px] p-8">
      <h1 className="text-h2">Who's climbing?</h1>
      <p className="mt-1 text-pink-200/75">Your progress is saved under your name and your facilitator sees it.</p>
      {!!people.length && <div className="mt-4 flex flex-wrap gap-2">{people.map((l) => <button key={l.id} onClick={() => onPick(l.id)} className="rounded-full border border-pink-300/25 bg-white/5 px-4 py-2 font-semibold hover:border-pink-300/50">{l.name}</button>)}</div>}
      <form className="mt-5 flex flex-wrap gap-2.5" onSubmit={async (e) => { e.preventDefault(); const r = await api<{ learner_id: number }>(`/api/ft/${cid}/learner`, { json: { name } }); onPick(r.learner_id); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Your name" aria-label="Your name" autoComplete="given-name"
          className="min-w-0 flex-[1_1_200px] rounded-full border border-pink-300/25 bg-white/5 px-4 py-2.5 outline-none placeholder:text-pink-200/50 focus:border-pink-300" />
        <ShimmerButton type="submit" className="gap-2 px-5 py-2.5 font-semibold" background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">Start climbing{Icon.arrow}</ShimmerButton>
      </form>
    </SpotlightCard>
  );
}

function Picker({ data, learner }: { data: Data; learner: number }) {
  const [mod, setMod] = useState("All"); const [q, setQ] = useState("");
  const st = data.stats || {}, me = data.learners.find((l) => l.id === learner);
  const mods = ["All", ...new Set(data.chapters.map((c) => splitTitle(c.title).mod))];
  const taught = taughtModules(mods.slice(1));
  const acc = st.answered ? Math.round((100 * st.correct) / st.answered) : null;
  const cal = st.sure_right + st.sure_wrong ? Math.round((100 * st.sure_right) / (st.sure_right + st.sure_wrong)) : null;
  const resume = [...data.chapters].filter((c) => topOf(c) > 0 && !c.levels?.[QUIZ]?.passed).sort((a, b) => topOf(b) - topOf(a))[0];
  const rows = data.chapters.filter((c) => (mod === "All" || splitTitle(c.title).mod === mod) && (!q || c.title.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <h2 className="text-h2">{resume ? "Keep climbing" : "Pick a chapter"}, {(me?.name || "").split(" ")[0]}.</h2>
      <p className="mt-2 max-w-[640px] text-body text-pink-200/75">Every chapter is a tower of ten floors: recall it, explain it, catch the mistake, apply it, analyse it. Then the final quiz puts the roof on.</p>
      <div className="glass mb-6 mt-7 grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-4">
        {[[st.xp || 0, "XP earned"], [st.best_streak || 0, "best streak"], [acc, "answers right", "%"], [cal, "right when certain", "%"]].map(([v, l, s], i) => (
          <div key={i} className="bg-[#0c0b0e]/55 px-[18px] py-4"><b className="stat block">{v === null ? "–" : <><NumberTicker value={v as number} />{s}</>}</b><span className="mt-2 block text-label text-pink-200/70">{l}</span></div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex max-w-full gap-1.5 overflow-x-auto p-0.5">
          {mods.map((m) => <button key={m} type="button" aria-pressed={m === mod} onClick={() => setMod(m)} className={cn("whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-semibold", m === mod ? "border-pink-200 bg-pink-200 text-[#1a0d14]" : "border-pink-300/15 text-pink-200/80")}>{m}</button>)}
        </div>
      </div>
      {mod === "All" && !q ? (
        /* "All" shows one card per module; its chapter cards open when the module is picked (dev note 46). */
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {mods.slice(1).map((m, i) => {
            const own = data.chapters.filter((c) => splitTitle(c.title).mod === m);
            const s = moduleSummary(own.map((c) => ({ top: topOf(c), quiz: !!c.levels?.[QUIZ]?.passed })));
            const inClass = taught.has(m);
            return (
              <motion.button key={m} type="button" onClick={() => setMod(m)} initial={{ opacity: 0.35, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.04 }}
                aria-label={`${m}: ${s.count} chapters, ${s.finished} finished, level ${s.level} of 10${inClass ? "" : ", not taught in class yet"}. Show its chapters`}
                className="glass grid grid-cols-[1fr_auto] items-center gap-3.5 px-[18px] py-4 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-pink-300/30">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-pink-400">Module</div>
                  <div className="mt-0.5 text-[20px] font-semibold leading-snug">{m}</div>
                  <div className="mt-1.5 text-[12.5px] text-pink-200/70">{s.count} chapter{s.count === 1 ? "" : "s"} · {s.finished} finished · {inClass ? "done in class" : "not taught yet"}</div>
                </div>
                <div className="flex w-[26px] flex-col-reverse gap-0.5" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, k) => <i key={k} className="h-1 rounded-sm" style={k < s.level ? { background: HUE[SKILL[data.skills[k + 1]] || "quiz"], boxShadow: `0 0 8px -1px ${HUE[SKILL[data.skills[k + 1]] || "quiz"]}` } : { background: "rgba(255,170,210,.1)" }} />)}
                </div>
              </motion.button>
            );
          })}
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(330px,1fr))]">
        {rows.map((c, i) => {
          const t = splitTitle(c.title), top = topOf(c), quiz = c.levels?.[QUIZ]?.passed;
          return (
            <motion.a key={c.id} href={`#/play/chapter/${c.id}`} initial={{ opacity: 0.35, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.04 }}
              className="glass grid grid-cols-[1fr_auto] items-center gap-3.5 px-[18px] py-4 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-pink-300/30">
              <div className="min-w-0"><div className="font-mono text-xs font-semibold text-pink-400">{t.mod} · {t.kt}</div><div className="mt-0.5 font-semibold leading-snug">{t.name}</div>
                <div className="mt-1.5 text-[12.5px] text-pink-200/70">{quiz ? "Roof on · quiz passed" : top ? `Floor ${top} of 10` : "Not started"} · {c.passages} passages</div></div>
              <div className="flex w-[26px] flex-col-reverse gap-0.5" aria-label={`${top} of 10 floors`}>
                {Array.from({ length: 11 }, (_, k) => <i key={k} className="h-1 rounded-sm" style={k < top || (k === 10 && quiz) ? { background: HUE[SKILL[data.skills[k + 1]] || "quiz"], boxShadow: `0 0 8px -1px ${HUE[SKILL[data.skills[k + 1]] || "quiz"]}` } : { background: "rgba(255,170,210,.1)" }} />)}
              </div>
            </motion.a>
          );
        })}
      </div>
      )}
    </>
  );
}

function TowerSVG({ top, quiz, fresh, skills }: { top: number; quiz: boolean; fresh: number | null; skills: Record<string, string> }) {
  const cx = 150, base = 392, h = 25, hw = 92, hd = 46;
  const shade = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16); const f = (v: number) => Math.round(v * k); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  const floor = (i: number, hex: string) => {
    const cy = base - i * h;
    return (
      <motion.g key={i} initial={fresh === i + 1 ? { y: -60, opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} transition={{ duration: 1, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}>
        <polygon points={`${cx - hw},${cy} ${cx},${cy + hd} ${cx},${cy + hd + h} ${cx - hw},${cy + h}`} fill={shade(hex, 0.55)} />
        <polygon points={`${cx},${cy + hd} ${cx + hw},${cy} ${cx + hw},${cy + h} ${cx},${cy + hd + h}`} fill={shade(hex, 0.38)} />
        {[0, 1, 2, 3].map((k) => <rect key={k} x={cx - hw + (hw / 4) * (k + 0.7) - 4} y={cy + (hd / 4) * (k + 0.7) + 7} width="8" height={h - 14} rx="1.5" fill="#fff" opacity={0.18 + 0.5 * Number((i * 7 + k * 3) % 5 === 0)} transform={`skewY(26.6)`} style={{ transformOrigin: `${cx - hw + (hw / 4) * (k + 0.7)}px ${cy + (hd / 4) * (k + 0.7)}px` }} />)}
        <polygon points={`${cx},${cy - hd} ${cx + hw},${cy} ${cx},${cy + hd} ${cx - hw},${cy}`} fill={hex} />
        <polygon points={`${cx},${cy - hd} ${cx + hw},${cy} ${cx},${cy + hd} ${cx - hw},${cy}`} fill="url(#gl)" opacity=".55" />
      </motion.g>
    );
  };
  const cy = base - top * h;
  return (
    <svg viewBox="0 70 300 400" className="h-auto w-full max-w-[360px] overflow-visible" role="img" aria-label={`Tower: ${top} of 10 floors${quiz ? ", roof on" : ""}`}>
      <defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".5" /><stop offset=".6" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
      <polygon points={`${cx},${base - hd + h + 18} ${cx + hw + 40},${base + h + 18} ${cx},${base + hd + h + 38} ${cx - hw - 40},${base + h + 18}`} fill="rgba(230,25,127,.1)" stroke="rgba(255,61,154,.35)" />
      {Array.from({ length: top }, (_, i) => floor(i, HUE[SKILL[skills[i + 1]]] || "#e6197f"))}
      {top < 10 && (
        <motion.g animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 2, repeat: Infinity }} fill="none" stroke="rgba(255,240,247,.35)" strokeDasharray="4 4">
          <polygon points={`${cx},${cy - hd} ${cx + hw},${cy} ${cx},${cy + hd} ${cx - hw},${cy}`} />
          <polygon points={`${cx - hw},${cy} ${cx},${cy + hd} ${cx},${cy + hd + h} ${cx - hw},${cy + h}`} />
          <polygon points={`${cx},${cy + hd} ${cx + hw},${cy} ${cx + hw},${cy + h} ${cx},${cy + hd + h}`} />
        </motion.g>
      )}
      {quiz && (
        <motion.g initial={fresh === QUIZ ? { y: -60, opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}>
          <polygon points={`${cx - hw},${cy} ${cx},${cy + hd} ${cx},${cy - 70}`} fill="#8f0a52" />
          <polygon points={`${cx},${cy + hd} ${cx + hw},${cy} ${cx},${cy - 70}`} fill="#5c0838" />
          <polygon points={`${cx - hw},${cy} ${cx},${cy - hd} ${cx},${cy - 70}`} fill="#ff9ccb" opacity=".9" />
          <circle cx={cx} cy={cy - 78} r="6" fill="#ffd1e6" style={{ filter: "drop-shadow(0 0 10px #ff3d9a)" }} />
        </motion.g>
      )}
    </svg>
  );
}

function Tower({ c, data, learner, reload }: { c: Chapter; data: Data; learner: number; reload: () => Promise<void> }) {
  const [run, setRun] = useState<Run | null>(null);
  const [result, setResult] = useState<any>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [loading, setLoading] = useState<string>("");
  const t = splitTitle(c.title), lv = c.levels || {}, top = topOf(c), quiz = !!lv[QUIZ]?.passed, open = Math.min(top + 1, QUIZ);

  const start = async (level: number, again = false) => {
    setResult(null); setLoading(`Building floor ${level} from the notes…`);
    const seed = again || lv[level] ? Math.floor(Math.random() * 1e5) : 0;
    try {
      const d = await api(`/api/ft/topic/${c.id}/level/${level}?seed=${seed}`);
      setRun({ level, data: d, i: 0, answers: [], xp: 0, streak: data.stats?.streak || 0 });
    } catch (e: any) { setLoading(`Couldn't build this floor: ${e.message}`); return; }
    setLoading(""); scrollTo({ top: 0 });
  };
  const finish = async (r: Run) => {
    setLoading("Saving your floor…"); setRun(null);
    const before = top;
    const res = await api(`/api/ft/topic/${c.id}/level/${r.level}/result`, { json: { learner_id: learner, answers: r.answers } });
    await reload();
    setLoading(""); setResult({ ...res, level: r.level });
    if (res.passed && (r.level === QUIZ || r.level > before)) setFresh(r.level);
    if (res.passed) confetti(r.level === QUIZ);
  };

  if (loading) return <div className="glass mx-auto max-w-[760px] p-8 text-pink-200/75">{loading}</div>;
  if (run) return <Play run={run} setRun={setRun} onDone={finish} onQuit={() => setRun(null)} />;
  if (result) return <Result r={result} skills={data.skills} onNext={(n) => start(n)} onAgain={() => start(result.level, true)} onTower={() => setResult(null)} />;

  const rungs = [];
  for (let n = QUIZ; n >= 1; n--) {
    const k = SKILL[data.skills[n]] || "quiz", col = HUE[k], unlocked = n <= open, done = n === QUIZ ? quiz : lv[n]?.passed, now = n === open && !done;
    rungs.push(
      <div key={n} className={cn("grid grid-cols-[40px_1fr_auto] items-center gap-3 rounded-2xl border px-3.5 py-3 transition", now ? "bg-pink-500/5" : "border-pink-300/10 bg-white/[.03]", !unlocked && "opacity-40")}
        style={now ? { borderColor: col + "99", boxShadow: `0 0 40px -18px ${col}` } : undefined}>
        <div className="grid size-10 place-items-center rounded-xl border font-mono text-base font-bold" style={done ? { background: col, color: "#1a0d14", borderColor: col, boxShadow: `0 0 18px -4px ${col}` } : { color: col, borderColor: col + "66", background: col + "22" }}>{n === QUIZ ? "★" : n}</div>
        <div className="min-w-0"><div className="text-xs font-bold" style={{ color: col }}>{n === QUIZ ? "Final quiz" : `Floor ${n} · ${data.skills[n]}`}</div><div className="text-sm text-pink-200/80">{data.blurbs[n]}</div></div>
        <div className="flex items-center gap-2">
          {lv[n] && <span className="hidden gap-0.5 sm:flex">{[1, 2, 3].map((s) => <Star key={s} on={s <= lv[n].stars} />)}</span>}
          {unlocked ? (now
            ? <ShimmerButton onClick={() => start(n)} className="px-3.5 py-1.5 text-sm font-semibold" background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">Climb</ShimmerButton>
            : <button onClick={() => start(n)} className="rounded-full border border-pink-300/25 bg-white/5 px-3 py-1.5 text-sm font-semibold hover:border-pink-300/50">{done ? "Replay" : "Climb"}</button>)
            : <svg viewBox="0 0 24 24" className="size-4 text-pink-200/60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
        </div>
      </div>);
  }
  return (
    <>
      <a href="#/play" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-pink-200/80 hover:text-white">← All chapters</a>
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(280px,1fr)_1.15fr]">
        <SpotlightCard className="grid justify-items-center px-4 pb-4 pt-5 lg:sticky lg:top-24">
          <TowerSVG top={top} quiz={quiz} fresh={fresh} skills={data.skills} />
          <div className="mt-1 text-center"><b className="font-mono text-[28px]">{top}</b><span className="text-pink-200/70">/10 floors{quiz ? " · roof on" : ""}</span>{c.mastery && <div className="text-sm text-pink-200/70">mastery {c.mastery} of 5</div>}</div>
        </SpotlightCard>
        <div className="min-w-0">
          <div className="eyebrow">{t.mod} · {t.kt} · {c.passages} passages</div>
          <h1 className="mt-3 text-h2 [text-wrap:balance]">{t.name}</h1>
          <p className="mt-3 text-pink-200/75">Get 3 of 5 right to build the next floor. Every question cites the passage it came from.</p>
          <div className="mt-5 grid gap-2">{rungs}</div>
        </div>
      </div>
    </>
  );
}

function Play({ run, setRun, onDone, onQuit }: { run: Run; setRun: (r: Run) => void; onDone: (r: Run) => void; onQuit: () => void }) {
  const q: Q = run.data.questions[run.i];
  const [sure, setSure] = useState<string | null>(null);
  const [done, setDone] = useState<null | { ok: boolean; picked?: number; timeout?: boolean; xp: number }>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [pick, setPick] = useState<{ term?: number; clue?: number }>({});
  const [mistakes, setMistakes] = useState(0);
  const [wrongClue, setWrongClue] = useState<number | null>(null);
  const [left, setLeft] = useState<number>(q.seconds || 0);
  const [timeUp, setTimeUp] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const level = run.level, k = level === QUIZ ? "quiz" : SKILL[run.data.skill] || "recall", col = HUE[k];
  const timed = q.seconds && (q.type === "cloze" || q.type === "match");

  useEffect(() => { setSure(null); setDone(null); setMatched(new Set()); setPick({}); setMistakes(0); setWrongClue(null); setLeft(q.seconds || 0); setTimeUp(false); }, [run.i]);
  useEffect(() => {
    if (!timed || done) return;
    const t0 = performance.now() - ((q.seconds - left) * 1000);
    const id = setInterval(() => { const l = Math.max(0, q.seconds - (performance.now() - t0) / 1000); setLeft(l); if (l <= 0) { clearInterval(id); resolve(false, { timeout: true }); setTimeUp(true); } }, 100);
    return () => clearInterval(id);
  }, [run.i, done, timed]);

  const resolve = (ok: boolean, info: { picked?: number; timeout?: boolean } = {}) => {
    if (done) return;
    const s = sure || "guess", streak = ok ? run.streak + 1 : 0;
    const xp = ok ? Math.round((10 + (level === QUIZ ? 5 : level)) * SURE_X[s]) + 2 * Math.min(streak - 1, 5) : 0;
    setDone({ ok, xp, ...info });
    setRun({ ...run, streak, xp: run.xp + xp, answers: [...run.answers, { ok, sure: s, xp }] });
    if (!ok) card.current?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 350 });
  };
  const answer = (i: number) => { if (!sure || done) return; resolve(q.type === "truefalse" ? (i === 0) === q.answer : i === q.answer, { picked: i }); };
  const pair = (clue: number, term: number) => {
    setPick({});
    if (q.answer[clue] === term) {
      const m = new Set(matched); m.add(clue); setMatched(m);
      if (m.size === q.clues.length) resolve(mistakes === 0);
    } else { setMistakes(mistakes + 1); if (wrongClue === null) setWrongClue(clue); }
  };
  const next = () => run.i < run.data.questions.length - 1 ? setRun({ ...run, i: run.i + 1 }) : onDone(run);

  // Keyboard: 1-3 picks how sure, then 1-4 answers; Enter moves on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target instanceof Element && e.target.matches("input, textarea")) || document.querySelector("[aria-modal=true]")) return;
      if (done && e.key === "Enter") { e.preventDefault(); next(); return; }
      const n = Number(e.key);
      if (!n || done) return;
      if (!sure && n <= 3) setSure(SURE[n - 1][0]);
      else if (sure && q.type === "truefalse" && n <= 2) answer(n - 1);
      else if (sure && q.options && n <= q.options.length) answer(n - 1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const shown = q.type === "match" && wrongClue != null ? q.cites[wrongClue] : q.cites[0];
  const passage = run.data.passages[String(shown.n)];
  const optState = (j: number) => {
    if (!done) return "";
    const right = q.type === "truefalse" ? (j === 0) === q.answer : j === q.answer;
    return right ? "right" : j === done.picked ? "wrong" : "";
  };
  const optCls = (s: string) => s === "right" ? "border-pink-300 bg-pink-300/10 shadow-[0_0_22px_-8px_#ff9ccb]" : s === "wrong" ? "hatch border-dashed border-grey bg-zinc-800/70" : "border-pink-300/20 bg-white/[.025] hover:border-pink-300/50";

  return (
    <div className="mx-auto max-w-[760px]" style={{ ["--c" as any]: col }}>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => (run.answers.length ? setAskLeave(true) : onQuit())} aria-label="Leave this floor"
          className="grid size-[38px] shrink-0 place-items-center rounded-xl border border-pink-300/25 bg-white/5">✕</button>
        <span className="whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-bold text-[#1a0d14]" style={{ background: col }}>{level === QUIZ ? "Final quiz" : `Floor ${level} · ${run.data.skill}`}</span>
        <div className="flex flex-1 gap-1.5" aria-label={`Question ${run.i + 1} of ${run.data.questions.length}`}>
          {run.data.questions.map((_: any, j: number) => { const a = run.answers[j]; return <i key={j} className={cn("h-1.5 flex-1 rounded", a ? (a.ok ? "bg-pink-300 shadow-[0_0_10px_-2px_#ff9ccb]" : "hatch bg-zinc-800 outline outline-1 outline-dashed outline-grey") : j === run.i ? "bg-pink-200/45" : "bg-white/10")} />; })}
        </div>
        <span className="hidden font-mono text-sm sm:inline">⚡ {run.xp}</span>
      </div>
      <div ref={card} className="glass p-[clamp(20px,3vw,32px)]" style={{ boxShadow: `0 0 0 1px ${col}33, 0 24px 48px -28px rgba(0,0,0,.8)` }}>
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-[13px] font-bold" style={{ color: col }}>{q.prompt}</div>
            {q.stem && q.type !== "match" && q.type !== "spot" && <p className="mt-2.5 text-[clamp(19px,2.3vw,24px)] font-medium leading-snug tracking-tight">{q.type === "truefalse" ? "“" : ""}{q.stem.split("_____").map((s: string, i: number, arr: string[]) => <span key={i}>{s}{i < arr.length - 1 && <span className="inline-block h-[1.05em] min-w-[76px] border-b-2 align-[-3px]" style={{ borderColor: col }} />}</span>)}{q.type === "truefalse" ? "”" : ""}</p>}</div>
          {timed && <div className="relative size-[62px] shrink-0">
            <svg viewBox="0 0 62 62" className="size-[62px] -rotate-90"><circle cx="31" cy="31" r="26" fill="none" stroke="rgba(255,170,210,.1)" strokeWidth="5" />
              <circle cx="31" cy="31" r="26" fill="none" strokeWidth="5" strokeLinecap="round" stroke={left / q.seconds < 0.2 ? "#a1a1aa" : left / q.seconds < 0.4 ? "#c00d68" : "#ff3d9a"} strokeDasharray="163.4" strokeDashoffset={163.4 * (1 - left / q.seconds)} /></svg>
            <b className="absolute inset-0 grid place-items-center font-mono text-[17px]">{Math.ceil(left)}</b></div>}
        </div>
        <div className={cn("mt-6 rounded-2xl border p-3.5", sure ? "border-pink-400/40" : "border-pink-300/10", "bg-white/[.03]")}>
          <p className="mb-2.5 text-sm font-semibold">How sure are you?</p>
          <div className="grid grid-cols-3 gap-2">{SURE.map(([v, l]) => <button key={v} disabled={!!done} onClick={() => setSure(v)}
            className={cn("rounded-xl border px-1.5 py-2.5 text-sm font-semibold transition", sure === v ? "border-pink-400 bg-gradient-to-br from-pink-500/45 to-pink-700/35 text-white" : "border-pink-300/20 text-pink-200/80 hover:text-white")}>{l}</button>)}</div>
        </div>
        <div className={cn("mt-4 grid gap-2.5 transition", !sure && !done && "pointer-events-none opacity-35 blur-[1px]")}>
          {q.type === "truefalse" && <div className="grid grid-cols-2 gap-2.5">{["True", "False"].map((l, j) => <button key={l} disabled={!!done} onClick={() => answer(j)} className={cn("rounded-2xl border p-4 text-[17px] font-bold", optCls(optState(j)))}>{l}</button>)}</div>}
          {q.type === "spot" && <div className="flex flex-wrap gap-1.5">{q.tokens.map((tk: string, j: number) => <button key={j} disabled={!!done} onClick={() => answer(j)} className={cn("rounded-lg border px-2 py-1.5 text-[17px]", optCls(optState(j)))}>{tk}</button>)}</div>}
          {q.options && q.type !== "truefalse" && q.options.map((o: string, j: number) => (
            <button key={j} disabled={!!done} onClick={() => answer(j)} className={cn("grid grid-cols-[30px_1fr] items-start gap-3 rounded-2xl border px-4 py-3 text-left text-[15.5px] leading-snug transition", optCls(optState(j)))}>
              <span className={cn("grid size-7 place-items-center rounded-lg font-mono text-[13px] font-bold", optState(j) === "right" ? "bg-pink-300 text-[#1a0d14]" : "bg-white/10")}>{"ABCD"[j]}</span><span>{o}</span></button>))}
          {q.type === "match" && <>
            {q.clues.map((cl: string, j: number) => (
              <button key={j} disabled={!!done || matched.has(j)} onClick={() => (pick.term != null ? pair(j, pick.term) : setPick({ clue: j }))}
                className={cn("rounded-2xl border px-3.5 py-3 text-left text-[15px]", matched.has(j) || (done && !done.ok) ? "border-pink-300/60 bg-pink-300/10" : pick.clue === j ? "border-pink-300 bg-pink-500/10" : "border-dashed border-pink-300/25")}>
                {cl.split("_____").map((s, i, arr) => <span key={i}>{s}{i < arr.length - 1 && (matched.has(j) || done ? <b className="text-pink-100">{q.terms[q.answer[j]]}</b> : <span className="inline-block min-w-[60px] border-b-2 border-pink-400 align-[-3px]">&nbsp;</span>)}</span>)}
              </button>))}
            <div className="flex flex-wrap gap-2">{q.terms.map((tm: string, j: number) => { const used = Object.values(q.answer).includes(j) && [...matched].some((ci) => q.answer[ci] === j);
              return <button key={j} disabled={!!done || used} onClick={() => (pick.clue != null ? pair(pick.clue, j) : setPick({ term: j }))}
                className={cn("rounded-full border px-3.5 py-1.5 font-semibold", used ? "opacity-25" : pick.term === j ? "border-pink-400 bg-pink-500 text-white" : "border-pink-400/60 bg-pink-600/20 text-pink-100")}>{tm}</button>; })}</div>
            <p className="text-sm text-pink-200/65">Tap a term, then the line it completes.</p>
          </>}
        </div>
        <AnimatePresence>
          {done && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("mt-5 rounded-2xl border px-[18px] py-4", done.ok ? "border-pink-300/40 bg-pink-300/[.08]" : "hatch border-dashed border-grey bg-zinc-900/80")}>
              <h3 className="flex flex-wrap items-center gap-2.5 text-lg font-semibold">{done.ok ? <>Right <span className="font-mono text-pink-200">+{done.xp} XP</span>{run.streak >= 3 && <span className="rounded-full bg-pink-500 px-2 py-0.5 text-xs text-white">🔥 {run.streak} in a row</span>}</>
                : <>{done.timeout ? "Out of time" : "Not quite"}{sure === "certain" && <span className="rounded-full border border-dashed border-grey px-2 py-0.5 text-xs">You were certain</span>}</>}</h3>
              {!done.ok && <>
                <p className="mt-2 text-pink-100/85">{q.type === "truefalse" ? (q.answer ? "It's true: this line is word for word from the notes." : <>It's false. The notes say “<b>{q.original}</b>”, not “{q.changed}”.</>)
                  : q.type === "spot" ? <>The planted word was “<b>{q.changed}</b>”. The notes say “<b>{q.original}</b>”.</>
                  : q.type === "match" ? "Here's the line you mixed up, in the notes:"
                  : q.pick_unsupported ? <>The changed line said “{q.changed}”. The notes say “<b>{q.original}</b>”.</>
                  : <>The answer is “<b>{q.options[q.answer]}</b>”. Here's where the notes say so:</>}</p>
                {passage && <div id="fb-passage"><PassageBox p={passage} sentence={shown.sentence} /></div>}
              </>}
              <p className="mt-2 text-sm text-pink-200/70">Source {q.cites.map((c: any) => <span key={c.n} className="mx-0.5 rounded-md border border-pink-400/50 bg-pink-600/25 px-1.5 font-mono text-[11.5px] font-bold">P{c.n}</span>)}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <Modal full icon={Icon.clock} open={timeUp} title="Time's up" onClose={() => setTimeUp(false)}
          primary={{ label: run.i === run.data.questions.length - 1 ? "See how you did" : "Continue", onClick: () => { setTimeUp(false); next(); } }}
          secondary={{ label: "Show me the passage", onClick: () => { setTimeUp(false); setTimeout(() => document.getElementById("fb-passage")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); } }}>
          This one counts as not answered. The right answer and the passage it comes from are waiting on the card.
        </Modal>
        <Modal open={askLeave} title="Leave this floor?" onClose={() => setAskLeave(false)}
          primary={{ label: "Keep climbing", onClick: () => setAskLeave(false) }}
          secondary={{ label: "Leave without saving", onClick: () => { setAskLeave(false); onQuit(); } }}>
          Your answers on this floor so far won't be saved.
        </Modal>
        {done && <div className="mt-4 flex justify-end"><ShimmerButton autoFocus onClick={next} className="gap-2 px-5 py-2.5 font-semibold" background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">{run.i === run.data.questions.length - 1 ? "See how you did" : "Next"}{Icon.arrow}</ShimmerButton></div>}
      </div>
    </div>
  );
}

function PassageBox({ p, sentence }: { p: any; sentence: string }) {
  const box = useRef<HTMLDivElement>(null);
  const parts = useMemo(() => { const at = sentence ? p.text.indexOf(sentence) : -1; return at < 0 ? [p.text, "", ""] : [p.text.slice(0, at), sentence, p.text.slice(at + sentence.length)]; }, [p, sentence]);
  useEffect(() => { const m = box.current?.querySelector("mark"); if (m && box.current) box.current.scrollTop = Math.max(0, (m as HTMLElement).offsetTop - 30); }, [parts]);
  return (
    <div ref={box} className="relative mt-3 max-h-[260px] overflow-auto rounded-xl border border-pink-300/15 bg-[#0c0b0e]/80 px-4 py-3.5 text-[14.5px] leading-relaxed text-pink-100/80">
      <div className="mb-1.5 font-mono text-xs font-bold text-pink-300">P{p.n} · {p.section}</div>
      {parts[0]}{parts[1] && <mark className="rounded bg-pink-300/25 px-0.5 text-white ring-1 ring-pink-300/60">{parts[1]}</mark>}{parts[2]}
    </div>
  );
}

function Result({ r, skills, onNext, onAgain, onTower }: { r: any; skills: Record<string, string>; onNext: (n: number) => void; onAgain: () => void; onTower: () => void }) {
  const nxt = r.level < QUIZ && r.passed ? r.level + 1 : null;
  return (
    <SpotlightCard className="mx-auto mt-[4vh] max-w-[620px] px-6 py-[clamp(28px,5vw,48px)] text-center">
      <span className="rounded-full bg-pink-300 px-3 py-1 text-[12.5px] font-bold text-[#1a0d14]">{r.level === QUIZ ? "Final quiz" : `Floor ${r.level} · ${skills[r.level]}`}</span>
      <div className="mb-2 mt-4 font-mono text-display tabular-nums"><NumberTicker value={r.correct} /><span className="text-pink-200/50">/{r.total}</span></div>
      <div className="my-3 flex justify-center gap-2">{[1, 2, 3].map((s) => <motion.span key={s} initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.15 * s, type: "spring" }}><svg viewBox="0 0 24 24" className={cn("size-9", s <= r.stars ? "text-pink-200 drop-shadow-[0_0_6px_rgba(255,209,230,.8)]" : "text-pink-300/15")} fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg></motion.span>)}</div>
      <h2 className="text-h3">{r.passed ? (r.level === QUIZ ? "Roof's on. Chapter complete." : `Floor ${r.level} built.`) : `So close. ${Math.ceil(0.6 * r.total)} right builds the floor.`}</h2>
      <p className="mt-1 text-pink-200/75"><b className="font-mono text-pink-200">+{r.xp} XP</b> · best streak {r.stats.best_streak}</p>
      <div className="mt-4 inline-flex items-center gap-2.5 rounded-xl border border-pink-300/15 bg-white/5 px-3.5 py-2.5 text-sm text-pink-200/80">Chapter mastery
        <span className="flex gap-0.5">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={cn("h-2 w-3.5 rounded-sm", i <= r.mastery.level ? "bg-gradient-to-r from-pink-600 to-pink-300" : "bg-white/10")} />)}</span><b>{r.mastery.level}/5</b></div>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        {nxt && <ShimmerButton onClick={() => onNext(nxt)} className="gap-2 px-5 py-2.5 font-semibold" background="linear-gradient(135deg,#e6197f,#c00d68)" shimmerColor="#ffd1e6">{nxt === QUIZ ? "Take the final quiz" : `Climb floor ${nxt}`}{Icon.arrow}</ShimmerButton>}
        <button onClick={onAgain} className="rounded-full border border-pink-300/25 bg-white/5 px-4 py-2.5 font-semibold">{r.passed ? "Play again" : "Try again"} · new questions</button>
        <button onClick={onTower} className="rounded-full border border-pink-300/25 bg-white/5 px-4 py-2.5 font-semibold">See the tower</button>
      </div>
    </SpotlightCard>
  );
}
