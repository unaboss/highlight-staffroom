import { useEffect, useState } from "react";
import Login from "@/pages/Login";
import Facilitator from "@/pages/Facilitator";
import LessonPrep from "@/pages/LessonPrep";
import Progress from "@/pages/Progress";
import ReviewClasses from "@/pages/ReviewClasses";
import AgentRun from "@/components/AgentRun";
import Learners from "@/pages/Learners";
import Settings from "@/pages/Settings";
import Student from "@/pages/Student";
import { School } from "@/lib/school";
import { api, store } from "@/lib/api";

// Two roles: staff (facilitator) and learners. The school owner view was retired (dev note 20).
type AppRole = "facilitator" | "student";
const HOME: Record<AppRole, string> = { facilitator: "#/class", student: "#/play" };
const asRole = (r: string | null): AppRole | null => (r && r in HOME ? (r as AppRole) : null);
// Same deep link as the plain app: ?role=facilitator|student skips the sign-in; anything else signs in.
{
  const r = asRole(new URLSearchParams(location.search).get("role"));
  if (r) { store("ftn.role", r); if (!location.hash) location.hash = HOME[r]; }
}

/** Sign out: forget the role and learner, back to the one login page. */
function signOut() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("ftn.")) localStorage.removeItem(k);
    sessionStorage.clear();
  } catch { /* storage unavailable */ }
  location.href = "/fast-track/login";
}

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return h;
}

export default function App() {
  const hash = useHash();
  const page = (hash.replace(/^#\/?/, "") || "").split("/")[0];
  const sub = (hash.replace(/^#\/?/, "") || "").split("/").slice(1);     // #/class/prep[/lessonId]: lesson prep (dev note 30)
  const prep = page === "class" && sub[0] === "prep";
  const progress = page === "class" && sub[0] === "progress";       // #/class/progress: Show progress (dev note 39)
  const classes = page === "class" && sub[0] === "classes";         // #/class/classes[/sessionId]: Review classes (dev note 39)
  const agents = page === "class" && sub[0] === "agents";           // #/class/agents[/jobId]: watch or replay a live agent run
  const role = asRole(store("ftn.role"));
  const [status, setStatus] = useState("");
  useEffect(() => {
    api<{ course: string | null; llm: { online: boolean } }>("/api/health")
      .then((h) => setStatus(`${h.course || "Classroom Fast Track"} · ${h.llm.online ? "model online" : "offline mode"}`)).catch(() => {});
  }, []);

  const atLogin = /\/login\/?$/.test(location.pathname) || page === "login";
  const atSettings = /\/settings\/?$/.test(location.pathname);
  if (atSettings && role === "student") { location.replace("/fast-track/" + HOME.student); return null; }
  if (atLogin || ((!page && !atSettings) || !role)) {
    return <Login onEnter={(r) => { const a = asRole(r) ?? "facilitator"; store("ftn.role", a); location.href = "/fast-track/" + HOME[a]; }} />;
  }
  if (!atSettings && !["class", "learners", "play"].includes(page)) { location.replace("/fast-track/" + HOME[role]); return null; }   // old #/school links
  return (
    <>
      <div className="grid-bg" aria-hidden="true"><div className="flat" /><div className="horizon" /><div className="floor" /></div>
      {page === "class" && !sub[0] && (
        <div aria-hidden="true" className="pointer-events-none fixed bottom-0 left-1/2 -z-10 w-[110vw] -translate-x-1/2 opacity-40 [filter:drop-shadow(0_0_6px_rgba(255,61,154,.4))] [mask-image:linear-gradient(to_top,#000_35%,transparent_95%)]">
          <School id="bgSchool" />
        </div>
      )}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-pink-300/15 bg-[#0c0b0e] px-4 py-3 md:px-8">
        <a href="/fast-track/" className="flex min-w-0 items-center gap-3 tracking-tight" aria-label="Classroom Fast Track (CFT)">
          <img src="/static/ft/mark.svg" alt="" className="size-9 shrink-0 md:size-10" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[18px] font-extrabold leading-none sm:text-[21px] md:text-[24px]">C<span className="text-pink-400">FT</span></span>
            <span className="mt-1 text-[11px] font-semibold uppercase leading-none tracking-[0.16em] text-zinc-400">{role === "student" ? "Learner" : "Staff"}</span>
          </span>
        </a>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 text-sm text-pink-200/75 lg:flex">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-pink-300 opacity-70" /><span className="relative inline-flex size-2 rounded-full bg-pink-300" /></span>
            {status}
          </div>
          <div id="hdr-slot" />
          {role !== "student" && (
            <a href="/fast-track/settings" aria-label="Settings" title="Settings"
              className={"grid size-9 place-items-center rounded-full border text-pink-100 hover:border-pink-300/60 hover:bg-pink-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300 " + (atSettings ? "border-pink-300/60 bg-pink-500/15" : "border-pink-300/30")}>
              <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </a>
          )}
          <button type="button" onClick={signOut} aria-label="Sign out"
            className="flex items-center gap-2 rounded-full border border-pink-300/30 bg-transparent px-2.5 py-1.5 text-sm font-semibold text-pink-100 hover:border-pink-300/60 hover:bg-pink-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300 sm:px-3.5">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
      <main className={"mx-auto w-full pb-24 pt-8 md:pt-12 " + (page === "class" && !sub[0] ? "max-w-none px-4 md:px-6" : "max-w-[1184px] px-5 md:px-8")}>
        {atSettings ? <Settings /> : agents ? <AgentRun key={sub[1] || "new"} jobId={Number(sub[1]) || undefined} lessonId={Number(new URLSearchParams(location.search).get("lesson")) || undefined} /> : prep ? <LessonPrep lessonId={Number(sub[1]) || undefined} /> : progress ? <Progress /> : classes ? <ReviewClasses sessionId={Number(sub[1]) || undefined} /> : page === "class" ? <Facilitator /> : page === "learners" ? <Learners id={Number(hash.split("/")[2]) || undefined} /> : <Student sub={hash.replace(/^#\/?/, "").split("/").slice(1)} />}
      </main>
    </>
  );
}
