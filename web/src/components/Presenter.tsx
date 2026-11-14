/* Presenting: a small "i" on the right edge opens short, self-driving tours of the app (tours.json).
   Each step goes to a page, scrolls to an element, rings it and shows a one-line caption, then moves on.
   Pause, Next and Exit at any time. The tour survives page changes (sessionStorage). The "i" can be
   hidden in Settings → Presenting. */
import { useCallback, useEffect, useRef, useState } from "react";
import TOURS from "@/lib/tours.json";
import { cn } from "@/lib/utils";
import AgentsDiagram from "@/components/AgentsDiagram";

type Step = { route: string; find?: string; say: string; ms: number; click?: boolean; action?: string; text?: string };
type Tour = { id: string; title: string; role: string; steps: Step[] };
const tours = TOURS as Tour[];
const KEY = "cft-tour", HIDE = "cft-presenter-hidden";
const secs = (t: Tour) => Math.round(t.steps.reduce((a, s) => a + s.ms, 0) / 1000);

export const presenterHidden = () => { try { return localStorage.getItem(HIDE) === "1"; } catch { return false; } };
export function setPresenterHidden(v: boolean) {
  try { v ? localStorage.setItem(HIDE, "1") : localStorage.removeItem(HIDE); } catch { /* storage off */ }
  dispatchEvent(new Event("cft-presenter"));
}

/** Find a step's element: "tag:text" (an element of that tag containing the text), "main", or a CSS selector. */
function locate(find?: string): Element | null {
  if (!find) return null;
  const m = /^([a-z0-9*]+):(.+)$/i.exec(find);
  if (m && !find.includes("[")) {
    const [, tag, text] = m;
    const els = [...document.querySelectorAll(tag === "*" ? "main *" : tag)].filter((e) => (e as HTMLElement).innerText?.includes(text));
    return els.sort((a, b) => (a as HTMLElement).innerText.length - (b as HTMLElement).innerText.length)[0] || null;
  }
  try { return document.querySelector(find); } catch { return null; }
}

function notes(action: string) {
  const sr = document.getElementById("dev-notes-host")?.shadowRoot;
  if (!sr) return;
  const panel = sr.querySelector<HTMLElement>(".panel");
  if (action === "notes:open" && panel?.hidden) sr.querySelector<HTMLElement>(".fab")?.click();
  if (action === "notes:close" && panel && !panel.hidden) sr.querySelector<HTMLElement>(".close")?.click();
  if (action === "notes:detail") {
    if (panel?.hidden) sr.querySelector<HTMLElement>(".fab")?.click();
    const items = [...sr.querySelectorAll<HTMLElement>(".item")];
    const next = items.find((i) => i.getAttribute("aria-expanded") !== "true" && i.querySelector(".cite"));
    items.forEach((i) => { if (i.getAttribute("aria-expanded") === "true") i.click(); });
    next?.click();
  }
}

function ask(text: string) {
  const ta = document.querySelector<HTMLTextAreaElement>("[role=dialog] textarea");
  if (!ta) return;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  setTimeout(() => document.querySelector<HTMLButtonElement>("[role=dialog] button[type=submit]")?.click(), 400);
}

