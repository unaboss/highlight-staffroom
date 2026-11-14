/* Shared loading states for Classroom Fast Track, in the pink-and-black style.
   - Skeleton / SkeletonCard: blocks shaped like the content they stand in for.
   - Thinking: a named agent at work ("The Principal is thinking…"), with optional live steps.
   - Spinner and BusyButton: a button that disables itself and spins while it saves.
   - LoadError: a short message and a Retry button, so nothing hangs forever.
   - PageLoader: the full-page loader, only for a cold first load.
   - useLoad: fetch with loading / error / retry and a timeout.
   Every animation stops under prefers-reduced-motion (Tailwind motion-safe). */
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("rounded-lg bg-pink-300/[.08] motion-safe:animate-pulse", className)} />;
}

/** A card-shaped placeholder: a title bar and a few lines. */
export function SkeletonCard({ lines = 3, className, label = "Loading" }: { lines?: number; className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("glass grid gap-3 p-5", className)}>
      <Skeleton className="h-5 w-2/5" />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-3/5" : "w-full")} />)}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** An agent at work. `steps` are shown as they arrive (oldest first); the last one is live. */
export function Thinking({ who = "The staff", doing = "thinking", steps, className }: { who?: string; doing?: string; steps?: string[]; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-2 text-sm text-pink-100", className)}>
      <span className="inline-flex items-center gap-2.5">
        <span className="relative flex size-2.5" aria-hidden="true">
          <span className="absolute inline-flex size-full rounded-full bg-pink-400 opacity-70 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2.5 rounded-full bg-pink-400" />
        </span>
        <span><b className="font-semibold">{who}</b> is {doing}…</span>
      </span>
      {steps && steps.length > 0 && (
        <ol className="ml-5 grid gap-1 border-l border-pink-300/20 pl-3 text-[13px] text-pink-200/75">
          {steps.map((s, i) => <li key={i} className={cn(i === steps.length - 1 && "text-pink-100 motion-safe:animate-pulse")}>{s}</li>)}
        </ol>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 motion-safe:animate-spin", className)} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A button that disables itself and shows a spinner (and optional busy label) while `busy`. */
export function BusyButton({ busy, busyLabel, children, className, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: ReactNode }) {
  return (
    <button {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={cn("inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60", className)}>
      {busy && <Spinner />}{busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export function LoadError({ message = "That didn't load.", onRetry, className }: { message?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("glass flex flex-wrap items-center justify-between gap-3 p-5", className)}>
      <span className="text-pink-100"><b>Couldn't load this.</b> <span className="text-pink-200/75">{message}</span></span>
      {onRetry && <button onClick={onRetry} className="rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold text-pink-100 hover:border-pink-300/60">Try again</button>}
    </div>
  );
}

/** The cold first load: the mark and a pulse, centred. Never a blank screen. */
export function PageLoader({ label = "Opening the classroom" }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-[60svh] place-items-center">
      <div className="flex flex-col items-center gap-4 text-pink-200/80">
        <img src="/static/ft/mark.svg" alt="" className="size-12 motion-safe:animate-pulse" />
        <span className="text-sm">{label}…</span>
      </div>
    </div>
  );
}

/** Load data with a loading flag, an error and a retry. A request that takes longer than `timeout`
    ms becomes an error, so the page always ends in content or a Retry button. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], timeout = 20000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useRef(0);
  const load = useCallback(() => {
    const id = ++run.current;
    setLoading(true); setError(null);
    const t = new Promise<never>((_, no) => setTimeout(() => no(new Error("It's taking too long. Check the server is running.")), timeout));
    Promise.race([fn(), t]).then((d) => { if (id === run.current) { setData(d as T); setLoading(false); } })
      .catch((e) => { if (id === run.current) { setError(String(e?.message || e)); setLoading(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, retry: load, setData };
}
