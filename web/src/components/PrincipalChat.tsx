/* The Principal: a small chat in the bottom-right corner of the facilitator page. It answers from the
   class's own records (pacing, coverage, flags, tests), worded by the model saved in Settings.
   Built on the Vercel AI SDK's useChat: POST /api/principal/chat/stream speaks the UI message stream
   protocol, so the answer streams in token by token and a tool part says which records it read. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { store } from "@/lib/api";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING = "Good day. I'm the Principal. I keep an eye on pace, coverage, flags and tests. What would you like to know?";
const SUGGEST = ["Are we on track for the exam?", "Who is falling behind?", "What's waiting for my approval?", "Where do we pick up next lesson?"];
const KEY = "ftn.principal.chat";

const textOf = (m: UIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
/** The records the Principal read for this answer, from its tool part. */
const recordsOf = (m: UIMessage): string[] => {
  for (const p of m.parts as any[]) {
    if ((p.type === "dynamic-tool" || String(p.type).startsWith("tool-")) && p.output?.records) return p.output.records;
  }
  return [];
};
const toUI = (msgs: Msg[]): UIMessage[] => msgs.map((m, i) => ({ id: `h${i}`, role: m.role, parts: [{ type: "text", text: m.content }] }));

const Cap = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={cn("size-5", className)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 9.5 12 5l10 4.5-10 4.5z" /><path d="M6 11.3V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.7" /><path d="M22 9.5V15" />
  </svg>
);

export default function PrincipalChat({ courseId }: { courseId: number | null }) {
  const [open, setOpen] = useState(false);
  const [saved] = useState<Msg[]>(() => {
    try { return JSON.parse(store(KEY) || "[]"); } catch { return []; }
  });
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const course = useRef(courseId);
  course.current = courseId;
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/principal/chat/stream",
    prepareSendMessagesRequest: ({ messages }) => ({ body: { course_id: course.current, messages: messages.slice(-12) } }),
  }), []);
  const { messages: ui, sendMessage, setMessages, status, error } = useChat({
    transport, messages: toUI(saved),
    onData: (part: any) => { if (part?.type === "data-notice" && part.data?.text) setNote(String(part.data.text)); },
  });
  const busy = status === "submitted" || status === "streaming";
  const msgs: (Msg & { records: string[] })[] = ui.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: textOf(m), records: recordsOf(m) }));
  const setMsgs = (m: Msg[]) => setMessages(toUI(m));
  useEffect(() => { if (error) setNote(`I couldn't answer that just now (${error.message || error}).`); }, [error]);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();
  // the dev Note button sits at the very bottom-right; stack above it when it is on the page
  const [lift] = useState(() => !!document.querySelector('script[src*="dev-notes.js"]'));

  useEffect(() => {
    if (!busy) store(KEY, JSON.stringify(msgs.filter((m) => m.content).slice(-30).map(({ role, content }) => ({ role, content }))));
  }, [ui, busy]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: reduce ? "auto" : "smooth" }); }, [ui, busy, open, reduce]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open]);

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setText(""); setNote("");
    await sendMessage({ text: q });
  };

  const bottom = lift ? "bottom-[72px]" : "bottom-[18px]";
  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.section role="dialog" aria-label="Ask the Principal"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn("fixed right-[18px] z-[60] flex w-[min(380px,calc(100vw-36px))] max-h-[min(72vh,580px)] flex-col overflow-hidden rounded-2xl border border-pink-300/25 bg-[#120f15] text-pink-100 shadow-[0_30px_80px_-20px_rgba(0,0,0,.85)]",
              lift ? "bottom-[126px]" : "bottom-[72px]")}>
            <header className="flex items-center gap-3 border-b border-pink-300/15 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-pink-700 text-white"><Cap className="size-[18px]" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-tight">The Principal</div>
                <div className="text-xs text-pink-200/60">Answers from this class's records</div>
              </div>
              {msgs.length > 0 && <button onClick={() => { setMsgs([]); setNote(""); }} className="rounded-md px-2 py-1 text-xs text-pink-200/70 hover:bg-white/5 hover:text-pink-100">Clear</button>}
              <button onClick={() => setOpen(false)} aria-label="Close" className="grid size-8 place-items-center rounded-md text-pink-200/70 hover:bg-white/5 hover:text-pink-100">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </header>

            <div ref={list} className="min-h-[180px] flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[14px] leading-relaxed" aria-live="polite">
              <Bubble role="assistant">{GREETING}</Bubble>
              {msgs.map((m, i) => (m.content || m.role === "user") && (
                <div key={i}>
                  <Bubble role={m.role}>{m.content}</Bubble>
                  {m.role === "assistant" && m.records.length > 0 && (
                    <details className="mt-1 pl-1 text-[11px] text-pink-200/50">
                      <summary className="cursor-pointer select-none hover:text-pink-200/80">Records used ({m.records.length})</summary>
                      <ul className="mt-1 list-disc pl-4">{m.records.map((r) => <li key={r}>{r}</li>)}</ul>
                    </details>
                  )}
                </div>
              ))}
              {status === "submitted" && (
                <div className="flex items-center gap-1.5 pl-1 text-pink-200/60" aria-label="The Principal is thinking">
                  {[0, 1, 2].map((i) => <motion.i key={i} className="size-1.5 rounded-full bg-pink-300/70"
                    animate={reduce ? undefined : { opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />)}
                </div>
              )}
              {!msgs.length && !busy && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {SUGGEST.map((s) => <button key={s} onClick={() => ask(s)}
                    className="rounded-full border border-pink-300/25 px-3 py-1.5 text-left text-xs text-pink-200 hover:border-pink-300/60 hover:bg-pink-500/10">{s}</button>)}
                </div>
              )}
              {note && <p className="text-xs text-pink-200/55">{note}</p>}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex items-end gap-2 border-t border-pink-300/15 p-3">
              <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }}
                placeholder="Ask about pace, learners, tests…" aria-label="Your question"
                className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-pink-300/20 bg-white/[.04] px-3 py-2.5 text-[14px] text-pink-100 placeholder:text-pink-200/40 focus:border-pink-300/60 focus:outline-none" />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Send"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-pink-500 text-white transition hover:bg-pink-400 disabled:opacity-40">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>

      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Close the Principal" : "Ask the Principal"}
        className={cn("fixed right-[18px] z-[60] inline-flex h-[44px] items-center gap-2 rounded-full border border-pink-300/35 bg-gradient-to-br from-pink-500 to-pink-700 pl-3 pr-4 text-[14px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,.7),0_0_0_4px_rgba(230,25,127,.15)] transition hover:brightness-110", bottom)}>
        <Cap />{open ? "Close" : "Principal"}
      </button>
    </>,
    document.body,
  );
}

function Bubble({ role, children }: { role: Msg["role"]; children: React.ReactNode }) {
  const me = role === "user";
  return (
    <div className={cn("flex", me && "justify-end")}>
      <div className={cn("max-w-[86%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5",
        me ? "rounded-br-md bg-pink-500/90 text-white" : "rounded-bl-md border border-pink-300/15 bg-white/[.04] text-pink-100")}>
        {children}
      </div>
    </div>
  );
}
