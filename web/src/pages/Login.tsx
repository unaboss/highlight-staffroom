/* Demo sign-in: the 3D school draws itself on the horizon of a ruled exercise-book page, lit from
   behind by a soft glow; the meters on both edges fill as the app really loads (course, chapters,
   class board, facilitator plan, fonts, logo, the 3D model), then the card slides in. No email or
   password: pick a role. (The stock synthwave sun, grid road and shimmer button were removed in
   dev notes 18 and 21: they read as generic.) */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import "./login.css";

export type Role = "owner" | "facilitator" | "student";
const ROLES: { id: Role; label: string; icon: React.ReactNode }[] = [
  // the school owner role was taken off the sign-in (dev note 20)
  { id: "facilitator", label: "Facilitator", icon: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg> },
  { id: "student", label: "Student", icon: <svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11v5c3 2 9 2 12 0v-5" /></svg> },
];

// The school scene was taken off the sign-in (dev note 24): only the background lines stay.

/* Real loading work, in order. Each task names the staff line shown while it runs and a weight
   (its share of the bars). A task that fails still counts as done: the app has an offline mode and
   the login must never get stuck. */
type Task = { msg: string; w: number; run: () => Promise<unknown> };
function loadingTasks(schoolDrawn: Promise<void>): Task[] {
  let cid = 1;
  const img = (src: string) => new Promise<void>((ok) => { const i = new Image(); i.onload = i.onerror = () => ok(); i.src = src; });
  return [
    { msg: "Opening the school", w: 1, run: async () => { const cs = await api<{ id: number; title: string }[]>("/api/ft/courses"); cid = (cs.find((c) => /melsoft/i.test(c.title)) || cs[0])?.id ?? 1; } },
    { msg: "Librarian is shelving the chapters", w: 3, run: () => api(`/api/ft/${cid}/chapters`) },
    { msg: "Principal is planning the term", w: 2, run: () => api(`/api/ft/${cid}/facilitator`) },
    { msg: "Examiner is checking every line", w: 2, run: () => api(`/api/ft/${cid}/board`) },
    { msg: "Counsellor is getting ready", w: 1, run: () => Promise.all([document.fonts?.ready, img("/static/ft/mark.svg")]) },
    { msg: "Building the classroom", w: 2, run: () => schoolDrawn },
  ];
}

export default function Login({ onEnter }: { onEnter: (r: Role) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"loading" | "drawing" | "ready">("loading");
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("Opening the school");
  const [, setFlash] = useState(false);
  const drawn = useRef<{ p: Promise<void>; done: () => void }>(null as any);
  if (!drawn.current) drawn.current = { p: Promise.resolve(), done: () => {} };   // no scene to wait for
  const [role, setRole] = useState<Role>("facilitator");

  // layout + perspective ground (same maths as the plain page)
  // layout: where the horizon and the school sit, shared with the CSS through custom properties
  // the animated grid road with light trails (brought back after note 21, on request)
  useEffect(() => {
    const el = root.current!, cv = canvas.current!, cx = cv.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, HZ = 0, VPX = 0, raf = 0, phaseT = 0, intro = reduce ? 1 : 0;
    const layout = () => {
      W = innerWidth; H = innerHeight; const desk = W >= 900;
      HZ = Math.round(H * (desk ? 0.6 : 0.68)); VPX = Math.round(W / 2);   // the form is centred, so the road is too
      const sw = desk ? Math.min(W * 0.42, 760) : Math.min(W * 0.96, 520);
      el.style.setProperty("--hz", HZ + "px"); el.style.setProperty("--vpx", VPX + "px");
      el.style.setProperty("--sw", sw + "px"); el.style.setProperty("--sun", Math.round(sw * 1.12) + "px");
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = W * dpr; cv.height = (H - HZ) * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    addEventListener("resize", layout); layout();
    const K = () => W * 0.9;
    const P = (x: number, z: number) => [VPX + (x * K()) / z, (H - HZ) / z];
    const streaks = Array.from({ length: 7 }, () => ({ x: (Math.random() * 2 - 1) * 0.6, z: 6 + Math.random() * 10,
      v: (0.035 + Math.random() * 0.05) * (Math.random() < 0.3 ? -1 : 1), len: 0.6 + Math.random() * 1.2 }));
    const draw = () => {
      const gh = H - HZ; cx.clearRect(0, 0, W, gh); intro = Math.min(1, intro + 0.012);
      const road = 0.75, a = P(-road, 0.6), b = P(road, 0.6);
      const gr = cx.createLinearGradient(0, 0, 0, gh); gr.addColorStop(0, "rgba(192,13,104,.30)"); gr.addColorStop(1, "rgba(92,8,56,.18)");
      cx.fillStyle = gr; cx.beginPath(); cx.moveTo(VPX, 0); cx.lineTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.closePath(); cx.globalAlpha = intro; cx.fill();
      for (let i = -14; i <= 14; i++) {
        const x = i * 0.25, p = P(x, 0.6), edge = Math.abs(Math.abs(x) - road) < 0.01;
        const g = cx.createLinearGradient(VPX, 0, p[0], p[1]); g.addColorStop(0, "rgba(255,61,154,0)");
        g.addColorStop(0.25, edge ? "rgba(255,170,210,.9)" : "rgba(230,25,127,.35)"); g.addColorStop(1, edge ? "rgba(255,209,230,1)" : "rgba(230,25,127,.55)");
        cx.strokeStyle = g; cx.lineWidth = edge ? 2.2 : 1; cx.shadowColor = edge ? "rgba(255,61,154,.9)" : "transparent"; cx.shadowBlur = edge ? 12 : 0;
        const e = P(x, 0.6 + (1 - intro) * 40); cx.beginPath(); cx.moveTo(VPX, 0); cx.lineTo(e[0], e[1]); cx.stroke();
      }
      cx.shadowBlur = 0;
      if (!reduce) phaseT = (phaseT + 0.012) % 1;
      for (let n = 0; n < 40; n++) {
        const z = 0.6 + (n + 1 - phaseT) * 0.42 * Math.pow(1.11, n); if (z > 60) break;
        const y = gh / z, al = Math.min(1, 0.9 / z) * intro;
        cx.strokeStyle = `rgba(230,25,127,${0.55 * al})`; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke();
      }
      for (const s of streaks) {
        if (!reduce) s.z -= s.v * s.z * 0.25;
        if (s.z < 0.55 || s.z > 22) Object.assign(s, { x: (Math.random() * 2 - 1) * 0.6, z: s.v > 0 ? 12 + Math.random() * 8 : 0.8, len: 0.6 + Math.random() * 1.2 });
        const h = P(s.x, s.z), tl = P(s.x, s.z + s.len * (s.v > 0 ? 1 : -1) * s.z * 0.3);
        const g = cx.createLinearGradient(tl[0], tl[1], h[0], h[1]); g.addColorStop(0, "rgba(255,170,210,0)"); g.addColorStop(1, "rgba(255,240,247,.95)");
        cx.globalAlpha = intro; cx.strokeStyle = g; cx.lineWidth = Math.max(1, 2.4 / s.z); cx.beginPath(); cx.moveTo(tl[0], tl[1]); cx.lineTo(h[0], h[1]); cx.stroke();
        cx.fillStyle = "#fff0f7"; cx.shadowColor = "#ff3d9a"; cx.shadowBlur = 14; cx.beginPath(); cx.arc(h[0], h[1], Math.max(1.2, 4 / s.z), 0, 7); cx.fill(); cx.shadowBlur = 0;
      }
      cx.globalAlpha = 1; raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", layout); };
  }, []);

  /* Loading sequence: run the real tasks in order. The bars show the real fraction done, held back
     by a minimum pace (MIN ms for a full fill) so the animation still reads on a fast local server.
     When everything is in and the bars are full, the windows flash and the card slides in. */
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const MIN = reduce ? 300 : 1400, t0 = performance.now();
    const tasks = loadingTasks(drawn.current.p), total = tasks.reduce((a, t) => a + t.w, 0);
    let real = 0, current = 0, cancelled = false, finished = false, shown = 0, last = t0;
    const timers: number[] = [];
    // only ever moves loading -> drawing: in a background tab this frame can fire long after the
    // page is ready, and it must not hide the card again
    requestAnimationFrame(() => requestAnimationFrame(() => setPhase((p) => (p === "loading" ? "drawing" : p))));
    (async () => {
      for (const [i, t] of tasks.entries()) {
        if (cancelled) return;
        current = i;
        // cap each task so one slow request cannot hold the door shut
        await Promise.race([t.run().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
        real += t.w / total;
      }
      real = 1;
    })();
    const open = () => {
      if (finished) return; finished = true;
      setPct(100); setFlash(true); setPhase("ready");    // the card slides in while the windows flash
    };
    // a timer, not animation frames: frames stop in a background tab, timers only slow down
    const tick = () => {
      if (finished) return;
      const now = performance.now(), pace = Math.min(1, (now - t0) / MIN);
      // ease toward the real figure: never more than a full meter in 600ms, so a big task finishing
      // sweeps the meter up instead of jumping
      shown = Math.min(Math.min(real, pace), shown + Math.min(60, now - last) / (reduce ? 1 : 600)); last = now;
      const p = shown;
      setPct(Math.floor(p * 100));
      // name the job that is actually running; once it is done, the next one
      setMsg(tasks[Math.min(tasks.length - 1, real >= 1 ? tasks.length - 1 : current)].msg);
      if (p >= 1) open();
    };
    const poll = window.setInterval(tick, 50);
    tick();
    // Safety net: if loading hangs, still open the door.
    timers.push(window.setTimeout(open, 8000));
    return () => { cancelled = true; timers.forEach(clearTimeout); clearInterval(poll); };
  }, []);

  // one continuous meter per edge: a thin track, a glowing fill with a bright head, and the percentage
  const bar = (side: "l" | "r") => (
    <div className={`meter ${side} ${phase === "ready" ? "done" : ""}`} aria-hidden="true">
      <div className="track"><div className="fill" style={{ height: pct + "%" }} /></div>
      <i className="pill" />
      <span className="pct" style={{ bottom: pct + "%" }}>{String(pct).padStart(2, "0")}<small>%</small></span>
    </div>
  );
  const label = ROLES.find((r) => r.id === role)!.label.toLowerCase();

  return (
    <div ref={root} className={`lg fixed inset-0 ${phase === "loading" ? "loading" : ""} ${phase === "ready" ? "ready" : ""}`}>
      <div className="sky">
      </div>
      <div className="floor" aria-hidden="true" />
      <canvas ref={canvas} aria-hidden="true" />
      <div className="hz" />
      {bar("l")}{bar("r")}
      <div className="status" role="status"><b /><span>{msg}</span></div>
      <main className="card" aria-label="Sign in">
        <div className="brand">
          <div><small>CFT</small><strong>Classroom Fast Track</strong></div>
        </div>
        <p className="sub">Choose who you are to see where the school stands before the exam.</p>
        <div className="roles" role="group" aria-label="I am a">
          {ROLES.map((r) => <button key={r.id} type="button" aria-pressed={role === r.id} onClick={() => setRole(r.id)}>{r.icon}{r.label}</button>)}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onEnter(role); }}>
          <button type="submit" className="cta">Continue as {label}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
        </form>
        <div className="or">or</div>
        <button className="alt" type="button" onClick={() => (location.href = "/lms")}>Continue with your LMS</button>
        <p className="foot">Competition demo. No sign-up, just pick a role.</p>
      </main>
    </div>
  );
}
