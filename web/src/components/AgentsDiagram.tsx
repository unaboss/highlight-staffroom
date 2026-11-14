/* How the agents work, as one diagram: the lesson loop (Principal → Librarian → Subject Teacher ⇄
   Examiner → teacher approves) and the class loop (Class Observer → Examiner → Counsellor → personal
   test → teacher approves). Edges flow (motion-safe); the send-back edge is red. */
import { useEffect } from "react";
import { createPortal } from "react-dom";

type N = { id: string; x: number; y: number; label: string; sub: string; human?: boolean };
const NODES: N[] = [
  { id: "notes", x: 90, y: 70, label: "Your notes", sub: "the only source", human: true },
  { id: "principal", x: 300, y: 70, label: "Principal", sub: "plans the term" },
  { id: "librarian", x: 510, y: 70, label: "Librarian", sub: "finds passages P1, P2…" },
  { id: "teacher", x: 720, y: 70, label: "Subject Teacher", sub: "drafts, cites every line" },
  { id: "examiner", x: 720, y: 230, label: "Examiner", sub: "checks each line" },
  { id: "approve", x: 930, y: 230, label: "Teacher approves", sub: "nothing ships before", human: true },
  { id: "meet", x: 90, y: 390, label: "Class on Meet", sub: "transcript + register", human: true },
  { id: "observer", x: 300, y: 390, label: "Class Observer", sub: "who took part" },
  { id: "counsellor", x: 510, y: 390, label: "Counsellor", sub: "flags who needs help" },
  { id: "test", x: 720, y: 390, label: "Personal test", sub: "one level above mastery" },
  { id: "notesagent", x: 930, y: 390, label: "Notes agent", sub: "fixes feedback live" },
];
const at = (id: string) => NODES.find((n) => n.id === id)!;
const EDGES: { a: string; b: string; red?: boolean; label?: string; bend?: number }[] = [
  { a: "notes", b: "principal" }, { a: "principal", b: "librarian" }, { a: "librarian", b: "teacher" },
  { a: "teacher", b: "examiner", bend: 50 }, { a: "examiner", b: "teacher", red: true, label: "sent back, rewritten", bend: 50 },
  { a: "examiner", b: "approve", label: "passed" },
  { a: "meet", b: "observer" }, { a: "observer", b: "examiner", label: "what learners said" }, { a: "observer", b: "counsellor" },
  { a: "counsellor", b: "test" }, { a: "test", b: "examiner", label: "memo checked" },
  { a: "approve", b: "notesagent", label: "leaves a note" },
];
const W = 180, H = 62;

function path(e: (typeof EDGES)[number]) {
  const A = at(e.a), B = at(e.b), dx = B.x - A.x, dy = B.y - A.y;
  const sx = A.x + (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) * W / 2 : 0), sy = A.y + (Math.abs(dy) >= Math.abs(dx) ? Math.sign(dy) * H / 2 : 0);
  const ex = B.x - (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) * W / 2 : 0), ey = B.y - (Math.abs(dy) >= Math.abs(dx) ? Math.sign(dy) * H / 2 : 0);
  const bend = e.bend ? (e.red ? -e.bend : e.bend) : 0;
  const mx = (sx + ex) / 2 + bend, my = (sy + ey) / 2;
  return { d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`, lx: mx + (e.red ? -8 : 8), ly: my };
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
        <svg viewBox="0 0 1030 460" className="w-full" role="img" aria-label="Notes to Principal to Librarian to Subject Teacher; the Examiner checks each line and sends unsupported ones back; the teacher approves. A class on Meet goes to the Class Observer, then the Counsellor and a personal test, which the Examiner also checks.">
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff9ccb" /></marker>
            <marker id="ahr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff5470" /></marker>
          </defs>
          <style>{`.flow{stroke-dasharray:6 6;animation:flow 1.2s linear infinite}@keyframes flow{to{stroke-dashoffset:-24}}@media (prefers-reduced-motion:reduce){.flow{animation:none}}`}</style>
          {EDGES.map((e, i) => {
            const p = path(e);
            return (
              <g key={i}>
                <path d={p.d} fill="none" stroke={e.red ? "#ff5470" : "#ff9ccb"} strokeOpacity={e.red ? 1 : 0.75} strokeWidth={e.red ? 2.4 : 1.8} className="flow" markerEnd={`url(#${e.red ? "ahr" : "ah"})`} />
                {e.label && <text x={p.lx} y={p.ly} textAnchor={e.red ? "end" : "start"} fontSize="13" fill={e.red ? "#ff8fa0" : "#ffd1e6"}>{e.label}</text>}
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
        <p className="mt-2 text-center text-sm text-pink-200/70">Pink boxes are agents, grey boxes are people and sources. The red arrow is self-correction.</p>
      </div>
    </div>,
    document.body,
  );
}