export default function Presenter() {
  const [hidden, setHidden] = useState(presenterHidden);
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<{ id: string; i: number } | null>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } });
  const [paused, setPaused] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [t0, setT0] = useState(0);
  const [diagram, setDiagram] = useState(false);
  const target = useRef<Element | null>(null);
  const tour = run ? tours.find((t) => t.id === run.id) : undefined;
  const step = tour && run ? tour.steps[run.i] : undefined;

  useEffect(() => { const f = () => setHidden(presenterHidden()); addEventListener("cft-presenter", f); return () => removeEventListener("cft-presenter", f); }, []);
  useEffect(() => { try { run ? sessionStorage.setItem(KEY, JSON.stringify(run)) : sessionStorage.removeItem(KEY); } catch { /* */ } }, [run]);

  const exit = useCallback(() => { setRun(null); setRect(null); target.current = null; setPaused(false); }, []);
  const next = useCallback(() => {
    setRun((r) => { if (!r || !tour) return null; return r.i + 1 < tour.steps.length ? { ...r, i: r.i + 1 } : null; });
  }, [tour]);

  // run a step: go to its page, find the element, ring it, act, then wait
  useEffect(() => {
    if (!tour || !step) return;
    let alive = true;
    try { localStorage.setItem("ftn.role", tour.role); } catch { /* */ }
    if (location.hash !== step.route) location.hash = step.route;
    target.current = null; setRect(null);
    const started = Date.now();
    const find = () => {
      if (!alive) return;
      const el = step.find ? locate(step.find) : null;
      if (el || !step.find || Date.now() - started > 7000) {
        target.current = el;
        el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        if (step.click && el instanceof HTMLElement) el.click();
        if (step.action?.startsWith("notes:")) notes(step.action);
        if (step.action === "principal:ask" && step.text) ask(step.text);
        setT0(Date.now());
      } else setTimeout(find, 250);
    };
    setTimeout(find, 300);
    return () => { alive = false; };
  }, [run?.id, run?.i]);   // eslint-disable-line react-hooks/exhaustive-deps

  // follow the ringed element as the page moves; advance when the step's time is up
  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => {
      const el = target.current;
      setRect(el && el !== document.querySelector("main") ? el.getBoundingClientRect() : null);
      if (!paused && !diagram && t0 && step && Date.now() - t0 >= step.ms) { setT0(0); next(); }
    }, 120);
    return () => clearInterval(id);
  }, [run, paused, diagram, t0, step, next]);

  useEffect(() => {
    if (!run) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") exit(); if (e.key === "ArrowRight") next(); if (e.key === " " && e.target === document.body) { e.preventDefault(); setPaused((p) => !p); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [run, exit, next]);

  const pct = step && t0 ? Math.min(100, ((Date.now() - t0) / step.ms) * 100) : 0;
  return (
    <>
      {!hidden && !run && (
        <button onClick={() => setOpen((o) => !o)} aria-label="Presenting tours" aria-expanded={open} title="Presenting tours"
          className="fixed right-3 top-1/2 z-40 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-pink-300/40 bg-[#16121a] font-serif text-[15px] font-bold italic text-pink-200 shadow-[0_0_18px_-6px_#ff3d9a] hover:border-pink-300">i</button>
      )}
      {open && !run && (
        <div role="dialog" aria-label="Presenting tours" className="glass fixed right-14 top-1/2 z-40 w-[min(300px,calc(100vw-80px))] -translate-y-1/2 p-3">
          <button onClick={() => { setOpen(false); setDiagram(true); }} className="mb-2 flex w-full items-center justify-between rounded-xl bg-gradient-to-br from-pink-500 to-pink-600 px-3 py-2 text-left text-sm font-semibold text-white">How the agents work<span aria-hidden="true">◇</span></button>
          <div className="mb-2 px-1 text-label font-semibold text-pink-200/80">Play a tour</div>
          <ul className="grid gap-1.5">
            {tours.map((t) => (
              <li key={t.id} className="group relative"><button onClick={() => { setOpen(false); setPaused(false); setRun({ id: t.id, i: 0 }); }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-pink-300/15 px-3 py-2 text-left text-sm hover:border-pink-300/50">
                <span className="font-semibold">{t.title}</span><span className="font-mono text-xs text-pink-200/60">{secs(t)}s</span></button>
                {/* hover or focus: what this tour will show */}
                <div role="tooltip" className="pointer-events-none invisible absolute right-full top-0 mr-3 w-[min(320px,calc(100vw-120px))] rounded-xl border border-pink-300/30 bg-[#120f15] p-3 text-left opacity-0 shadow-[0_20px_50px_-20px_rgba(0,0,0,.9)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <div className="mb-1.5 flex justify-between text-xs font-semibold text-pink-200/80"><span>{t.title}</span><span className="font-mono">{secs(t)}s</span></div>
                  <ol className="grid list-decimal gap-1 pl-4 text-[12.5px] leading-snug text-pink-50">{t.steps.map((s, i) => <li key={i}>{s.say} <span className="text-pink-200/50">{Math.round(s.ms / 1000)}s</span></li>)}</ol>
                </div></li>
            ))}
          </ul>
        </div>
      )}
      {run && rect && (
        <div aria-hidden="true" className="pointer-events-none fixed z-[60] rounded-2xl ring-2 ring-pink-300 transition-all duration-300 motion-reduce:transition-none"
          style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16, boxShadow: "0 0 0 9999px rgba(12,11,14,.45), 0 0 40px -6px #ff3d9a" }} />
      )}
      {run && tour && step && (
        <div className="fixed inset-x-0 top-0 z-[62] flex items-center gap-2 border-b border-pink-300/25 bg-[#120f15]/95 px-3 py-2 shadow-[0_10px_30px_-12px_rgba(0,0,0,.9)] backdrop-blur sm:gap-3 sm:px-5">
          <b className="hidden truncate text-sm text-pink-100 sm:block">{tour.title}</b>
          <span className="font-mono text-xs text-pink-200/60">{run.i + 1}/{tour.steps.length}</span>
          <div className="mx-1 h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-pink-300/10"><div className="h-full bg-pink-400 transition-[width] duration-100" style={{ width: pct + "%" }} /></div>
          <button onClick={() => setPaused((p) => !p)} className={cn("rounded-full px-4 py-1.5 text-sm font-bold", paused ? "bg-pink-300 text-[#1a0d14]" : "bg-gradient-to-br from-pink-500 to-pink-600 text-white")}>{paused ? "Play" : "Pause"}</button>
          <button onClick={next} className="rounded-full border border-pink-300/40 px-3.5 py-1.5 text-sm font-semibold text-pink-100">Next</button>
          <button onClick={() => setDiagram(true)} className="rounded-full border border-pink-300/40 px-3.5 py-1.5 text-sm font-semibold text-pink-100">Diagram</button>
          <button onClick={exit} className="rounded-full border border-pink-300/40 px-3.5 py-1.5 text-sm font-semibold text-pink-100">Exit</button>
        </div>
      )}
      {run && tour && step && (
        <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-[61] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border border-pink-300/30 bg-[#120f15]/95 px-4 py-3 text-center shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)] backdrop-blur">
          <p className="text-[16px] leading-snug text-pink-50">{step.say}</p>
        </div>
      )}
      {diagram && <AgentsDiagram onClose={() => setDiagram(false)} />}
    </>
  );
}
