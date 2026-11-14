/* How the agents work, in three labelled lanes so it is clear what each agent is for (dev note 67):
   1. Lesson plans, built only from the school's notes: Principal → Librarian → Subject Teacher ⇄
      Examiner → the teacher approves.
   2. After each class, from the Meet transcript: the Class Observer reads who took part and what was
      missed; missed content goes back to the Principal for the next plan.
   3. Learner tests: the Counsellor flags who needs help, a personal test is set one level above their
      mastery, and the Examiner checks its memo before the learner climbs.
   Edges flow (motion-safe); the send-back edge is red. */
import { useEffect } from "react";
import { createPortal } from "react-dom";

type N = { id: string; x: number; y: number; label: string; sub: string; human?: boolean };
const R1 = 100, R2 = 270, R3 = 440;
const NODES: N[] = [
  { id: "notes", x: 95, y: R1, label: "School's notes", sub: "the only source", human: true },
  { id: "principal", x: 265, y: R1, label: "Principal", sub: "plans the term" },
  { id: "librarian", x: 435, y: R1, label: "Librarian", sub: "finds passages" },
  { id: "teacher", x: 605, y: R1, label: "Subject Teacher", sub: "drafts the lesson" },
  { id: "examiner", x: 775, y: R1, label: "Examiner", sub: "checks every line" },
  { id: "approve", x: 945, y: R1, label: "Teacher approves", sub: "nothing ships before", human: true },
  { id: "meet", x: 95, y: R2, label: "Class on Meet", sub: "transcript + register", human: true },
  { id: "observer", x: 265, y: R2, label: "Class Observer", sub: "reads the transcript" },
  { id: "progress", x: 435, y: R2, label: "Teacher's view", sub: "who took part, what's missed", human: true },
  { id: "counsellor", x: 265, y: R3, label: "Counsellor", sub: "flags who needs help" },
  { id: "test", x: 435, y: R3, label: "Personal test", sub: "one level above mastery" },
  { id: "examiner2", x: 605, y: R3, label: "Examiner", sub: "checks the memo" },
  { id: "learner", x: 775, y: R3, label: "Learner climbs", sub: "floor by floor", human: true },
];
const at = (id: string) => NODES.find((n) => n.id === id)!;
const EDGES: { a: string; b: string; red?: boolean; label?: string; bend?: number }[] = [
  { a: "notes", b: "principal" }, { a: "principal", b: "librarian" }, { a: "librarian", b: "teacher" },
  { a: "teacher", b: "examiner" }, { a: "examiner", b: "teacher", red: true, label: "sent back, rewritten" },
  { a: "examiner", b: "approve" },
  { a: "meet", b: "observer" }, { a: "observer", b: "progress" },
  { a: "observer", b: "principal", label: "missed content → next plan" },
  { a: "observer", b: "counsellor", label: "who struggled" },
  { a: "counsellor", b: "test" }, { a: "test", b: "examiner2" }, { a: "examiner2", b: "learner" },
];
const LANES = [
  { y: R1, n: "1", title: "Lesson plans", who: "for the teacher · built only from the school's notes", tint: "rgba(255,61,154,.07)" },
  { y: R2, n: "2", title: "After each class", who: "reads the Google Meet transcript and register", tint: "rgba(122,162,255,.07)" },
  { y: R3, n: "3", title: "Learner tests", who: "for each learner · personal practice", tint: "rgba(120,220,160,.07)" },
];
const W = 150, H = 58;

