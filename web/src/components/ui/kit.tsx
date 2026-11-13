/* Small motion kit in the Magic UI style: number ticker, spotlight card, progress ring, confetti.
   (The beam and shimmer button are the 21st.dev originals in their own files.) */
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { createPortal } from "react-dom";
import confettiLib from "canvas-confetti";
import { cn } from "@/lib/utils";

export function NumberTicker({ value, className, delay = 0 }: { value: number; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { damping: 60, stiffness: 120 });
  const inView = useInView(ref, { once: true, margin: "0px" });
  useEffect(() => {
    // If animation frames or intersection events are paused (background tab, screenshot), still land on the real number.
    const done = setTimeout(() => { if (ref.current) ref.current.textContent = value.toLocaleString("en-ZA"); }, (delay + 2.5) * 1000);
    if (!inView) return () => clearTimeout(done);
    const t = setTimeout(() => mv.set(value), delay * 1000);
    return () => { clearTimeout(t); clearTimeout(done); };
  }, [mv, inView, value, delay]);
  useEffect(() => spring.on("change", (v) => {
    if (ref.current) ref.current.textContent = Math.max(0, Math.round(v)).toLocaleString("en-ZA");
  }), [spring]);
  return <span ref={ref} className={cn("inline-block tabular-nums font-mono tracking-tight", className)}>0</span>;
}

export function SpotlightCard({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -400, y: -400 });
  return (
    <div ref={ref} style={style}
      onPointerMove={(e) => { const r = ref.current!.getBoundingClientRect(); setPos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
      onPointerLeave={() => setPos({ x: -400, y: -400 })}
      className={cn("glass overflow-hidden min-w-0", className)}>
      <div className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{ background: `radial-gradient(380px circle at ${pos.x}px ${pos.y}px, rgba(255,61,154,.13), transparent 45%)` }} />
      <div className="contents">{children}</div>
    </div>
  );
}

export function ProgressRing({ value, max, size = 150, color = "#ff3d9a", children }:
  { value: number; max: number; size?: number; color?: string; children?: ReactNode }) {
  const r = 62, c = 2 * Math.PI * r, k = max ? Math.min(1, Math.max(0, value / max)) : 0;
  const circle = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (!circle.current) return;
    const ctl = animate(c, c * (1 - k), { duration: 1.6, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => circle.current?.setAttribute("stroke-dashoffset", String(v)) });
    return () => ctl.stop();
  }, [c, k]);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 150 150" className="absolute inset-0 -rotate-90 overflow-visible">
        {Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * 2 * Math.PI, r1 = i % 5 ? 70 : 67;
          return <line key={i} x1={75 + r1 * Math.cos(a)} y1={75 + r1 * Math.sin(a)} x2={75 + 73 * Math.cos(a)} y2={75 + 73 * Math.sin(a)} stroke="rgba(255,170,210,.22)" strokeWidth="1.5" />; })}
        <circle cx="75" cy="75" r={r} fill="none" stroke="rgba(255,170,210,.08)" strokeWidth="10" />
        <circle ref={circle} cx="75" cy="75" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

export function confetti(big = false) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#e6197f", "#ff3d9a", "#ff9ccb", "#ffd1e6", "#fff0f7", "#c00d68"];
  const n = big ? 160 : 90;
  confettiLib({ particleCount: n, angle: 60, spread: 70, origin: { x: 0, y: 0.8 }, colors });
  confettiLib({ particleCount: n, angle: 120, spread: 70, origin: { x: 1, y: 0.8 }, colors });
}

export const Icon = {
  check: <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>,
  warn: <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.01" /></svg>,
  clock: <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  arrow: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
};

export type Status = "ok" | "risk" | "late";
export const STATUS_WORD: Record<Status, string> = { ok: "on track", risk: "at risk", late: "won't finish" };

// Status never by colour alone: icon + label + fill style.
export function StatusPill({ s, label = true }: { s: Status; label?: boolean }) {
  const cls = s === "ok" ? "bg-pink-300 text-[#1a0d14] shadow-[0_0_10px_-2px_#ff9ccb]"
    : s === "risk" ? "bg-pink-500 text-white" : "hatch bg-zinc-700 text-pink-100 outline outline-1 outline-dashed outline-grey";
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold", cls)}>
      {s === "ok" ? Icon.check : s === "risk" ? Icon.warn : Icon.clock}{label && STATUS_WORD[s]}
    </span>
  );
}

/** Full-page modal: portal to <body>, above the nav, blurred backdrop, focus trapped and restored,
    Enter runs the primary action, Escape closes, the page behind does not scroll. */
export function Modal({ open, title, children, primary, secondary, onClose, full, icon }: {
  open: boolean; title: string; children?: ReactNode; full?: boolean; icon?: ReactNode;
  primary: { label: string; onClick: () => void }; secondary?: { label: string; onClick: () => void }; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => box.current?.querySelector<HTMLElement>("[data-primary]")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === "Enter" && !(e.target instanceof Element && e.target.closest("[data-secondary]"))) { e.preventDefault(); e.stopPropagation(); primary.onClick(); return; }
      if (e.key === "Tab") {
        const f = [...(box.current?.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])") || [])];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    addEventListener("keydown", onKey, true);
    return () => { clearTimeout(t); removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; before?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className={cn("fixed inset-0 z-[1000] grid place-items-center p-5", full ? "bg-[#0c0b0e]/[.96] backdrop-blur-xl" : "bg-black/70 backdrop-blur-md")} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div ref={box} role="dialog" aria-modal="true" aria-labelledby="modal-title"
        initial={reduce || full ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className={full ? "w-full max-w-[640px] text-center" : "glass w-full max-w-[460px] p-6 text-center md:p-8"}>
        {full && icon && <div className="mx-auto mb-6 grid size-24 place-items-center rounded-full border border-pink-400/40 bg-pink-500/10 text-pink-300 shadow-[0_0_60px_-10px_rgba(230,25,127,.8)] [&_svg]:size-11">{icon}</div>}
        <h2 id="modal-title" className={full ? "text-display" : "text-h2"}>{title}</h2>
        {children && <div className={cn("text-body text-pink-200/80", full ? "mx-auto mt-4 max-w-[52ch] text-[17px]" : "mt-3")}>{children}</div>}
        <div className={cn("flex flex-wrap justify-center gap-3", full ? "mt-9" : "mt-6")}>
          <button data-primary onClick={primary.onClick} className="rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-6 py-3 text-body font-semibold text-white shadow-[0_10px_30px_-12px_rgba(230,25,127,.75)]">{primary.label}</button>
          {secondary && <button data-secondary onClick={secondary.onClick} className="rounded-full border border-pink-300/30 px-5 py-3 text-body font-semibold text-pink-100 hover:border-pink-300/60">{secondary.label}</button>}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
