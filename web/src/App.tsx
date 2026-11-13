import { useEffect, useState } from "react";
import Login, { type Role } from "@/pages/Login";
import Owner from "@/pages/Owner";
import Facilitator from "@/pages/Facilitator";
import Learners from "@/pages/Learners";
import Student from "@/pages/Student";
import { School } from "@/lib/school";
import { store } from "@/lib/api";

const HOME: Record<Role, string> = { owner: "#/school", facilitator: "#/class", student: "#/play" };
// Same deep link as the plain app: ?role=owner|facilitator|student skips the sign-in.
{
  const r = new URLSearchParams(location.search).get("role") as Role | null;
  if (r && r in HOME) { store("ftn.role", r); if (!location.hash) location.hash = HOME[r]; }
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
  const role = store("ftn.role") as Role | null;

  const atLogin = /\/login\/?$/.test(location.pathname) || page === "login";
  if (atLogin || !page || !role) {
    return <Login onEnter={(r) => { store("ftn.role", r); location.href = "/fast-track/" + HOME[r]; }} />;
  }
  return (
    <>
      <div className="grid-bg" aria-hidden="true"><div className="flat" /><div className="horizon" /><div className="floor" /></div>
      {page === "class" && (
        <div aria-hidden="true" className="pointer-events-none fixed bottom-0 left-1/2 -z-10 w-[110vw] -translate-x-1/2 opacity-40 [filter:drop-shadow(0_0_6px_rgba(255,61,154,.4))] [mask-image:linear-gradient(to_top,#000_35%,transparent_95%)]">
          <School id="bgSchool" />
        </div>
      )}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-pink-300/15 bg-[#0c0b0e] px-4 py-3 md:px-8">
        <a href="/fast-track/" className="flex min-w-0 items-center gap-2.5 font-bold tracking-tight" aria-label="Staffroom Fast Track">
          <img src="/static/ft/mark.svg" alt="" className="size-7 shrink-0" />
          <span className="truncate">Staffroom <span className="text-pink-400">Fast Track</span></span>
        </a>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 text-sm text-pink-200/75 lg:flex">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-pink-300 opacity-70" /><span className="relative inline-flex size-2 rounded-full bg-pink-300" /></span>
            Melsoft · offline mode
          </div>
          <div id="hdr-slot" />
          <button type="button" onClick={signOut} aria-label="Sign out"
            className="flex items-center gap-2 rounded-full border border-pink-300/30 bg-transparent px-2.5 py-1.5 text-sm font-semibold text-pink-100 hover:border-pink-300/60 hover:bg-pink-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300 sm:px-3.5">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1184px] px-5 pb-24 pt-8 md:px-8 md:pt-12">
        {page === "school" ? <Owner /> : page === "class" ? <Facilitator /> : page === "learners" ? <Learners id={Number(hash.split("/")[2]) || undefined} /> : <Student sub={hash.replace(/^#\/?/, "").split("/").slice(1)} />}
      </main>
    </>
  );
}