function path(e: (typeof EDGES)[number]) {
  const A = at(e.a), B = at(e.b), dx = B.x - A.x, dy = B.y - A.y;
  if (e.red) {   // the send-back loop runs under both boxes so it reads as a loop, not a smudge
    const y = A.y + H / 2;
    return { d: `M ${A.x} ${y} C ${A.x} ${y + 34} ${B.x} ${y + 34} ${B.x} ${y + 4}`, lx: (A.x + B.x) / 2, ly: y + 42 };
  }
  const sx = A.x + (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) * W / 2 : 0), sy = A.y + (Math.abs(dy) >= Math.abs(dx) ? Math.sign(dy) * H / 2 : 0);
  const ex = B.x - (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) * W / 2 : 0), ey = B.y - (Math.abs(dy) >= Math.abs(dx) ? Math.sign(dy) * H / 2 : 0);
  const bend = e.bend ? (e.red ? -e.bend : e.bend) : 0;
  const mx = (sx + ex) / 2, my = (sy + ey) / 2 + bend;
  return { d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`, lx: dy ? mx + 8 : mx, ly: dy ? my : my + (bend > 0 ? 16 : -6) };
}

export default function AgentsDiagram({ onClose }: { onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="How the agents work" className="fixed inset-0 z-[70] grid place-items-center bg-[#0c0b0e]/92 p-4 backdrop-blur" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[1100px]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-h2">How the agents work</h2>
          <button onClick={onClose} className="rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold text-pink-100 hover:border-pink-300/60">Close</button>
        </div>
        <svg viewBox="0 0 1040 530" className="w-full" role="img" aria-label="Three lanes. 1, lesson plans for the teacher: the school's notes go to the Principal, Librarian and Subject Teacher; the Examiner checks every line and sends unsupported ones back; the teacher approves. 2, after each class: the Class Observer reads the Meet transcript, shows the teacher who took part, and sends missed content back to the Principal for the next plan. 3, learner tests: the Counsellor flags who struggled, a personal test is set one level above mastery, the Examiner checks its memo, and the learner climbs.">
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff9ccb" /></marker>
            <marker id="ahr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff5470" /></marker>
          </defs>
          <style>{`.flow{stroke-dasharray:6 6;animation:flow 1.2s linear infinite}@keyframes flow{to{stroke-dashoffset:-24}}@media (prefers-reduced-motion:reduce){.flow{animation:none}}`}</style>
          {LANES.map((l) => (
            <g key={l.n}>
              <rect x="6" y={l.y - 72} width="1028" height="148" rx="18" fill={l.tint} stroke="rgba(255,255,255,.08)" />
              <text x="22" y={l.y - 50} fontSize="14" fontWeight="700" fill="#fff0f7">{l.n} · {l.title}</text>
              <text x={30 + (l.title.length + 4) * 8.6} y={l.y - 50} fontSize="12.5" fill="#ffb3d6">{l.who}</text>
            </g>
          ))}
          {EDGES.map((e, i) => {
            const p = path(e);
            return (
              <g key={i}>
                <path d={p.d} fill="none" stroke={e.red ? "#ff5470" : "#ff9ccb"} strokeOpacity={e.red ? 1 : 0.75} strokeWidth={e.red ? 2.4 : 1.8} className="flow" markerEnd={`url(#${e.red ? "ahr" : "ah"})`} />
                {e.label && <text x={p.lx} y={p.ly} textAnchor={at(e.a).y !== at(e.b).y ? "start" : "middle"} fontSize="13" fill={e.red ? "#ff8fa0" : "#ffd1e6"}>{e.label}</text>}
              </g>
            );
          })}
          {NODES.map((n) => (
            <g key={n.id}>
              <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx="14" fill={n.human ? "#1b1520" : "#26121d"} stroke={n.human ? "rgba(255,255,255,.35)" : "#ff3d9a"} strokeWidth="1.6"
                style={n.human ? undefined : { filter: "drop-shadow(0 0 10px rgba(255,61,154,.45))" }} />
              <text x={n.x} y={n.y - 4} textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff0f7">{n.label}</text>
              <text x={n.x} y={n.y + 16} textAnchor="middle" fontSize="12.5" fill="#ffb3d6">{n.sub}</text>
            </g>
          ))}
        </svg>
        <p className="mt-2 text-center text-sm text-pink-200/70">Pink boxes are AI agents, grey boxes are people and sources. The red arrow is self-correction: the Examiner sends a line back until the notes support it.</p>
      </div>
    </div>,
    document.body,
  );
}
