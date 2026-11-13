/* Staffroom Fast Track: facilitator view (#/class) and the student game (#/play).
   Real data: /api/state, /api/ft/... over the Melsoft course. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUIZ = 11;
const SKILL = { Recall: "recall", Explain: "explain", "Spot the mistake": "spot", Apply: "apply", Analyse: "analyse", "Final quiz": "quiz" };
// One hue, climbing in lightness: the tower brightens as it grows.
const HUE = { recall: "#e6197f", explain: "#ff3d9a", spot: "#ff3d9a", apply: "#ff9ccb", analyse: "#ffd1e6", quiz: "#fff0f7" };
const MOD_HUE = ["#ffd1e6", "#fff0f7", "#ff9ccb", "#ff3d9a", "#e6197f", "#c00d68", "#8f0a52", "#8f0a52"];
const SURE = [["guess", "Guessing"], ["fair", "Fairly sure"], ["certain", "Certain"]];
const SURE_X = { guess: 0.5, fair: 1, certain: 1.5 };

const I = {
  fire: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5-1.5 5-1.5 7.5 0 1.4 1 2.5 2.3 2.5 1.6 0 2.4-1.5 2-3.4 2.4 1.7 4.2 4.4 4.2 7.4A7 7 0 0 1 12 23a7 7 0 0 1-7-7c0-4.6 3.6-6.3 4.6-10 .3-1.1.4-2.6 2.4-4z"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  back: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/></svg>`,
  flag: `<svg viewBox="0 0 18 26" fill="currentColor"><rect x="1" y="0" width="2" height="26" rx="1"/><path d="M3 1h13l-3 5 3 5H3z"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>`,
};

const S = { cid: null, courses: [], data: null, learner: null, mod: "All", filter: "", chapter: null, run: null, justCleared: null };

function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch (e) { /* storage unavailable */ }
  return null;
}
async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) { init.method = "POST"; init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(opts.json); }
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `Request failed (${r.status})`);
  return body;
}
const split = (t) => { const m = /^([A-Z]{2,4}-\d+)\s+([A-Z]{1,3}\d+):\s*(.*)$/.exec(t || ""); return m ? { mod: m[1], kt: m[2], name: m[3] } : { mod: "Other", kt: "", name: t || "" }; };
const modHue = (mod) => MOD_HUE[(parseInt(String(mod).replace(/\D/g, ""), 10) || 1) % MOD_HUE.length];
const cls = (level) => SKILL[S.data?.skills?.[level]] || (level === QUIZ ? "quiz" : "recall");
const fmtDate = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "–");
const initials = (n) => String(n || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const starRow = (n, max = 3) => `<span class="stars">${Array.from({ length: max }, (_, i) => I.star.replace("<svg", `<svg class="${i < n ? "on" : ""}"`)).join("")}</span>`;

// Count up a number into an element (number ticker).
function tick(el, to, ms = 1400) {
  if (!el) return;
  const from = Number(el.dataset.v || 0), t0 = performance.now();
  el.dataset.v = to;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    el.textContent = Math.round(from + (to - from) * e).toLocaleString("en-ZA");
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function tickAll(root = document) { $$("[data-tick]", root).forEach((el) => tick(el, Number(el.dataset.tick))); }
function spotlight(root = document) {
  $$(".spot", root).forEach((el) => el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`); el.style.setProperty("--y", `${e.clientY - r.top}px`);
  }));
}

// ------------------------------------------------------------------ chrome

function chrome(view) {
  const sw = $(".switch");
  sw.dataset.on = view;
  $$(".switch a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
  const st = S.data?.stats, run = S.run;
  const streak = run ? run.streak : st?.streak || 0, xp = (st?.xp || 0) + (run ? run.xp : 0);
  $("#status").innerHTML = view === "play" && S.learner
    ? `<span class="hud ${streak >= 3 ? "hot" : ""}" id="hStreak" title="Answer streak">${I.fire}<span class="num">${streak}</span></span>
       <span class="hud" id="hXp" title="XP">${I.bolt}<span class="num">${xp.toLocaleString("en-ZA")}</span></span>`
    : `<span class="live"></span><span class="course">${esc(S.data?.course || "")} ·</span> <span>offline mode</span>`;
}
function pop(id) { const el = $(id); if (el) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); } }

const ROLE_HOME = { owner: "#/school", facilitator: "#/class", student: "#/play" };
async function boot() {
  // Demo sign-in: /fast-track/login sends ?role=...; without a role, go and pick one.
  const qs = new URLSearchParams(location.search);
  const role = qs.get("role");
  if (role && ROLE_HOME[role]) {
    store("ft.role", role);
    history.replaceState(null, "", location.pathname + (qs.has("still") ? "?still=1" : "") + ROLE_HOME[role]);
  } else if (!store("ft.role") && !location.hash && !qs.has("still")) {
    location.replace("/fast-track-classic/login");
    return;
  }
  S.courses = await api("/api/ft/courses");
  if (!S.courses.length) { $("#view").innerHTML = `<div class="glass pad">No course notes yet. Create a course and upload notes in <a href="/staffroom">Staffroom</a>.</div>`; return; }
  const want = Number(new URLSearchParams(location.search).get("course") || store("ft.cid"));
  S.cid = (S.courses.find((c) => c.id === want) || S.courses.find((c) => /melsoft/i.test(c.title)) || S.courses[0]).id;
  S.learner = Number(new URLSearchParams(location.search).get("learner") || store(`ft.learner.${S.cid}`)) || null;
  await loadChapters();
  schoolBackground();
  window.addEventListener("hashchange", route);
  route();
}

// ------------------------------------------------------------------ the school behind everything

const ROOM = { Principal: "principal", Librarian: "librarian", "Subject Teacher": "teacher", Teacher: "teacher", Examiner: "examiner",
  "Class Observer": "observer", Observer: "observer", Counsellor: "counsellor" };
async function schoolBackground() {
  const bg = $("#schoolBg");
  bg.innerHTML = window.schoolSVG("bgSchool");
  drawIn($("#bgSchool"));
  refreshClassWindows();
  // Agents light their room while they work (live events from the Staffroom board).
  if (new URLSearchParams(location.search).has("still")) return;   // screenshots: no live stream
  try {
    const es = new EventSource("/api/events/stream");
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data || "{}"), room = ROOM[ev.agent];
      if (room) { lightRoom($("#bgSchool"), room); lightRoom($("#ownSchool"), room); }
    };
  } catch (e) { /* no live events: the drawing stays still */ }
}
async function refreshClassWindows() {
  try {
    const b = await api(`/api/ft/${S.cid}/board`);
    const levels = b.learners.reduce((s, l) => s + l.levels, 0);
    lightClasses($("#bgSchool"), Math.min(8, Math.ceil(levels / 4)));
  } catch (e) { /* leave dark */ }
}
async function loadChapters() {
  S.data = await api(`/api/ft/${S.cid}/chapters${S.learner ? `?learner_id=${S.learner}` : ""}`);
  if (S.learner && S.data.learner_id !== S.learner) { S.learner = null; store(`ft.learner.${S.cid}`, null); }
}
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function route() {
  stopTimer();
  const parts = (location.hash.replace(/^#\/?/, "") || "class").split("/");
  window.scrollTo({ top: 0 });
  document.body.classList.toggle("owner", parts[0] === "school");
  if (parts[0] === "school") { S.run = null; return pageSchool(); }
  if (parts[0] === "play") {
    S.run = null;
    if (!S.learner) {
      // One login only: play as the learner's own profile, or the first learner, straight away.
      const own = (S.data.learners || []).find((l) => !/\(sample\)/.test(l.name)) || (S.data.learners || [])[0];
      if (!own) return pageWho();          // a course with no learners at all still needs a name
      setMe(own.id);
      return;
    }
    if (parts[1] === "chapter" && parts[2]) return pageChapter(Number(parts[2]));
    return pagePick();
  }
  S.run = null;
  return pageClass();
}

// ------------------------------------------------------------------ facilitator

function clock(value, max, color, big, small, label, sub) {
  const r = 62, c = 2 * Math.PI * r, k = max ? Math.max(0, Math.min(1, value / max)) : 0;
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * 2 * Math.PI, r1 = i % 5 ? 70 : 67; return `<line x1="${75 + r1 * Math.cos(a)}" y1="${75 + r1 * Math.sin(a)}" x2="${75 + 73 * Math.cos(a)}" y2="${75 + 73 * Math.sin(a)}"/>`; }).join("");
  return `<div class="clock"><div class="face"><svg viewBox="0 0 150 150"><g class="ticks">${ticks}</g><circle class="track" cx="75" cy="75" r="${r}"/>
      <circle class="arc" cx="75" cy="75" r="${r}" stroke="${color}" style="color:${color}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - k)}"/></svg>
      <div><b class="num" data-tick="${big}">0</b><small>${esc(small)}</small></div></div>
    <div class="lbl">${esc(label)}<span>${esc(sub)}</span></div></div>`;
}

const AGENTS = [["Librarian", "book", "#ff3d9a"], ["Subject Teacher", "pen", "#ff9ccb"], ["Examiner", "shield", "#ffd1e6"]];

async function pageClass() {
  chrome("class");
  $("#view").innerHTML = `<div class="empty">Opening the class…</div>`;
  const [st, board] = await Promise.all([api(`/api/state/${S.cid}`), api(`/api/ft/${S.cid}/board`)]);
  const p = st.pacing || {};
  const next = st.lessons.find((l) => l.status === "Planned");
  const lesson = next ? await api(`/api/lessons/${next.id}`) : null;
  const termDays = Math.max(1, Math.round((new Date(st.course.exam_date) - new Date(st.course.term_start)) / 864e5));
  const risky = new Set(p.at_risk_ids || []);
  const short = p.shortfall || 0;

  // runway tiles + exam flag after the last slot
  const tiles = [];
  st.lessons.forEach((l, i) => {
    if (i === p.slots_left + p.taught && short) tiles.push(`<div class="flag" title="Exam ${fmtDate(p.exam_date)}">${I.flag}</div>`);
    const mod = split(l.topic || l.title).mod;
    const state = l.status !== "Planned" ? "done" : risky.has(l.id) ? "risk" : next && l.id === next.id ? "next" : "";
    tiles.push(`<div class="tile ${state}" style="--c:${modHue(mod)};--i:${i}" title="${esc(`${l.seq}. ${l.title} · ${l.planned_date ? fmtDate(l.planned_date) : "after the exam"}`)}"></div>`);
  });
  if (!short) tiles.push(`<div class="flag" title="Exam ${fmtDate(p.exam_date)}">${I.flag}</div>`);
  const mods = [...new Set(st.topics.map((t) => split(t.title).mod))];

  $("#view").innerHTML = `
    <section class="hero">
      <div class="rise">
        <h1>${p.days_to_exam ?? "–"} days until the <em>${esc(st.course.title)}</em> exam.</h1>
        <p class="lede">${p.total} lessons from ${mods.length} modules on the timetable. ${short ? `${short} won't fit before ${fmtDate(p.exam_date)} unless you speed up.` : "Everything fits before the exam."}</p>
        <div class="row wrap">
          ${next ? `<button class="btn go" data-act="prepare" data-id="${next.id}">${lesson?.plan ? "Re-check next lesson" : "Prepare next lesson"} ${I.arrow}</button>` : ""}
          <a class="btn" href="#/play">Open the student game</a>
        </div>
      </div>
      <div class="glass lit clocks rise" style="--i:1">
        ${clock(p.days_to_exam, termDays, "#e6197f", p.days_to_exam, "days left", "Time to the exam", `exam ${fmtDate(p.exam_date)}`)}
        ${clock(p.slots_left, p.lessons_left, short ? "#8f0a52" : "#ff9ccb", p.slots_left, `of ${p.lessons_left} needed`, "Teaching slots", short ? `${short} short` : "enough")}
        <div class="verdict ${short ? "" : "ok"}">${short ? I.warn : I.check}<div>${short
          ? `<b>${short} lesson${short > 1 ? "s" : ""} after the exam:</b> ${p.at_risk.map((t) => esc(split(t).mod + " " + split(t).kt)).join(", ")}. Forecast finish ${fmtDate(p.eta)}.`
          : `On track. Forecast finish ${fmtDate(p.eta)}.`}</div></div>
      </div>
    </section>

    <section class="sec rise" style="--i:2">
      <div class="sec-head"><div><h2>Exam runway</h2><p>One tile per lesson, in teaching order. The flag is the exam; striped tiles land after it.</p></div>
        <span class="chip">${p.taught} taught · ${p.lessons_left} to go</span></div>
      <div class="glass runway"><div class="tiles">${tiles.join("")}</div>
        <div class="legend">${mods.map((m) => `<span style="--c:${modHue(m)}"><i></i>${esc(m)}</span>`).join("")}</div>
        <div class="runway-foot"><span>Today ${fmtDate(p.today)}${next ? ` · next: ${esc(split(next.title).mod)} ${esc(split(next.title).kt)}` : ""}</span><span>${st.course.slot_minutes}-minute lessons, ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].filter((_, i) => (st.course.slot_days || []).includes(i)).join(" · ")}</span></div>
      </div>
    </section>

    <section class="sec split">
      <div class="rise" style="--i:3"><div class="sec-head"><div><h2>Covered so far</h2><p>The route through the modules. Station glow is how much of each module the class has practised in Fast Track.</p></div></div>
        <div class="glass map">${routeMap(st, board)}</div></div>
      <div class="rise" style="--i:4"><div class="sec-head"><div><h2>Next lesson</h2><p>${next ? `${fmtDate(next.planned_date)} · ${esc(split(next.title).mod)} ${esc(split(next.title).kt)}` : "Nothing planned"}</p></div></div>
        ${planCard(lesson)}</div>
    </section>

    <section class="sec rise" style="--i:5">
      <div class="sec-head"><div><h2>The race</h2><p>Levels cleared across all chapters. Every level is five questions cited to the notes.</p></div>
        <span class="chip">${board.learners.length} learners</span></div>
      <div class="glass lanes">${lanes(board)}</div>
    </section>

    <section class="sec rise" style="--i:6">
      <div class="sec-head"><div><h2>Learners to check</h2><p>Picked from their answers: accuracy, confident mistakes and stalled climbs.</p></div></div>
      ${checks(board)}
    </section>`;
  requestAnimationFrame(() => {
    $$(".clock .arc").forEach((a) => a.setAttribute("stroke-dashoffset", a.dataset.off));
    tickAll($("#view"));
    setTimeout(() => $$(".lane .track").forEach((t) => { $(".run", t).style.width = t.dataset.w; $(".runner", t).style.left = t.dataset.w; }), 60);
    beam();
  });
  spotlight();
}

function routeMap(st, board) {
  const mods = [...new Set(st.topics.map((t) => split(t.title).mod))];
  const W = 560, rowH = 120, perRow = 3;
  const pts = mods.map((m, i) => {
    const row = Math.floor(i / perRow), col = i % perRow, x = row % 2 ? W - 90 - col * 190 : 90 + col * 190;
    return { m, x, y: 70 + row * rowH };
  });
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    d += a.y === b.y ? ` L ${b.x} ${b.y}` : ` C ${a.x + (a.x > W / 2 ? 80 : -80)} ${a.y}, ${b.x + (b.x > W / 2 ? 80 : -80)} ${b.y}, ${b.x} ${b.y}`;
  }
  const taughtTopics = new Set(st.lessons.filter((l) => l.status !== "Planned").map((l) => l.topic_id));
  const nextMod = split((st.lessons.find((l) => l.status === "Planned") || {}).title).mod;
  const H = 70 + Math.ceil(pts.length / perRow - 1) * rowH + 70;
  const stations = pts.map((pt) => {
    const topics = st.topics.filter((t) => split(t.title).mod === pt.m);
    const taught = topics.filter((t) => taughtTopics.has(t.id)).length;
    const practised = topics.filter((t) => board.learners.some((l) => (l.chapters[t.id] || {}).top > 0)).length;
    const share = topics.length ? practised / topics.length : 0, hue = modHue(pt.m), here = pt.m === nextMod;
    const r = 22, c = 2 * Math.PI * r;
    return `<g class="stn">${here ? `<circle cx="${pt.x}" cy="${pt.y}" r="32" fill="${hue}" opacity=".18"><animate attributeName="r" values="26;36;26" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".25;.05;.25" dur="2.4s" repeatCount="indefinite"/></circle>` : ""}
      <circle class="ring" cx="${pt.x}" cy="${pt.y}" r="${r}" stroke="rgba(255,255,255,.12)"/>
      <circle cx="${pt.x}" cy="${pt.y}" r="${r}" fill="none" stroke="${hue}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c * Math.max(share, 0.02)} ${c}" transform="rotate(-90 ${pt.x} ${pt.y})" style="filter:drop-shadow(0 0 6px ${hue})"/>
      <circle cx="${pt.x}" cy="${pt.y}" r="${taught === topics.length && taught ? 12 : 6}" fill="${hue}"/>
      <text x="${pt.x}" y="${pt.y + 44}" text-anchor="middle">${esc(pt.m)}${here ? " · next" : ""}</text>
      <text class="k" x="${pt.x}" y="${pt.y + 60}" text-anchor="middle">${taught}/${topics.length} taught · ${practised} practised</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Route through ${mods.length} modules">
    <defs><linearGradient id="walk" x1="0" x2="1"><stop offset="0" stop-color="#e6197f"/><stop offset="1" stop-color="#ff3d9a"/></linearGradient></defs>
    <path class="road" d="${d}"/><path class="walked" d="${d}" opacity=".55"/>${stations}</svg>`;
}

function planCard(l) {
  if (!l) return `<div class="glass plan"><div class="empty">Every lesson is taught.</div></div>`;
  if (!l.plan) {
    return `<div class="glass plan"><div class="beam" id="beam">${AGENTS.map(([n, ic, c]) => `<div class="agent" style="--c:${c}"><div class="av">${I[ic]}</div>${esc(n)}</div>`).join("")}</div>
      <p class="sub" style="margin:0">Not prepared yet. The Librarian finds the passages, the Subject Teacher drafts and the Examiner checks every line against the notes.</p>
      <div><button class="btn go" data-act="prepare" data-id="${l.id}">Prepare it now ${I.arrow}</button></div></div>`;
  }
  const items = new Map(((l.review || {}).items || []).map((it) => [it.text, it]));
  const cites = (text) => esc(text).replace(/\[P(\d+)\]/g, (_, n) => `<button class="cite" data-act="pas" data-lesson="${l.id}" data-n="${n}">P${n}</button>`);
  const lines = [...(l.plan.objectives || []), ...(l.plan.explanation || []).slice(0, 3)];
  const ok = (l.verdict || "").toLowerCase().startsWith("pass");
  return `<div class="glass plan spot">
    <div class="beam" id="beam">${AGENTS.map(([n, ic, c]) => `<div class="agent" style="--c:${c}"><div class="av">${I[ic]}</div>${esc(n)}</div>`).join("")}</div>
    <div class="row between wrap"><h3 class="h2">${esc(split(l.title).name)}</h3><span class="chip ${ok ? "ok" : "warn"}">${ok ? "Examiner passed" : esc(l.verdict || "Checking")}${l.examiner_rounds ? ` · ${l.examiner_rounds} send-back${l.examiner_rounds > 1 ? "s" : ""}` : ""}</span></div>
    <ul class="objs">${lines.map((t) => {
      const it = items.get(t), good = !it || (it.verdict || "").startsWith("Supported");
      const txt = t.length > 170 ? t.slice(0, 167).replace(/\s+\S*$/, "") + "… " + (t.match(/\[P\d+\]\s*$/) || [""])[0] : t;
      return `<li><span class="tick ${good ? "" : "no"}" title="${esc(it ? it.reason : "Checked")}">${good ? I.check : I.x}</span><span>${cites(txt)}</span></li>`;
    }).join("")}</ul>
    <div class="row between wrap small mute"><span>${(l.passages || []).length} passages from the notes · every line ticked against its source</span><a href="/staffroom#plan">Open in Staffroom</a></div>
  </div>`;
}

// animated beam between the three agents
function beam() {
  const box = $("#beam");
  if (!box) return;
  const av = $$(".av", box), r0 = box.getBoundingClientRect();
  const c = av.map((a) => { const r = a.getBoundingClientRect(); return [r.left - r0.left + r.width / 2, r.top - r0.top + r.height / 2, r.width / 2]; });
  const seg = (a, b, id, delay) => `<path d="M ${a[0] + a[2]} ${a[1]} L ${b[0] - b[2]} ${b[1]}" stroke="rgba(255,255,255,.12)" stroke-width="2" fill="none"/>
    <path d="M ${a[0] + a[2]} ${a[1]} L ${b[0] - b[2]} ${b[1]}" stroke="url(#${id})" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${a[0]}" x2="${b[0]}" y1="0" y2="0">
      <stop offset="0" stop-color="#e6197f" stop-opacity="0"><animate attributeName="offset" values="-.4;1" dur="2.2s" begin="${delay}s" repeatCount="indefinite"/></stop>
      <stop offset=".1" stop-color="#ff3d9a"><animate attributeName="offset" values="-.3;1.1" dur="2.2s" begin="${delay}s" repeatCount="indefinite"/></stop>
      <stop offset=".2" stop-color="#ff3d9a" stop-opacity="0"><animate attributeName="offset" values="-.2;1.2" dur="2.2s" begin="${delay}s" repeatCount="indefinite"/></stop>
    </linearGradient>`;
  $("svg.wire", box)?.remove();
  box.insertAdjacentHTML("afterbegin", `<svg class="wire" aria-hidden="true">${seg(c[0], c[1], "bm1", 0)}${seg(c[1], c[2], "bm2", 1.1)}</svg>`);
}

function lanes(board) {
  const ls = [...board.learners].sort((a, b) => b.levels - a.levels || b.xp - a.xp);
  if (!ls.length) return `<div class="empty">No learners yet. Share the student game and they appear here as they climb.</div>`;
  const top = Math.max(10, ...ls.map((l) => l.levels));
  const pairs = [["#e6197f", "#8f0a52"], ["#c00d68", "#3f3f46"], ["#8f0a52", "#27272a"], ["#e6197f", "#8f0a52"], ["#c00d68", "#8f0a52"], ["#8f0a52", "#3f3f46"]];
  return ls.map((l, i) => `<div class="lane">
      <div class="who"><span class="ava" style="--c1:${pairs[i % 6][0]};--c2:${pairs[i % 6][1]}">${esc(initials(l.name))}</span><b>${esc(l.name.replace(" (sample)", ""))}</b>${l.sample ? `<span class="tag">sample</span>` : ""}</div>
      <div class="track" data-w="${(100 * l.levels) / top}%"><div class="run"></div><div class="runner" title="${l.levels} levels"></div></div>
      <div class="xp"><span class="num" data-tick="${l.levels}">0</span> lv<small><span data-tick="${l.xp}">0</span> XP</small></div>
    </div>`).join("");
}

function checks(board) {
  const out = [];
  for (const l of board.learners) {
    const acc = l.answered ? l.correct / l.answered : null;
    let why = null, ev = null, sev = 0;
    if (l.sure_wrong >= 3) { why = `Confidently wrong ${l.sure_wrong} times`; ev = `Said “Certain” and missed it. ${l.sure_right} certain answers were right.`; sev = Math.min(1, l.sure_wrong / 10); }
    if (acc !== null && acc < 0.6 && l.answered >= 5) { why = `Getting ${Math.round(100 * (1 - acc))}% wrong`; ev = `${l.correct} of ${l.answered} answers right${l.levels ? `, ${l.levels} levels cleared` : ", no level cleared yet"}.`; sev = 1 - acc; }
    else if (l.answered >= 5 && l.levels === 0) { why = "Stuck on the first rung"; ev = `${l.answered} answers, no level cleared.`; sev = .7; }
    if (why) out.push({ l, why, ev, sev });
  }
  out.sort((a, b) => b.sev - a.sev);
  if (!out.length) return `<div class="glass pad sub">Nobody needs a check right now.</div>`;
  return `<div class="checks">${out.slice(0, 6).map((c, i) => `<div class="glass check spot rise" style="--i:${i}">
      <div class="row"><span class="ava" style="--c1:#8f0a52;--c2:#27272a">${esc(initials(c.l.name))}</span><div><b>${esc(c.l.name.replace(" (sample)", ""))}</b>${c.l.sample ? ` <span class="tag">sample</span>` : ""}</div></div>
      <div class="why">${esc(c.why)}</div><div class="bar-mini"><i style="width:${Math.round(100 * c.sev)}%"></i></div><div class="ev">${esc(c.ev)}</div>
    </div>`).join("")}</div>`;
}

async function prepare(id, btn) {
  btn.disabled = true;
  btn.innerHTML = "The staff are working…";
  const { job_id } = await api(`/api/lessons/${id}/prepare`, { method: "POST" });
  for (let i = 0; i < 60; i++) {
    const j = await api(`/api/jobs/${job_id}`);
    if (j.status !== "running") break;
    await sleep(700);
  }
  pageClass();
}

async function lessonPassage(lid, n) {
  const l = await api(`/api/lessons/${lid}`);
  const p = (l.passages || []).find((x) => x.n === n);
  if (p) sheet(`<div class="passage" style="max-height:none"><div class="where">P${p.n} · ${esc(p.where || p.section || "")}</div>${esc(p.text)}</div>`);
}
function sheet(html) {
  const s = $("#sheet");
  s.innerHTML = `<div class="glass box">${html}<div class="nextrow"><button class="btn" data-act="close">Close</button></div></div>`;
  s.hidden = false;
  $("mark", s)?.scrollIntoView({ block: "center" });
}

// ------------------------------------------------------------------ owner: the whole school

const STICON = {
  ok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  risk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/></svg>`,
  late: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};
// Seven demo courses beside the real one. Clearly labelled as demo in the UI.
const DEMO_COURSES = [
  { title: "Software Development NQF5", teacher: "T. Mokoena", status: "ok", students: 32, risk: 2 },
  { title: "Data Analytics", teacher: "R. Naidoo", status: "ok", students: 26, risk: 1 },
  { title: "Network Engineering", teacher: "S. Dlamini", status: "risk", students: 24, risk: 5, reason: "3 lessons behind the timetable since the long weekend", action: "Add a catch-up slot" },
  { title: "Cloud Fundamentals", teacher: "L. Botha", status: "ok", students: 30, risk: 1 },
  { title: "UX Design", teacher: "K. Pillay", status: "ok", students: 18, risk: 0 },
  { title: "IT Support A+", teacher: "M. Khumalo", status: "ok", students: 28, risk: 3, reason: "6 learners quiet in the last two classes", action: "Message the facilitator" },
  { title: "Business Analysis", teacher: "P. van Wyk", status: "ok", students: 21, risk: 2 },
];

async function pageSchool() {
  chrome("school");
  $("#view").innerHTML = `<div class="empty">Walking the corridors…</div>`;
  const [st, board] = await Promise.all([api(`/api/state/${S.cid}`), api(`/api/ft/${S.cid}/board`)]);
  const p = st.pacing || {};
  const realRisk = board.learners.filter((l) => (l.answered >= 5 && l.correct / l.answered < .6) || l.sure_wrong >= 3).length;
  const real = { title: st.course.title, teacher: st.course.teacher || "Facilitator", status: p.shortfall ? "late" : p.behind_schedule ? "risk" : "ok",
    students: board.learners.length, risk: realRisk, real: true,
    reason: p.shortfall ? `${p.shortfall} lessons land after the exam on ${fmtDate(p.exam_date)}` : null, action: "Re-plan the term" };
  const courses = [real, ...DEMO_COURSES];
  const onTrack = courses.filter((c) => c.status === "ok").length;
  const atRisk = courses.reduce((s, c) => s + c.risk, 0);
  const students = courses.reduce((s, c) => s + c.students, 0);
  const hue = { ok: "#ff9ccb", risk: "#c00d68", late: "#3f3f46" };
  const word = { ok: "on track", risk: "at risk", late: "won't finish" };
  const attention = courses.filter((c) => c.reason).sort((a, b) => (a.status === "late" ? -1 : 0) - (b.status === "late" ? -1 : 0) || b.risk - a.risk);
  attention.push({ title: "Whole school", teacher: "Admissions", status: "risk", reason: `${atRisk} learners show drop-out signals: quiet, failing or absent`, action: "Open the list" });
  $("#view").innerHTML = `
    <section class="own">
      <div class="rise"><h1>${onTrack} of ${courses.length} courses will finish before their exams.</h1>
        <div class="glass lit own-art" style="margin-top:22px">${window.schoolSVG("ownSchool")}
          <div class="wingkey">${courses.map((c) => `<span class="st-${c.status}" title="${esc(c.title)}: ${word[c.status]}"><i>${STICON[c.status]}</i><b>${esc(c.title)}</b></span>`).join("")}</div></div>
      </div>
      <div class="rise" style="--i:1">
        <div class="glass kpis">
          <div><b class="num"><span data-tick="${onTrack}">0</span><small>/${courses.length}</small></b><span>courses on track</span></div>
          <div><b class="num neg" data-tick="${atRisk}">0</b><span>students at risk, of ${students}</span></div>
          <div><b class="num pos"><span data-tick="46">0</span><small> h</small></b><span>teacher hours the agents saved this month</span></div>
          <div><b class="num"><span data-tick="81">0</span><small>%</small></b><span>forecast pass rate</span></div>
          <div class="wide"><b class="num neg"><small>R </small><span data-tick="${atRisk * 14500}">0</span></b><span>fees at risk from likely drop-outs (R14 500 each)</span></div>
        </div>
        <p class="demo-note">${esc(st.course.title)} is live data. The other ${DEMO_COURSES.length} courses, hours saved and pass rate are demo figures.</p>
      </div>
    </section>
    <section class="sec rise" style="--i:2">
      <div class="sec-head"><div><h2>Needs your attention</h2><p>Ranked by what costs the school most if nobody acts this week.</p></div></div>
      <div class="attn">${attention.map((c, i) => `<div class="glass item spot" style="--c:${hue[c.status]}">
          <span class="rank">${i + 1}</span>
          <div class="what"><b>${esc(c.title)}</b> <span class="stat st-${c.status}">${STICON[c.status]}${word[c.status]}</span>${c.real ? ` <span class="chip ok" style="margin-left:4px">live</span>` : ""}<div>${esc(c.reason)} · ${esc(c.teacher)}</div></div>
          ${c.real ? `<a class="btn go sm" href="#/class">${esc(c.action)} ${I.arrow}</a>` : `<button class="btn sm">${esc(c.action)}</button>`}</div>`).join("")}</div>
    </section>`;
  const svg = $("#ownSchool");
  drawIn(svg);
  // columns 0..7 = courses: both windows of a column take the course colour
  courses.forEach((c, i) => $$(`.win[data-col="${i}"]`, svg).forEach((w, k) => setTimeout(() => w.classList.add(c.status), 900 + i * 120 + k * 60)));
  requestAnimationFrame(() => tickAll($("#view")));
  spotlight();
}

// ------------------------------------------------------------------ student: who and picker

function pageWho() {
  chrome("play");
  const people = (S.data.learners || []).filter((l) => !/\(sample\)/.test(l.name));
  $("#view").innerHTML = `<div class="glass lit who-card rise"><h1>Who's climbing?</h1>
    <p class="sub">Your progress is saved under your name and your facilitator sees it.</p>
    ${people.length ? `<div class="people">${people.map((l) => `<button class="btn" data-act="me" data-id="${l.id}">${esc(l.name)}</button>`).join("")}</div>` : ""}
    <form id="whoForm"><input name="name" placeholder="Your name" autocomplete="given-name" required maxlength="60" aria-label="Your name"><button class="btn go">Start climbing ${I.arrow}</button></form></div>`;
  $("#whoForm").onsubmit = async (e) => {
    e.preventDefault();
    const r = await api(`/api/ft/${S.cid}/learner`, { json: { name: e.target.name.value } });
    await setMe(r.learner_id);
  };
}
async function setMe(id) { S.learner = id; store(`ft.learner.${S.cid}`, String(id)); await loadChapters(); route(); }
const topOf = (c) => { let t = 0; for (let i = 1; i <= 10; i++) if (c.levels?.[i]?.passed) t = i; return t; };

function pagePick() {
  chrome("play");
  const d = S.data, st = d.stats || {}, me = d.learners.find((l) => l.id === S.learner);
  const mods = ["All", ...new Set(d.chapters.map((c) => split(c.title).mod))];
  const acc = st.answered ? Math.round((100 * st.correct) / st.answered) : 0;
  const cal = st.sure_right + st.sure_wrong ? Math.round((100 * st.sure_right) / (st.sure_right + st.sure_wrong)) : null;
  const resume = [...d.chapters].filter((c) => topOf(c) > 0 && !c.levels?.[QUIZ]?.passed).sort((a, b) => topOf(b) - topOf(a))[0];
  $("#view").innerHTML = `<div class="pick-head rise"><h1>${resume ? "Keep climbing" : "Pick a chapter"}, ${esc((me?.name || "").split(" ")[0])}.</h1>
      <p>Every chapter is a tower of ten floors: recall it, explain it, catch the mistake, apply it, analyse it. Then the final quiz puts the roof on.</p>
      ${resume ? `<div style="margin-top:22px"><button class="btn go" data-act="chapter" data-id="${resume.id}">Continue ${esc(split(resume.title).name)} · floor ${topOf(resume) + 1} ${I.arrow}</button></div>` : ""}</div>
    <div class="glass me rise" style="--i:1">
      <div><b class="num" data-tick="${st.xp || 0}">0</b><span>XP earned</span></div>
      <div><b class="num" data-tick="${st.best_streak || 0}">0</b><span>best streak</span></div>
      <div><b class="num">${st.answered ? acc + "%" : "–"}</b><span>answers right</span></div>
      <div><b class="num">${cal === null ? "–" : cal + "%"}</b><span>right when certain</span></div></div>
    <div class="filters rise" style="--i:2"><label class="search">${I.search}<input id="q" type="search" placeholder="Search ${d.chapters.length} chapters" value="${esc(S.filter)}" aria-label="Search chapters"></label>
      <div class="mods">${mods.map((m) => `<button data-act="mod" data-mod="${esc(m)}" class="${m === S.mod ? "on" : ""}">${esc(m)}</button>`).join("")}</div></div>
    <div class="chaps" id="chaps"></div>
    <p class="small mute" style="margin-top:28px">Not ${esc(me?.name || "you")}? <a href="#" data-act="switch">Switch player</a></p>`;
  $("#q").oninput = (e) => { S.filter = e.target.value; chapList(); };
  chapList();
  tickAll($("#view"));
}
function chapList() {
  const f = S.filter.trim().toLowerCase();
  const rows = S.data.chapters.filter((c) => (S.mod === "All" || split(c.title).mod === S.mod) && (!f || c.title.toLowerCase().includes(f)));
  $("#chaps").innerHTML = rows.map((c, i) => {
    const t = split(c.title), top = topOf(c), quiz = c.levels?.[QUIZ]?.passed;
    const floors = Array.from({ length: 11 }, (_, k) => `<i class="${k < top || (k === 10 && quiz) ? "on" : ""}" style="--c:${HUE[cls(k + 1)]}"></i>`).join("");
    return `<button class="glass chap spot rise" style="--i:${Math.min(i, 12)}" data-act="chapter" data-id="${c.id}">
      <div><div class="code">${esc(t.mod)} · ${esc(t.kt)}</div><div class="t">${esc(t.name)}</div>
        <div class="m">${quiz ? "Roof on · quiz passed" : top ? `Floor ${top} of 10` : "Not started"} · ${c.passages} passages</div></div>
      <div class="stack" aria-label="${top} of 10 floors">${floors}</div></button>`;
  }).join("") || `<div class="empty">No chapters match “${esc(S.filter)}”.</div>`;
  spotlight($("#chaps"));
}

// ------------------------------------------------------------------ student: chapter tower

function tower(top, quiz, fresh) {
  const cx = 150, base = 392, h = 25, hw = 92, hd = 46;
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.round(v * k); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  const floor = (i, hex, extra = "") => {
    const cy = base - i * h;
    const topF = `${cx},${cy - hd} ${cx + hw},${cy} ${cx},${cy + hd} ${cx - hw},${cy}`;
    const left = `${cx - hw},${cy} ${cx},${cy + hd} ${cx},${cy + hd + h} ${cx - hw},${cy + h}`;
    const right = `${cx},${cy + hd} ${cx + hw},${cy} ${cx + hw},${cy + h} ${cx},${cy + hd + h}`;
    const win = (x0, y0, dx, dy) => Array.from({ length: 4 }, (_, k) => { const x = x0 + dx * (k + .7), y = y0 + dy * (k + .7); return `<rect x="${x - 4}" y="${y + 7}" width="8" height="${h - 14}" rx="1.5" fill="#fff" opacity="${.18 + .5 * ((i * 7 + k * 3) % 5 === 0)}" transform="skewY(${dy > 0 ? 26.6 : -26.6})" transform-origin="${x} ${y}"/>`; }).join("");
    return `<g class="floor ${extra}" style="animation-delay:${extra ? ".15s" : "0s"}">
      <polygon points="${left}" fill="${shade(hex, .55)}"/><polygon points="${right}" fill="${shade(hex, .38)}"/>
      ${win(cx - hw, cy, hw / 4, hd / 4)}${win(cx, cy + hd, hw / 4, -hd / 4)}
      <polygon points="${topF}" fill="${hex}"/><polygon points="${topF}" fill="url(#gl)" opacity=".55"/></g>`;
  };
  let g = "";
  // ground slab
  g += `<polygon points="${cx},${base - hd + h + 18} ${cx + hw + 40},${base + h + 18 - 0} ${cx},${base + hd + h + 38} ${cx - hw - 40},${base + h + 18}" fill="rgba(230,25,127,.1)" stroke="rgba(230,25,127,.35)"/>`;
  for (let i = 0; i < top; i++) g += floor(i, HUE[cls(i + 1)], fresh === i + 1 ? "new" : "");
  if (top < 10) {
    const cy = base - top * h;
    g += `<g class="ghost"><polygon points="${cx},${cy - hd} ${cx + hw},${cy} ${cx},${cy + hd} ${cx - hw},${cy}"/><polygon points="${cx - hw},${cy} ${cx},${cy + hd} ${cx},${cy + hd + h} ${cx - hw},${cy + h}"/><polygon points="${cx},${cy + hd} ${cx + hw},${cy} ${cx + hw},${cy + h} ${cx},${cy + hd + h}"/></g>`;
  }
  if (quiz) {
    const cy = base - top * h;
    g += `<g class="floor ${fresh === QUIZ ? "new" : ""}"><polygon points="${cx - hw},${cy} ${cx},${cy + hd} ${cx},${cy - 70}" fill="#8f0a52"/><polygon points="${cx},${cy + hd} ${cx + hw},${cy} ${cx},${cy - 70}" fill="#3f3f46"/><polygon points="${cx - hw},${cy} ${cx},${cy - hd} ${cx},${cy - 70}" fill="#fff0f7" opacity=".9"/><circle cx="${cx}" cy="${cy - 78}" r="6" fill="#fff0f7" style="filter:drop-shadow(0 0 10px #fff0f7)"/></g>`;
  }
  return `<svg viewBox="0 70 300 400" role="img" aria-label="Tower: ${top} of 10 floors${quiz ? ", roof on" : ""}"><defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>${g}</svg>`;
}

function pageChapter(id) {
  chrome("play");
  const c = S.data.chapters.find((x) => x.id === id);
  if (!c) return go("#/play");
  S.chapter = c;
  const t = split(c.title), lv = c.levels || {}, top = topOf(c), quiz = lv[QUIZ]?.passed;
  const open = Math.min(top + 1, QUIZ);
  const rungs = [];
  for (let n = QUIZ; n >= 1; n--) {
    const k = cls(n), unlocked = n <= open, done = n === QUIZ ? quiz : lv[n]?.passed, now = n === open && !done;
    rungs.push(`<div class="rung ${done ? "done" : ""} ${now ? "now" : ""} ${unlocked ? "" : "locked"}" style="--c:${HUE[k]}">
      <div class="n">${n === QUIZ ? I.star.replace("<svg", '<svg width="18" height="18"') : n}</div>
      <div><div class="k">${n === QUIZ ? "Final quiz" : `Floor ${n} · ${esc(S.data.skills[n])}`}</div><div class="d">${esc(S.data.blurbs[n] || "")}</div></div>
      <div class="row">${lv[n] ? starRow(lv[n].stars) : ""}${unlocked ? `<button class="btn ${now ? "go" : ""} sm" data-act="play" data-level="${n}">${done ? "Replay" : "Climb"}</button>` : `<span class="lock">${I.lock}</span>`}</div></div>`);
  }
  const fresh = S.justCleared?.id === id ? S.justCleared.level : null;
  S.justCleared = null;
  $("#view").innerHTML = `<button class="back" data-act="pick">${I.back} All chapters</button>
    <div class="chapter">
      <div class="glass lit towerbox rise">${tower(top, quiz, fresh)}
        <div class="cap"><b class="num">${top}</b><span class="mute">/10 floors${quiz ? " · roof on" : ""}</span>${c.mastery ? `<div class="small mute">mastery ${c.mastery} of 5</div>` : ""}</div></div>
      <div class="rise" style="--i:1"><div class="code small" style="font-family:var(--mono);color:var(--violet-2)">${esc(t.mod)} · ${esc(t.kt)} · ${c.passages} passages</div>
        <h1 style="margin-top:6px">${esc(t.name)}</h1>
        <p class="sub" style="margin:12px 0 0">Get 3 of 5 right to build the next floor. Every question cites the passage it came from.</p>
        <div class="rungs">${rungs.join("")}</div></div>
    </div>`;
}

// ------------------------------------------------------------------ student: play

async function startLevel(level, fresh) {
  const c = S.chapter;
  $("#view").innerHTML = `<div class="play"><div class="glass q"><div class="empty">Building floor ${level} from the notes…</div></div></div>`;
  const seed = fresh || c.levels?.[level] ? Math.floor(Math.random() * 1e5) : 0;
  let data;
  try { data = await api(`/api/ft/topic/${c.id}/level/${level}?seed=${seed}`); }
  catch (e) { $("#view").innerHTML = `<div class="glass pad"><h2 class="h2">Couldn't build this floor</h2><p class="sub">${esc(e.message)}</p><button class="btn" data-act="ladder">Back to the tower</button></div>`; return; }
  S.run = { level, data, i: 0, answers: [], xp: 0, streak: S.data.stats?.streak || 0 };
  showQ();
}

function showQ() {
  const r = S.run, q = r.data.questions[r.i];
  Object.assign(r, { q, sure: null, done: false, mistakes: 0, pick: null, pickClue: null, matched: new Set(), wrongClue: null });
  const k = cls(r.level), hue = HUE[k];
  const timed = q.seconds && (q.type === "cloze" || q.type === "match");
  const dots = r.data.questions.map((_, j) => `<i class="${j < r.answers.length ? (r.answers[j].ok ? "ok" : "no") : j === r.i ? "now" : ""}"></i>`).join("");
  const stem = q.type === "match" || q.type === "spot" || !q.stem ? "" : `<p class="stem">${q.type === "truefalse" ? "“" : ""}${esc(q.stem).replace(/_____/g, '<span class="gap"></span>')}${q.type === "truefalse" ? "”" : ""}</p>`;
  $("#view").innerHTML = `<div class="play" style="--c:${hue}">
    <div class="ptop"><button class="x" data-act="quit" aria-label="Leave this floor">${I.x}</button>
      <span class="lvl">${r.level === QUIZ ? "Final quiz" : `Floor ${r.level} · ${esc(r.data.skill)}`}</span>
      <div class="dots" aria-label="Question ${r.i + 1} of ${r.data.questions.length}">${dots}</div></div>
    <div class="glass lit q" id="qc">
      <div class="qtop"><div><div class="qk">${esc(q.prompt)}</div>${stem}</div>
        ${timed ? `<div class="timer" id="tm" aria-label="Time left"><svg viewBox="0 0 62 62"><circle class="bg" cx="31" cy="31" r="26"/><circle class="fg" cx="31" cy="31" r="26" stroke-dasharray="163.4" stroke-dashoffset="0"/></svg><b id="tmT">${q.seconds}</b></div>` : ""}</div>
      <div class="sure" id="sure"><p>How sure are you?</p><div class="opts">${SURE.map(([v, t], j) => `<button data-act="sure" data-v="${v}" title="Key ${j + 1}">${t}</button>`).join("")}</div></div>
      <div id="ans" class="answers-wrap">${answersHtml(q)}</div>
      <div id="fb"></div></div></div>`;
  chrome("play");
  if (timed) startTimer(q.seconds);
}

function answersHtml(q) {
  if (q.type === "truefalse") return `<div class="answers tf wait">${["True", "False"].map((t, j) => `<button class="opt" data-act="ans" data-i="${j}">${t}</button>`).join("")}</div>`;
  if (q.type === "spot") return `<div class="answers wait"><div class="toks">${q.tokens.map((t, j) => `<button class="tok" data-act="ans" data-i="${j}">${esc(t)}</button>`).join("")}</div></div>`;
  if (q.type === "match") return `<div class="answers wait"><div class="match">${q.clues.map((c, j) => `<button class="clue" data-act="clue" data-i="${j}">${esc(c).replace("_____", '<span class="gap" style="min-width:60px"></span>')}</button>`).join("")}
      <div class="terms">${q.terms.map((t, j) => `<button class="term" data-act="term" data-i="${j}">${esc(t)}</button>`).join("")}</div></div>
      <p class="small mute" style="margin:4px 0 0">Tap a term, then the line it completes.</p></div>`;
  return `<div class="answers wait">${q.options.map((o, j) => `<button class="opt" data-act="ans" data-i="${j}"><span class="k">${"ABCD"[j]}</span><span>${esc(o)}</span></button>`).join("")}</div>`;
}

function pickSure(v) {
  const r = S.run;
  if (!r || r.done) return;
  r.sure = v;
  $$("#sure button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  $("#sure").classList.add("picked");
  $(".answers").classList.remove("wait");
}

function startTimer(sec) {
  stopTimer();
  const r = S.run, t0 = performance.now(), full = 163.4;
  r.timer = setInterval(() => {
    const left = Math.max(0, sec - (performance.now() - t0) / 1000), tm = $("#tm");
    if (!tm) return stopTimer();
    $(".fg", tm).setAttribute("stroke-dashoffset", String(full * (1 - left / sec)));
    $("#tmT").textContent = Math.ceil(left);
    tm.classList.toggle("low", left / sec < .4);
    tm.classList.toggle("out", left / sec < .2);
    if (left <= 0) { stopTimer(); resolve(false, { timeout: true }); }
  }, 100);
}
function stopTimer() { if (S.run?.timer) { clearInterval(S.run.timer); S.run.timer = null; } }

function answer(i) {
  const r = S.run, q = r?.q;
  if (!q || r.done || !r.sure) return;
  resolve(q.type === "truefalse" ? (i === 0) === q.answer : i === q.answer, { picked: i });
}
function tryPair(clue, term) {
  const r = S.run, q = r.q, ce = $(`.clue[data-i="${clue}"]`), te = $(`.term[data-i="${term}"]`);
  r.pick = null; r.pickClue = null;
  $$(".term,.clue").forEach((b) => b.classList.remove("sel"));
  if (q.answer[clue] === term) {
    r.matched.add(clue);
    ce.classList.add("done");
    ce.innerHTML = esc(q.clues[clue]).replace("_____", `<span class="fill">${esc(q.terms[term])}</span>`);
    te.classList.add("used");
    if (r.matched.size === q.clues.length) resolve(r.mistakes === 0);
  } else {
    r.mistakes++;
    if (r.wrongClue == null) r.wrongClue = clue;
    [ce, te].forEach((el) => { el.classList.remove("bad"); void el.offsetWidth; el.classList.add("bad"); });
  }
}

function resolve(ok, info = {}) {
  const r = S.run, q = r.q;
  if (r.done) return;
  r.done = true;
  stopTimer();
  const sure = r.sure || "guess";
  r.streak = ok ? r.streak + 1 : 0;
  const xp = ok ? Math.round((10 + (r.level === QUIZ ? 5 : r.level)) * SURE_X[sure]) + 2 * Math.min(r.streak - 1, 5) : 0;
  r.xp += xp;
  r.answers.push({ ok, sure, xp, qid: q.id, type: q.type });
  $$("#ans button, #sure button").forEach((b) => (b.disabled = true));
  if (q.type === "truefalse") $$("#ans .opt").forEach((b, j) => { if ((j === 0) === q.answer) b.classList.add("right"); else if (j === info.picked) b.classList.add("wrong"); });
  else if (q.options || q.type === "spot") $$(`#ans ${q.type === "spot" ? ".tok" : ".opt"}`).forEach((b, j) => { if (j === q.answer) b.classList.add("right"); else if (j === info.picked) b.classList.add("wrong"); });
  else if (q.type === "match" && !ok) {
    q.clues.forEach((c, j) => { if (!r.matched.has(j)) { const el = $(`.clue[data-i="${j}"]`); el.classList.add("done"); el.innerHTML = esc(c).replace("_____", `<span class="fill">${esc(q.terms[q.answer[j]])}</span>`); } });
    $$(".term").forEach((b) => b.classList.add("used"));
  }
  if (!ok) { const c = $("#qc"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake"); }
  const shown = q.type === "match" && r.wrongClue != null ? q.cites[r.wrongClue] : q.cites[0];
  const chips = q.cites.map((c) => `<button class="cite" data-act="qpas" data-n="${c.n}" data-s="${esc(c.sentence)}">P${c.n}</button>`).join(" ");
  const last = r.i === r.data.questions.length - 1;
  $("#fb").innerHTML = (ok
    ? `<div class="fb ok"><h3>Right <span class="plus">+${xp} XP</span>${r.streak >= 3 ? `<span class="chip warn">${I.fire.replace("<svg", '<svg width="13" height="13"')} ${r.streak} in a row</span>` : ""}</h3>
        <p class="small">${sure === "guess" ? "A guess that lands still counts, at half XP. " : sure === "certain" ? "Certain and right: 1.5× XP. " : ""}Source ${chips}</p></div>`
    : `<div class="fb no"><h3>${info.timeout ? "Out of time" : "Not quite"}${sure === "certain" ? `<span class="chip bad">You were certain</span>` : ""}</h3>
        <p>${whyWrong(q)}</p>${passageHtml(r.data.passages[String(shown.n)], shown.sentence)}<p class="small">Cited ${chips}</p></div>`)
    + `${q.note ? `<p class="small mute">${esc(q.note)}</p>` : ""}<div class="nextrow"><button class="btn go" id="nextBtn" data-act="next">${last ? "See how you did" : "Next"} ${I.arrow}</button></div>`;
  const m = $("#fb .passage mark");
  if (m) m.parentElement.scrollTop = Math.max(0, m.offsetTop - m.parentElement.offsetTop - 30);
  chrome("play");
  if (ok) { pop("#hXp"); pop("#hStreak"); }
  $("#nextBtn").focus({ preventScroll: true });
  $("#fb").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function whyWrong(q) {
  if (q.type === "truefalse") return q.answer ? "It's <b>true</b>: this line is word for word from the notes." : `It's <b>false</b>. The notes say “<b>${esc(q.original)}</b>”, not “${esc(q.changed)}”.`;
  if (q.type === "spot") return `The planted word was “<b>${esc(q.changed)}</b>”. The notes say “<b>${esc(q.original)}</b>”.`;
  if (q.type === "match") return "Here's the line you mixed up, in the notes:";
  if (q.pick_unsupported) return `The changed line said “${esc(q.changed)}”. The notes say “<b>${esc(q.original)}</b>”.`;
  return `The answer is “<b>${esc(q.options[q.answer])}</b>”. Here's where the notes say so:`;
}
function passageHtml(p, sentence) {
  if (!p) return "";
  let body = esc(p.text);
  const s = esc(sentence || ""), at = s ? body.indexOf(s) : -1;
  if (at >= 0) body = body.slice(0, at) + `<mark>${s}</mark>` + body.slice(at + s.length);
  return `<div class="passage"><div class="where">P${p.n} · ${esc(p.section)}</div>${body}</div>`;
}

function next() {
  const r = S.run;
  if (!r?.done) return;
  if (r.i < r.data.questions.length - 1) { r.i++; showQ(); window.scrollTo({ top: 0 }); } else finish();
}

async function finish() {
  const r = S.run, c = S.chapter, level = r.level;
  $("#view").innerHTML = `<div class="glass result"><div class="empty">Saving your floor…</div></div>`;
  let res;
  try { res = await api(`/api/ft/topic/${c.id}/level/${level}/result`, { json: { learner_id: S.learner, answers: r.answers } }); }
  catch (e) { $("#view").innerHTML = `<div class="glass pad"><h2 class="h2">Couldn't save</h2><p class="sub">${esc(e.message)}</p><button class="btn" data-act="ladder">Back to the tower</button></div>`; return; }
  S.run = null;
  const before = topOf(c);
  await loadChapters();
  S.chapter = S.data.chapters.find((x) => x.id === c.id) || c;
  const built = res.passed && (level === QUIZ || level > before);
  if (built) S.justCleared = { id: c.id, level };
  const nxt = level < QUIZ && res.passed ? level + 1 : null;
  chrome("play");
  $("#view").innerHTML = `<div class="glass lit result rise" style="--c:${HUE[cls(level)]}">
      <span class="lvl">${level === QUIZ ? "Final quiz" : `Floor ${level} · ${esc(S.data.skills[level])}`}</span>
      <div class="score"><span data-tick="${res.correct}" class="num">0</span><span>/${res.total}</span></div>
      ${starRow(res.stars)}
      <h2 class="h2">${res.passed ? (level === QUIZ ? "Roof's on. Chapter complete." : built ? `Floor ${level} built.` : "Cleared again.") : `So close. ${Math.ceil(.6 * res.total)} right builds the floor.`}</h2>
      <p class="sub"><b class="num" style="color:#ffd1e6">+${res.xp} XP</b> · best streak ${res.stats.best_streak}</p>
      <div class="mst">Chapter mastery <span class="meter">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= res.mastery.level ? "on" : ""}"></i>`).join("")}</span><b>${res.mastery.level}/5</b></div>
      <div class="cta">
        ${nxt ? `<button class="btn go" data-act="play" data-level="${nxt}">${nxt === QUIZ ? "Take the final quiz" : `Climb floor ${nxt}`} ${I.arrow}</button>` : ""}
        <button class="btn ${nxt ? "" : "go"}" data-act="retry" data-level="${level}">${res.passed ? "Play again" : "Try again"} · new questions</button>
        <button class="btn" data-act="ladder">See the tower</button>
      </div></div>`;
  tickAll($("#view"));
  if (res.passed) { confetti(level === QUIZ ? 260 : 150); refreshClassWindows(); }
}

// ------------------------------------------------------------------ confetti (canvas)

function confetti(n = 150) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("#confetti"), ctx = cv.getContext("2d"), dpr = devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const cols = ["#e6197f", "#ff3d9a", "#ff9ccb", "#ffd1e6", "#fff0f7", "#c00d68", "#8f0a52"];
  const ps = Array.from({ length: n }, (_, i) => {
    const side = i % 2 ? 1 : -1, a = (side > 0 ? -Math.PI * .72 : -Math.PI * .28) + (Math.random() - .5) * .7, v = 9 + Math.random() * 9;
    return { x: side > 0 ? innerWidth * .08 : innerWidth * .92, y: innerHeight * .78, vx: Math.cos(a) * v * -side * -1, vy: Math.sin(a) * v, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      r: Math.random() * 6, vr: (Math.random() - .5) * .35, c: cols[i % cols.length], life: 0 };
  });
  ps.forEach((p, i) => { if (i % 2) p.vx = Math.abs(p.vx); else p.vx = -Math.abs(p.vx); });
  let t0 = performance.now();
  const frame = (now) => {
    const dt = Math.min(2, (now - t0) / 16.7); t0 = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;
    for (const p of ps) {
      p.life += dt; p.vy += .32 * dt; p.vx *= .992; p.vy *= .992; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      if (p.y < innerHeight + 40 && p.life < 260) {
        alive++;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - p.life / 260);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.life * .15)), p.w, p.h * Math.abs(Math.cos(p.life * .15)) + 1); ctx.restore();
      }
    }
    if (alive) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ events

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) { if (e.target.id === "sheet") $("#sheet").hidden = true; return; }
  const a = el.dataset.act, r = S.run;
  if (el.tagName === "A") e.preventDefault();
  if (a === "prepare") return prepare(Number(el.dataset.id), el);
  if (a === "pas") return lessonPassage(Number(el.dataset.lesson), Number(el.dataset.n));
  if (a === "qpas") { const p = r?.data?.passages?.[el.dataset.n] || S.lastPassages?.[el.dataset.n]; if (p) sheet(passageHtml(p, el.dataset.s)); return; }
  if (a === "close") { $("#sheet").hidden = true; return; }
  if (a === "me") return setMe(Number(el.dataset.id));
  if (a === "switch") { S.learner = null; store(`ft.learner.${S.cid}`, null); return pageWho(); }
  if (a === "mod") { S.mod = el.dataset.mod; $$(".mods button").forEach((b) => b.classList.toggle("on", b.dataset.mod === S.mod)); return chapList(); }
  if (a === "chapter") return go(`#/play/chapter/${el.dataset.id}`);
  if (a === "pick") return go("#/play");
  if (a === "ladder") { S.run = null; return pageChapter(S.chapter.id); }
  if (a === "play") return startLevel(Number(el.dataset.level), false);
  if (a === "retry") return startLevel(Number(el.dataset.level), true);
  if (a === "quit") { if (!r?.answers.length || confirm("Leave this floor? Answers so far won't be saved.")) { stopTimer(); S.run = null; pageChapter(S.chapter.id); } return; }
  if (a === "sure") return pickSure(el.dataset.v);
  if (a === "ans") return answer(Number(el.dataset.i));
  if ((a === "term" || a === "clue") && r?.sure && !r.done) {
    const i = Number(el.dataset.i);
    if (a === "term") {
      if (r.pickClue != null) return tryPair(r.pickClue, i);
      r.pick = i; $$(".term").forEach((b) => b.classList.toggle("sel", b === el)); return;
    }
    if (r.matched.has(i)) return;
    if (r.pick != null) return tryPair(i, r.pick);
    r.pickClue = i; $$(".clue").forEach((b) => b.classList.toggle("sel", b === el)); return;
  }
  if (a === "next") return next();
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input")) return;
  if (e.key === "Escape") { $("#sheet").hidden = true; return; }
  const r = S.run;
  if (!r?.q) return;
  if (r.done && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); return next(); }
  const n = Number(e.key);
  if (!n) return;
  if (!r.sure && n <= 3) return pickSure(SURE[n - 1][0]);
  if (r.sure && !r.done && r.q.options && n <= r.q.options.length) return answer(n - 1);
  if (r.sure && !r.done && r.q.type === "truefalse" && n <= 2) return answer(n - 1);
});
window.addEventListener("resize", () => { if ($("#beam")) beam(); });

boot().catch((e) => { $("#view").innerHTML = `<div class="glass pad"><h2 class="h2">Fast Track couldn't start</h2><p class="sub">${esc(e.message)}</p></div>`; });
