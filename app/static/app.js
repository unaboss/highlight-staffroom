/* Staffroom dashboard: one page app over the FastAPI back end. Live agent events arrive over SSE. */
"use strict";

// ------------------------------------------------------------------ constants

const AGENTS = [
  { name: "Principal", role: "Plans the term, keeps the pace", color: "#14532d", short: "PR" },
  { name: "Librarian", role: "Finds and numbers the notes", color: "#1d4ed8", short: "LI" },
  { name: "Subject Teacher", role: "Writes lessons, drafts tests", color: "#b45309", short: "ST" },
  { name: "Examiner", role: "Checks every claim", color: "#c2410c", short: "EX" },
  { name: "Class Observer", role: "Reads the class recording", color: "#6d28d9", short: "CO" },
  { name: "Counsellor", role: "Tracks mastery, flags learners", color: "#0e7490", short: "CN" },
];
const EXTRA = {
  ClickUp: { color: "#7b68ee", short: "CU", role: "Task board" },
  Staffroom: { color: "#1b2330", short: "SR", role: "Coordinator" },
  Teacher: { color: "#15803d", short: "YOU", role: "You" },
};
const KIND = {
  start: ["started", "grey"], work: ["working", "grey"], handoff: ["hand-off", "blue"], pass: ["passed", "green"],
  reject: ["sent back", "red"], done: ["done", "green"], warn: ["heads-up", "amber"], error: ["error", "red"],
  sync: ["ClickUp", "violet"],
};
const LABEL = { Participating: "green", Active: "green", Quiet: "amber", "Left early": "amber", "Off topic": "violet", Absent: "red" };
const VERDICT = { Supported: "green", "Partly supported": "amber", Contradicted: "red", "Not in the material": "red", Uncited: "amber" };
const LEVELS = { 1: "Recall", 2: "Explain", 3: "Apply", 4: "Analyse", 5: "Evaluate" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEMO_TITLE = "Network Security Fundamentals";
const SPEEDS = { read: 520, fast: 150, instant: 0 };

const S = {
  cid: null, courses: [], state: null, health: null, page: "home", arg: null,
  feed: [], queue: [], agents: {}, lastLive: 0, speed: store("speed") || "read",
  drawer: null, ctx: [], sessionId: null, session: null, testId: null, renderToken: 0,
};

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem("staffroom." + key);
    localStorage.setItem("staffroom." + key, value);
  } catch (e) { /* private window: fine without it */ }
  return null;
}

function day(iso, opts) {
  if (!iso) return "—";
  const x = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(x)) return iso;
  return x.toLocaleDateString("en-GB", opts || { weekday: "short", day: "numeric", month: "short" });
}
const clock = (ts) => { const x = new Date(ts); return isNaN(x) ? "" : x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };
const mmss = (sec) => { sec = Math.max(0, Math.round(+sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
const pct = (x) => `${Math.round((+x || 0) * 100)}%`;

function who(name) {
  return AGENTS.find((a) => a.name === name) || EXTRA[name] || { color: "#64748b", short: String(name || "?").slice(0, 2).toUpperCase() };
}
function avatar(name, size) {
  const w = who(name);
  const st = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size / 2.8)}px;` : "";
  return `<div class="avatar" style="background:${w.color};${st}">${esc(w.short)}</div>`;
}
const pill = (text, color) => `<span class="pill ${color || "grey"}">${esc(text)}</span>`;
const levelBars = (lv) => `<span class="levels" title="Level ${lv}: ${LEVELS[lv] || ""}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= lv ? "on" : ""}"></i>`).join("")}</span>`;
const scoreColor = (s) => (s >= 70 ? "#22c55e" : s >= 40 ? "#f59e0b" : "#ea580c");

/** Text with [P#] markers turned into clickable citation chips. */
function cited(text) {
  return esc(text).replace(/\[P(\d+)\]/g, (_, n) => `<span class="cite" data-n="${n}" title="Show passage P${n}">P${n}</span>`);
}
const stripCites = (t) => String(t || "").replace(/\s*\[P\d+\]/g, "").trim();

async function api(path, opts = {}) {
  const o = { ...opts };
  if (o.json !== undefined) {
    o.method = o.method || "POST";
    o.headers = { "Content-Type": "application/json" };
    o.body = JSON.stringify(o.json);
    delete o.json;
  }
  const r = await fetch(path, o);
  let data = null;
  try { data = await r.json(); } catch (e) { /* empty body */ }
  if (!r.ok) {
    const d = data && data.detail;
    const msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg || JSON.stringify(x)).join("; ") : `${r.status} ${r.statusText}`;
    throw new Error(msg);
  }
  return data;
}
const post = (path, json) => api(path, json === undefined ? { method: "POST" } : { json });

function toast(html, kind = "", ms = 4500) {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = html;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const clickupUrl = (id) => `https://app.clickup.com/t/${encodeURIComponent(id)}`;
const clickupLink = (id, label = "Open in ClickUp") => id
  ? `<a class="btn sm ghost" href="${clickupUrl(id)}" target="_blank" rel="noopener">${CU_ICON}${esc(label)}</a>` : "";
const CU_ICON = `<svg class="cu-mark" viewBox="0 0 24 24" fill="none" stroke="#7b68ee" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l4-3c2.5 3 5.5 3 8 0l4 3"/><path d="M7 9l5-4 5 4"/></svg>`;

// ------------------------------------------------------------------ state

function nextLesson() {
  return (S.state?.lessons || []).find((l) => l.status === "Planned") || null;
}
function isDemo() { return S.state?.course?.title === DEMO_TITLE; }

async function loadCourses() {
  S.courses = await api("/api/courses");
  if (!S.courses.some((c) => c.id === S.cid)) {
    const saved = +store("course");
    S.cid = (S.courses.find((c) => c.id === saved) || S.courses[0] || {}).id || null;
  }
  const sel = $("#courseSelect");
  sel.innerHTML = S.courses.length
    ? S.courses.map((c) => `<option value="${c.id}" ${c.id === S.cid ? "selected" : ""}>${esc(c.title)}</option>`).join("")
    : `<option value="">No course yet</option>`;
}

async function loadState() {
  S.state = S.cid ? await api(`/api/state/${S.cid}`) : null;
  if (S.cid) store("course", S.cid);
}

let refreshTimer = null;
function scheduleRefresh(ev) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      await loadState();
      renderChrome();
      if (autoRender(ev)) renderPage();
      if (S.page === "staffroom") { const y = $("#youCard"); if (y) y.outerHTML = youCard(); paintAgent("ClickUp"); }
      if (ev && ev.kind === "done" && S.drawer) reloadDrawer();
    } catch (e) { console.warn(e); }
  }, 300);
}
function autoRender(ev) {
  if (S.page === "settings" || S.page === "staffroom") return false;
  if (S.page === "class") return !!ev && ev.kind === "done";
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $("#page").contains(document.activeElement)) return false;
  return true;
}

// ------------------------------------------------------------------ live events

function connect() {
  const es = new EventSource("/api/events/stream");
  es.onmessage = (e) => {
    try { S.queue.push(JSON.parse(e.data)); } catch (err) { /* ping */ }
  };
  es.onopen = () => { if (S.wasDown) { S.wasDown = false; scheduleRefresh(); } };
  es.onerror = () => { S.wasDown = true; };
}

function pump() {
  const base = SPEEDS[S.speed] ?? SPEEDS.read;
  if (S.queue.length) {
    if (!base) while (S.queue.length) show(S.queue.shift());
    else show(S.queue.shift());
  }
  feedNote();
  const backlog = S.queue.length;
  setTimeout(pump, backlog ? (backlog > 40 ? Math.max(60, base / 3) : base) : 120);
}

function show(ev, live = true) {
  S.feed.push(ev);
  if (S.feed.length > 600) S.feed.shift();
  const a = (S.agents[ev.agent] = S.agents[ev.agent] || { n: 0 });
  a.n += 1;
  a.msg = ev.message;
  a.kind = ev.kind;
  if (live) {
    a.cls = ev.kind === "reject" ? "rejecting" : ["pass", "done"].includes(ev.kind) ? "passed"
      : ["start", "work", "handoff", "sync"].includes(ev.kind) ? "working" : "";
    clearTimeout(a.timer);
    a.timer = setTimeout(() => { a.cls = ""; paintAgent(ev.agent); }, ev.kind === "reject" ? 3600 : ev.kind === "pass" ? 3000 : 2300);
    S.lastLive = Date.now();
  }
  if (S.page === "staffroom") { appendEv(ev); paintAgent(ev.agent); }
  if (S.drawer && S.drawer.job && ev.job_id === S.drawer.job) {
    const mf = $("#drawerFeed");
    if (mf) { mf.insertAdjacentHTML("beforeend", evHtml(ev)); mf.scrollTop = mf.scrollHeight; }
  }
  if (live) {
    notify(ev);
    if (["done", "error"].includes(ev.kind) || (ev.data && (ev.data.lesson_id || ev.data.test_id || ev.data.pacing)) || ev.agent === "Teacher") scheduleRefresh(ev);
  }
  liveDot();
}

function notify(ev) {
  if (ev.kind === "error") return toast(`<b>${esc(ev.agent)}:</b> ${esc(ev.message)}`, "bad", 7000);
  if (S.page === "staffroom") return;
  if (ev.agent === "Examiner" && ev.kind === "reject" && !S.drawer) toast(`<b>Examiner:</b> ${esc(ev.message)}`, "bad");
  else if (ev.data && ev.data.test_id && ev.kind === "handoff") toast(`${esc(ev.message)} <a href="#tests/${ev.data.test_id}" style="color:#fff">Review it</a>`, "ok", 6000);
  else if (ev.agent === "Principal" && ev.data && ev.data.pacing && ev.kind === "warn") toast(`<b>Principal:</b> ${esc(ev.message)}`, "", 6500);
}

function liveDot() {
  const on = S.queue.length > 0 || Date.now() - S.lastLive < 3000;
  $("#liveDot").classList.toggle("on", on);
}

function evHtml(ev) {
  const [k, col] = KIND[ev.kind] || [ev.kind, "grey"];
  return `<div class="ev ${esc(ev.kind)}">${avatar(ev.agent)}<div><div class="meta"><b style="color:var(--ink)">${esc(ev.agent)}</b>${pill(k, col)}<span>${clock(ev.ts)}</span></div><div class="msg">${esc(ev.message)}</div></div></div>`;
}

function appendEv(ev) {
  const feed = $("#feed");
  if (!feed) return;
  const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
  feed.querySelector(".empty")?.remove();
  feed.insertAdjacentHTML("beforeend", evHtml(ev));
  while (feed.children.length > 300) feed.firstElementChild.remove();
  if (near) feed.scrollTop = feed.scrollHeight;
}

function agentCard(a) {
  const s = S.agents[a.name] || {};
  const state = s.cls === "working" ? `<span class="typing"><i></i><i></i><i></i></span>&nbsp;<span class="small ok-text">working</span>`
    : s.cls === "rejecting" ? pill("Sent back", "red") : s.cls === "passed" ? pill("Passed", "green") : pill("Idle", "grey");
  return `<div class="agent ${s.cls || ""}" id="ag-${a.short}">
    <div class="who">${avatar(a.name)}<div><b>${esc(a.name)}</b><div class="role">${esc(a.role)}</div></div></div>
    <div class="say">${s.msg ? esc(s.msg) : `<span class="muted">Waiting for work</span>`}</div>
    <div class="foot"><span class="state">${state}</span><span class="count">${plural(s.n || 0, "step")}</span></div>
  </div>`;
}

function paintAgent(name) {
  const a = AGENTS.find((x) => x.name === name);
  if (a) {
    const el = $(`#ag-${a.short}`);
    if (el) el.outerHTML = agentCard(a);
  } else if (name === "ClickUp") {
    const el = $("#cuCard");
    if (el) el.outerHTML = clickupCard();
  }
}

function feedNote() {
  const el = $("#feedNote");
  if (!el) return;
  const n = S.queue.length;
  el.innerHTML = n ? `<span class="feed-note"><span class="typing"><i></i><i></i><i></i></span>${n} more on the way <button class="btn sm" data-act="skip">Skip ahead</button></span>`
    : Date.now() - S.lastLive < 3000 ? `<span class="feed-note"><span class="typing"><i></i><i></i><i></i></span>Live</span>` : "";
}

// ------------------------------------------------------------------ chrome

function renderChrome() {
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === S.page));
  const st = S.state, c = st && st.course;
  $("#courseTitle").textContent = c ? c.title : "Staffroom";
  if (c) {
    const bits = [c.teacher, `${(c.slot_days || []).map((i) => DAYS[i]).join(", ")} · ${c.slot_minutes}-minute lessons`, `Exam ${day(c.exam_date)}`].filter(Boolean);
    $("#courseMeta").innerHTML = esc(bits.join(" · ")) + (st.pacing && st.pacing.today ? ` · <b title="The date Staffroom treats as today">Today ${esc(day(st.pacing.today))}</b>` : "");
  } else {
    $("#courseMeta").textContent = "AI staff for online schools";
  }
  const llm = (st && st.llm) || (S.health && S.health.llm);
  if (llm) {
    const short = llm.online ? String(llm.label).split("/").pop().replace(/_/g, ".") : "Offline mode";
    $("#modelChip").innerHTML = `<span class="dot ${llm.online ? "green" : "amber"}" style="margin:0"></span>${esc(short)}`;
    $("#modelChip").title = llm.online ? `Model: ${llm.label}` : "No model key: Staffroom drafts from the notes and checks with rules in code";
  }
  const ig = (st && st.integrations) || {};
  $("#integrations").innerHTML = [["Model", llm && llm.online], ["ClickUp", ig.clickup_course], ["Meet", ig.meet], ["Moodle", ig.moodle]]
    .map(([n, on]) => `<span><i class="${on ? "on" : ""}"></i>${n}</span>`).join("");
  const waiting = (st && st.tests || []).filter((t) => t.status === "Needs approval").length;
  $("#testBadge").textContent = waiting || "";
  $("#topActions").innerHTML = topActions();
}

function topActions() {
  const st = S.state;
  const nl = nextLesson();
  const demoBtn = `<button class="btn ${st ? "" : "primary"}" data-act="demo">${st && isDemo() && st.sessions.length ? "Replay the demo" : "Run the demo"}</button>`;
  switch (S.page) {
    case "home":
      return (st ? (nl ? `<button class="btn primary" data-act="prepare" data-id="${nl.id}">${nl.has_plan ? "Rewrite" : "Prepare"} next lesson</button>` : "") : "") + demoBtn;
    case "staffroom":
      return `<select class="speed" id="speed" aria-label="Replay speed">${Object.entries({ read: "Reading speed", fast: "Fast", instant: "Instant" })
        .map(([k, v]) => `<option value="${k}" ${S.speed === k ? "selected" : ""}>${v}</option>`).join("")}</select>` + demoBtn;
    case "plan":
      return st ? `<button class="btn" data-act="replan">Re-plan the term</button>` + (nl ? `<button class="btn primary" data-act="prepare" data-id="${nl.id}">${nl.has_plan ? "Rewrite" : "Prepare"} next lesson</button>` : "") : "";
    case "class":
      return st ? `<a class="btn" href="/api/demo/files/class-firewalls.vtt">Demo transcript</a><a class="btn" href="/api/demo/files/attendance-firewalls.csv">Demo register</a>` : "";
    default:
      return "";
  }
}

// ------------------------------------------------------------------ router

const PAGES = { home: pageHome, staffroom: pageStaffroom, plan: pagePlan, class: pageClass, tests: pageTests, learners: pageLearners, settings: pageSettings };

function route() {
  const [p, arg] = (location.hash.slice(1) || "home").split("/");
  S.page = PAGES[p] ? p : "home";
  S.arg = arg || null;
  if (S.page === "tests" && S.arg) S.testId = +S.arg;
  if (S.page === "class" && S.arg) S.sessionId = +S.arg;
  closeDrawer();
  renderChrome();
  renderPage();
  window.scrollTo(0, 0);
}

async function renderPage() {
  const token = ++S.renderToken;
  const html = await PAGES[S.page]();
  if (token !== S.renderToken) return;
  $("#page").innerHTML = html;
  const after = AFTER[S.page];
  if (after) after();
}

const AFTER = {
  staffroom() { const f = $("#feed"); if (f) f.scrollTop = f.scrollHeight; feedNote(); },
  class() { const sid = S.sessionId && (S.state?.sessions || []).some((s) => s.id === S.sessionId) ? S.sessionId : (S.state?.sessions || []).find((s) => s.has_report)?.id; if (sid) loadSession(sid); },
  tests() { const t = pickTest(); if (t) loadTest(t); },
};

function noCourse() {
  return `<div class="card welcome demo-card">
    <h2>Meet your staffroom</h2>
    <p class="muted">Six AI staff members run the back office of an online class. They plan the term against the exam date,
    write lesson plans from your own notes, check every claim before you see it, read the class recording to see who took part,
    and draft personal tests that wait for your approval.</p>
    <div class="team">${AGENTS.map((a) => `<div>${avatar(a.name, 34)}<b>${esc(a.name)}</b><span class="muted">${esc(a.role)}</span></div>`).join("")}</div>
    <div class="row" style="margin-top:18px"><button class="btn primary" data-act="demo">Run the demo</button>
      <a class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.4)" href="#settings">Set up your own course</a></div>
  </div>`;
}

// ------------------------------------------------------------------ home

function pageHome() {
  const st = S.state;
  if (!st) return noCourse();
  const p = st.pacing || {};
  const nl = nextLesson();
  const waiting = st.tests.filter((t) => t.status === "Needs approval");
  const last = st.sessions.find((s) => s.has_report);
  const showDemo = isDemo() && !st.sessions.length;
  return `
  ${showDemo ? `<div class="card demo-card" style="margin-bottom:16px"><div class="row" style="justify-content:space-between">
      <div><h2 style="font-size:17px">Watch the staff at work</h2><div class="muted">Today's lesson is “${esc(nl ? nl.title : "")}”. One click and the staff prepare it, read the recorded class, flag who needs help and draft their tests.</div></div>
      <button class="btn primary" data-act="demo">Run the demo</button></div></div>` : ""}
  <div class="hero">
    <div class="card">${pacingCard(p)}</div>
    <div class="card next-lesson">${nextLessonCard(nl, p)}</div>
  </div>
  <div class="grid g3">
    <div class="card"><div class="card-head"><h2>Learners to check</h2><span class="muted">from the Counsellor</span></div>
      ${st.flags.length ? st.flags.map(flagRow).join("") : `<div class="empty">Nobody flagged. The Counsellor checks after every class.</div>`}</div>
    <div class="card"><div class="card-head"><h2>Waiting for your approval</h2><span class="muted">you have the last word</span></div>
      ${waiting.length ? waiting.map(testRow).join("") : `<div class="empty">No tests waiting.</div>`}</div>
    <div class="card"><div class="card-head"><h2>Last class</h2>${last ? `<a class="small" href="#class/${last.id}">Open report</a>` : ""}</div>
      ${last ? lastClass(last) : `<div class="empty">No class read yet. Upload a recording on the Class report page.</div>`}</div>
  </div>`;
}

function pacingCard(p) {
  if (!p.total) return `<h2>Pacing</h2><div class="empty">No term plan yet. Re-plan the term on the Course plan page.</div>`;
  const tot = p.total;
  const at = (n) => Math.max(0, Math.min(100, (n / tot) * 100));
  const fits = Math.min(tot, p.taught + p.slots_left);
  const label = (n, txt, up) => `<span class="label ${at(n) > 82 ? "right" : ""} ${up ? "up" : ""}" style="left:${at(n)}%">${txt}</span>`;
  const atRisk = p.at_risk || [];
  return `<div class="card-head"><h2>Will we finish before the exam?</h2><span class="muted">Principal's forecast</span></div>
    <div class="pace-bar" title="${p.taught} of ${tot} lessons taught">
      <div class="taught" style="width:${at(p.taught)}%"></div>
      ${p.due_by_today > p.taught ? `<div class="due" style="left:${at(p.due_by_today)}%"></div>${label(p.due_by_today, `should be at ${p.due_by_today}`, true)}` : ""}
      <div class="exam" style="left:${at(fits)}%"></div>${label(fits, fits >= tot && !p.shortfall ? "exam: room for all" : `exam: room for ${fits}`)}
    </div>
    <div class="pace-stats">
      <div class="stat"><b>${p.taught}/${tot}</b><span>lessons taught</span></div>
      <div class="stat ${p.behind_schedule ? "bad" : "ok"}"><b>${p.behind_schedule}</b><span>${p.behind_schedule === 1 ? "lesson" : "lessons"} behind plan</span></div>
      <div class="stat ${p.shortfall ? "bad" : "ok"}"><b>${esc(day(p.eta, { day: "numeric", month: "short" }))}</b><span>forecast finish</span></div>
      <div class="stat"><b>${p.days_to_exam}</b><span>days to the exam</span></div>
    </div>
    ${p.shortfall
      ? `<div class="banner bad">At this pace ${plural(p.shortfall, "lesson")} won't fit before the exam on ${esc(day(p.exam_date))}: ${esc(atRisk.join(", "))}. Add a catch-up slot or merge lessons, then re-plan.</div>`
      : `<div class="banner ok">On track: every lesson fits before the exam on ${esc(day(p.exam_date))}${p.slots_left > p.lessons_left ? `, with ${plural(p.slots_left - p.lessons_left, "spare slot")}` : ""}.</div>`}`;
}

function nextLessonCard(nl, p) {
  if (!nl) return `<h2>Next lesson</h2><div class="empty">Every lesson is taught. Time for revision.</div>`;
  const late = nl.planned_date && p.today && nl.planned_date < p.today;
  const fc = p.forecast && p.forecast[nl.id];
  return `<div class="card-head"><h2>Next lesson</h2>${nl.clickup_task_id ? clickupLink(nl.clickup_task_id, "ClickUp") : ""}</div>
    <div class="muted small">Lesson ${nl.seq} · ${esc(day(fc || nl.planned_date))}${late ? ` · <span class="bad-text">planned for ${esc(day(nl.planned_date))}</span>` : ""}</div>
    <h3>${esc(nl.title)}</h3>
    <div class="row" style="margin-bottom:12px">${nl.has_plan ? pill(nl.verdict === "Passed" ? "Examiner passed" : nl.verdict || "Drafted", nl.verdict === "Passed" ? "green" : "amber") + (nl.examiner_rounds ? pill(`${nl.examiner_rounds} send-back round${nl.examiner_rounds > 1 ? "s" : ""}`, "amber") : "") : pill("No plan yet", "grey")}</div>
    <p class="muted" style="margin:0 0 12px">${nl.has_plan ? "The plan cites the course notes for every statement. Click a P number in the plan to see the passage." : "The Librarian finds the passages, the Subject Teacher writes the plan, and the Examiner checks every statement against your notes."}</p>
    <div class="row">${nl.has_plan ? `<button class="btn primary" data-act="lesson" data-id="${nl.id}">Open lesson plan</button><button class="btn" data-act="prepare" data-id="${nl.id}">Rewrite</button>`
      : `<button class="btn primary" data-act="prepare" data-id="${nl.id}">Prepare with the staff</button>`}</div>`;
}

function flagRow(f) {
  const reasons = String(f.reason || "").split("; ");
  return `<div class="list-row"><span class="dot ${/Not on the register|Present \d+ of|Said in class/.test(f.reason) ? "red" : "amber"}"></span>
    <div class="grow"><b class="clickable" data-act="learner" data-id="${f.learner_id}">${esc(f.name)}</b>
      ${reasons.map((r, i) => `<div class="small ${i ? "muted" : ""}">${esc(r)}</div>`).slice(0, 3).join("")}
      ${f.targets && f.targets.length ? `<div class="small muted">Test drafted: ${esc(f.targets.map((t) => `${t.topic.split(":")[0]} (L${t.level})`).join(", "))}</div>` : ""}</div>
    <button class="btn sm ghost" data-act="flag-done" data-id="${f.id}" title="Mark as handled">Done</button></div>`;
}

function testRow(t) {
  const lv = Math.max(0, ...(t.targets || []).map((x) => x.level || 0));
  return `<div class="list-row clickable" data-act="goto" data-href="#tests/${t.id}"><span class="dot amber"></span>
    <div class="grow"><b>${esc(t.name || t.title)}</b><div class="small muted">${plural(t.questions, "question")} · up to level ${lv} ${LEVELS[lv] || ""}${t.verdict === "Passed" ? " · Examiner passed" : " · Examiner flagged"}</div></div>
    <span class="btn sm">Review</span></div>`;
}

function lastClass(s) {
  const ls = S.state.learners.filter((l) => l.last_label);
  return `<div class="small muted" style="margin-bottom:8px">${esc(s.lesson || "")} · ${esc(day(s.held_on))}</div>
    ${ls.map((l) => `<div class="list-row"><div class="grow clickable" data-act="learner" data-id="${l.id}"><b>${esc(l.name)}</b></div>${pill(l.last_label, LABEL[l.last_label])}<span class="small muted" style="width:28px;text-align:right">${Math.round(l.last_score)}</span></div>`).join("")}`;
}

// ------------------------------------------------------------------ staffroom

function pageStaffroom() {
  const st = S.state;
  const flow = [["Principal", "plans"], ["Librarian", "finds passages"], ["Subject Teacher", "drafts"], ["Examiner", "checks"]];
  const step = ([n, v]) => `<span class="step"><i style="background:${who(n).color}"></i><b>${n === "Teacher" ? "You" : n}</b> ${v}</span>`;
  return `
  <div class="flow-rows">
    <div class="flowline agent-flow"><span class="tag">Before class</span>${flow.map(step).join(`<span class="arrow">→</span>`)}
      <span class="loop" title="Unsupported statements go back to the Subject Teacher, at most twice, then to you">⟲ sends back up to 2×</span><span class="arrow">→</span>${step(["Teacher", "teach it"])}</div>
    <div class="flowline agent-flow"><span class="tag">After class</span>${[["Class Observer", "scores"], ["Examiner", "checks what learners said"], ["Counsellor", "flags"], ["Subject Teacher", "drafts a test"], ["Teacher", "approve"]].map(step).join(`<span class="arrow">→</span>`)}</div>
  </div>
  <div class="board">
    <div>
      <div class="agents">${AGENTS.map(agentCard).join("")}</div>
      <div class="grid g2 section-gap">
        ${clickupCard()}
        ${youCard()}
      </div>
    </div>
    <div class="card"><div class="card-head"><h2>Staffroom chat</h2><span class="muted" id="feedNote"></span></div>
      <div class="feed" id="feed">${S.feed.length ? S.feed.slice(-300).map(evHtml).join("") : `<div class="empty">Quiet for now. Run the demo or prepare a lesson and the staff will talk here.</div>`}</div>
    </div>
  </div>`;
}

function youCard() {
  const st = S.state;
  return `<div class="card" id="youCard"><div class="who row" style="gap:10px">${avatar("Teacher")}<div><b>You</b><div class="small muted">The teacher has the last word</div></div></div>
    <div class="say" style="margin-top:10px">${st ? youSummary(st) : "Load the demo or create a course to start."}</div></div>`;
}

function youSummary(st) {
  const w = st.tests.filter((t) => t.status === "Needs approval").length;
  const bits = [];
  if (w) bits.push(`<a href="#tests">${plural(w, "test")} waiting for approval</a>`);
  if (st.flags.length) bits.push(`<a href="#home">${plural(st.flags.length, "learner")} to check</a>`);
  const nl = nextLesson();
  if (nl && nl.has_plan) bits.push(`<a href="#plan">next lesson plan ready</a>`);
  return bits.length ? bits.join(" · ") : "Nothing waiting for you.";
}

function clickupCard() {
  const s = S.agents.ClickUp || {};
  const ig = S.state && S.state.integrations || {};
  return `<div class="card agent ${s.cls || ""}" id="cuCard" style="min-height:0">
    <div class="who">${avatar("ClickUp")}<div><b>ClickUp</b><div class="role">${ig.clickup_course ? "Lessons, follow-ups and tests sync to the course Space" : ig.clickup ? "Connected. Set up this course in Settings" : "Not connected. Add a token in Settings"}</div></div></div>
    <div class="say small">${s.msg ? esc(s.msg) : `<span class="muted">${ig.clickup_course ? "Waiting for the next task" : "Staffroom works without it: everything is also kept here"}</span>`}</div>
  </div>`;
}

// ------------------------------------------------------------------ course plan

function pagePlan() {
  const st = S.state;
  if (!st) return noCourse();
  const p = st.pacing || {};
  const risk = new Set(p.at_risk_ids || []);
  const nl = nextLesson();
  const fits = p.taught + p.slots_left;
  const examLine = `<div class="exam-line">Exam · ${esc(day(p.exam_date))}${p.shortfall ? ` · ${plural(p.shortfall, "lesson")} below this line won't fit` : ""}</div>`;
  const rows = [];
  let placed = false;
  st.lessons.forEach((l, i) => {
    if (!placed && p.shortfall && i >= fits) { rows.push(examLine); placed = true; }
    const taught = l.status === "Taught" || l.status === "Reviewed";
    const late = !taught && l.planned_date && p.today && l.planned_date < p.today;
    const fc = p.forecast && p.forecast[l.id];
    const when = taught ? (l.taught_on || l.planned_date) : (fc || l.planned_date);
    const moved = !taught && fc && l.planned_date && fc !== l.planned_date;
    const cls = [taught ? "taught" : l === nl ? "next" : "", late ? "late" : "", risk.has(l.id) ? "atrisk" : ""].join(" ");
    const tags = [
      taught ? pill("Taught", "green") : l === nl ? pill("Next", "amber") : "",
      risk.has(l.id) ? pill("Won't fit", "red") : "",
      l.has_plan ? pill(l.verdict === "Passed" ? "Plan checked" : l.verdict || "Draft", l.verdict === "Passed" ? "blue" : "amber") : "",
      l.clickup_task_id ? `<a href="${clickupUrl(l.clickup_task_id)}" target="_blank" rel="noopener" title="Open the ClickUp task">${CU_ICON}</a>` : "",
    ].join(" ");
    rows.push(`<div class="lesson-row ${cls}" data-act="lesson" data-id="${l.id}">
      <div class="date">${esc(day(when))}</div><div class="num">${l.seq}</div>
      <div><div class="title">${esc(l.title)}</div>${moved ? `<div class="sub">was planned for ${esc(day(l.planned_date))}</div>` : taught && l.taught_on && l.taught_on !== l.planned_date ? `<div class="sub">planned for ${esc(day(l.planned_date))}, taught ${esc(day(l.taught_on))}</div>` : ""}</div>
      <div class="row" style="justify-content:flex-end">${tags}</div></div>`);
  });
  if (!placed) rows.push(examLine);
  const docs = st.documents || [];
  return `<div class="split">
    <div class="card"><div class="card-head"><h2>Term plan</h2><span class="muted">${plural(st.lessons.length, "lesson")} · dates show the current forecast</span></div>
      ${st.lessons.length ? `<div class="timeline">${rows.join("")}</div>` : `<div class="empty">No lessons yet. Click Re-plan the term.</div>`}
      <p class="hint">When the class falls behind, the Principal re-plans: taught lessons stay where they were, and the rest move onto the slots that are left before the exam.</p>
    </div>
    <div class="stack">
      <div class="card">${pacingCard(p)}</div>
      <div class="card"><div class="card-head"><h2>Syllabus</h2><span class="muted">${plural(st.topics.length, "topic")}</span></div>
        ${st.topics.map((t) => `<div class="list-row"><span class="small muted" style="width:18px">${t.seq}</span><div class="grow"><b>${esc(t.title)}</b><div class="small muted">${t.minutes} min · ${esc(t.keywords || "")}</div></div></div>`).join("")}</div>
      <div class="card"><div class="card-head"><h2>Course material</h2><a class="small" href="#settings">Upload notes</a></div>
        ${docs.length ? docs.map((d) => `<div class="list-row"><div class="grow"><b>${esc(d.title)}</b><div class="small muted">${esc(d.kind || "")} · ${plural(d.passages, "passage")} indexed</div></div></div>`).join("") : `<div class="empty">No notes yet. Lessons can only cite what you upload.</div>`}</div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ lesson drawer

function openDrawer(html) {
  $("#drawerBody").innerHTML = html;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  S.drawer = null;
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  hidePopover();
}
function reloadDrawer() {
  if (!S.drawer) return;
  if (S.drawer.type === "lesson") openLesson(S.drawer.id, true);
  if (S.drawer.type === "learner") openLearner(S.drawer.id, true);
}

async function openLesson(id, quiet) {
  const keepJob = S.drawer && S.drawer.type === "lesson" && S.drawer.id === id ? S.drawer.job : null;
  S.drawer = { type: "lesson", id, job: keepJob };
  if (!quiet) openDrawer(`<div class="empty">Opening the lesson…</div>`);
  const l = await api(`/api/lessons/${id}`);
  if (!S.drawer || S.drawer.id !== id) return;
  S.ctx = l.passages || [];
  $("#drawerBody").innerHTML = lessonHtml(l);
}

function lessonHtml(l) {
  const plan = l.plan;
  const review = l.review || {};
  const items = {};
  (review.items || []).forEach((it) => { items[it.id] = it; });
  const stmt = (id, text) => {
    const it = items[id];
    const bad = it && it.verdict !== "Supported";
    return `<span class="stmt ${bad ? "bad" : ""}" ${bad ? `title="${esc(`${it.verdict}: ${it.reason}`)}"` : ""}>${cited(text)}</span>`;
  };
  const head = `<div class="doc"><div class="muted small">Lesson ${l.seq} · ${l.taught_on ? `taught ${esc(day(l.taught_on))}` : esc(day(l.planned_date))} · ${esc(l.topic || "")}</div>
    <h2>${esc(plan && plan.title ? plan.title : l.title)}</h2>
    <div class="row" style="margin:8px 0 4px">${pill(l.status, l.status === "Taught" ? "green" : "grey")}
      ${l.verdict ? pill(l.verdict === "Passed" ? "Examiner passed" : l.verdict, l.verdict === "Passed" ? "green" : "amber") : ""}
      ${plan ? pill(`${l.examiner_rounds || 0} send-back round${l.examiner_rounds === 1 ? "" : "s"}`, l.examiner_rounds ? "amber" : "grey") : ""}
      ${clickupLink(l.clickup_task_id)}
      <button class="btn sm" data-act="prepare" data-id="${l.id}">${plan ? "Rewrite with the staff" : "Prepare with the staff"}</button></div>`;
  const working = `<div class="mini-feed" id="drawerFeed">${S.drawer && S.drawer.job ? S.feed.filter((e) => e.job_id === S.drawer.job).map(evHtml).join("") : ""}</div>`;
  if (!plan) {
    return head + working + `<p class="muted" style="margin-top:16px">No plan yet. The Librarian will pull the passages for “${esc(l.topic || l.title)}” from the course notes,
      the Subject Teacher writes the plan citing them, and the Examiner checks every statement before it reaches you.</p></div>`;
  }
  const sec = (title, body) => (body ? `<h4>${title}</h4>${body}` : "");
  const list = (arr, prefix) => (arr && arr.length ? `<ul>${arr.map((t, i) => `<li>${stmt(prefix + (i + 1), t)}</li>`).join("")}</ul>` : "");
  const qs = (plan.check_questions || []).map((q, i) => `<li><b>${esc(q.q)}</b><div class="small">${stmt("q" + (i + 1), q.answer)}</div></li>`).join("");
  const reviewRows = (review.items || []).map((it) => `<tr>
      <td>${cited(it.text)}</td><td>${pill(it.verdict, VERDICT[it.verdict])}</td>
      <td><span class="gbar ${it.grounding < 0.45 ? "low" : it.grounding < 0.8 ? "mid" : ""}"><i style="width:${Math.round((it.grounding || 0) * 100)}%"></i></span> <span class="small muted">${pct(it.grounding)}</span></td>
      <td class="muted">${esc(it.reason || "")}</td></tr>`).join("");
  const p1 = (l.passages || [])[0];
  const trueSample = p1 ? stripCites(String(p1.text).split(/(?<=[.!?])\s+/)[0]) : "";
  const falseSample = /firewall/i.test(l.title) ? "Firewalls block all viruses" : `${l.topic || l.title} makes a network completely safe from every attack`;
  return head + working + `
    ${sec("Objectives", list(plan.objectives, "o"))}
    ${sec("Key ideas", list(plan.explanation, "e"))}
    ${sec("Worked example", plan.worked_example ? `<p>${stmt("x1", plan.worked_example)}</p>` : "")}
    ${sec("Class activity", plan.activity ? `<p>${cited(plan.activity)}</p>` : "")}
    ${sec("Check for understanding", qs ? `<ol>${qs}</ol>` : "")}
    ${sec("Gaps in the notes", plan.gaps && plan.gaps.length ? `<ul>${plan.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : "")}
    <h4>Examiner's marking</h4>
    <div class="banner ${review.verdict === "pass" ? "ok" : "bad"}" style="margin:0 0 10px">${esc(review.summary || "Not checked yet")}</div>
    <div class="card" style="padding:4px 8px"><table class="review-table"><tr><th>Statement</th><th>Verdict</th><th>Grounding</th><th>Why</th></tr>${reviewRows}</table></div>
    <p class="hint">Grounding is worked out in code: the share of a statement's key words found in the passage it cites. ${S.state && S.state.llm.online ? "The model gives its own verdict too, but a statement under 20% grounding is always marked Not in the material." : "With a model key, the model gives a verdict as well; low grounding always overrides it."}</p>
    <h4>Try to trick the Examiner</h4>
    <p class="hint" style="margin-top:0">Type any statement, true or false. The Examiner checks it against this lesson's passages the same way it checks the Subject Teacher's drafts.</p>
    <form class="claim-box" data-form="claim" data-id="${l.id}"><input name="text" placeholder="e.g. ${esc(falseSample)}" autocomplete="off" required><button class="btn primary">Check</button></form>
    <div class="row" style="margin-top:8px"><span class="hint">Try:</span>
      <button class="btn sm" data-act="claim-sample" data-text="${esc(falseSample)}">${esc(falseSample)}</button>
      ${trueSample ? `<button class="btn sm" data-act="claim-sample" data-text="${esc(trueSample)}" title="A sentence straight from the notes">A sentence from the notes</button>` : ""}</div>
    <div id="claimOut"></div>
    <h4>Sources</h4>
    <ul>${(l.passages || []).map((p) => `<li><span class="cite" data-n="${p.n}">P${p.n}</span> ${esc(p.where)}</li>`).join("")}</ul>
  </div>`;
}

function claimHtml(it) {
  const ok = it.verdict === "Supported";
  return `<div class="verdict ${ok ? "Supported" : "bad"}"><b>${esc(it.verdict)}</b> · grounding ${pct(it.grounding)} · checked against ${(it.cites || []).map((n) => `<span class="cite" data-n="${n}">P${n}</span>`).join(" ") || "nothing"}
    <div style="margin-top:4px">${esc(it.reason || "")}</div>
    ${ok ? "" : `<div class="small" style="margin-top:4px">In a lesson plan, this would go back to the Subject Teacher instead of reaching you.</div>`}</div>`;
}

// ------------------------------------------------------------------ class report

function pageClass() {
  const st = S.state;
  if (!st) return noCourse();
  const sessions = st.sessions.filter((s) => s.has_report);
  const sid = S.sessionId && sessions.some((s) => s.id === S.sessionId) ? S.sessionId : sessions[0] && sessions[0].id;
  const lessons = st.lessons;
  const nl = nextLesson();
  const opts = lessons.map((l) => `<option value="${l.id}" ${nl && l.id === nl.id ? "selected" : ""}>${l.seq}. ${esc(l.title)}${l.status === "Taught" ? " (taught)" : ""}</option>`).join("");
  const ig = st.integrations;
  return `
  ${sessions.length ? `<div class="tabs">${sessions.map((s) => `<button class="tab ${s.id === sid ? "on" : ""}" data-act="session" data-id="${s.id}">${esc(day(s.held_on))} · ${esc(s.lesson || "")}</button>`).join("")}</div>` : ""}
  <div id="sessionDetail">${sessions.length ? `<div class="card empty">Loading the class report…</div>` : `<div class="card"><h2>No class read yet</h2><p class="muted">Upload a transcript from Google Meet or Teams below, or pull it straight from Meet. The Class Observer counts who spoke, for how long and whether it was on topic, and the Counsellor follows up.</p></div>`}</div>
  <div class="grid g2 section-gap">
    <div class="card"><div class="card-head"><h2>Upload a class</h2><span class="muted">WebVTT transcript from Meet or Teams</span></div>
      <form class="form" data-form="class">
        <div class="field"><label>Transcript (.vtt or .txt)</label><input type="file" name="transcript" accept=".vtt,.txt,.srt,text/vtt,text/plain" required></div>
        <div class="field"><label>Attendance register (.csv, optional)</label><input type="file" name="attendance" accept=".csv,text/csv"></div>
        <div class="row"><div class="field" style="flex:2;min-width:200px"><label>Lesson</label><select name="lesson_id">${opts}</select></div>
          <div class="field" style="flex:1;min-width:140px"><label>Held on</label><input type="date" name="held_on"></div></div>
        <div class="row"><button class="btn primary">Read the class</button>${isDemo() ? `<span class="hint">For the demo, download the transcript and register with the buttons above.</span>` : ""}</div>
      </form></div>
    <div class="card"><div class="card-head"><h2>Pull from Google Meet</h2>${ig.meet ? pill("Connected", "green") : pill("Not connected", "grey")}</div>
      ${ig.meet ? `<form class="form" data-form="meet">
          <div class="field"><label>Meeting code</label><input name="meeting_code" placeholder="abc-mnop-xyz" value="${esc(st.course.meet_code || "")}" required></div>
          <div class="field"><label>Lesson</label><select name="lesson_id">${opts}</select></div>
          <button class="btn primary">Pull the latest class</button>
          <p class="hint">Uses the Meet REST API: the latest conference record for this code, its participant sessions for the register, and its transcript entries.</p></form>`
        : `<p class="muted">Add a Google access token in <a href="#settings">Settings</a> and Staffroom fetches the register and transcript of the last class straight from Meet. Transcripts must be switched on in the meeting.</p>`}
    </div>
  </div>`;
}

async function loadSession(id) {
  S.sessionId = id;
  const box = $("#sessionDetail");
  if (!box) return;
  const s = await api(`/api/sessions/${id}`);
  if (S.page !== "class" || S.sessionId !== id) return;
  S.session = s;
  $$(".tabs .tab").forEach((t) => t.classList.toggle("on", +t.dataset.id === id));
  const rep = s.report || { learners: [] };
  const mine = new Set();
  rep.learners.forEach((x) => (x.evidence || []).forEach((i) => mine.add(i)));
  const rows = rep.learners.map((x) => `<tr class="clickable" data-act="sel-learner" data-id="${x.learner_id}">
      <td><b>${esc(x.name)}</b><div class="small muted">${esc(x.why || "")}</div></td>
      <td>${pill(x.label, LABEL[x.label])}</td>
      <td><div class="score"><div class="bar"><i style="width:${Math.min(100, x.score)}%;background:${scoreColor(x.score)}"></i></div><b>${Math.round(x.score)}</b></div></td>
      <td>${Math.round(x.minutes)}</td><td>${x.turns}</td><td>${x.questions}</td><td>${x.on_topic}/${x.turns}</td></tr>`).join("");
  const mis = rep.misconceptions || [];
  const misLines = new Set(mis.map((m) => m.line));
  S.ctx = mis.filter((m) => m.source).map((m) => m.source);
  const lines = (s.entries || []).map((e, i) => {
    const idx = e.i ?? i;
    return `<div class="line ${mine.has(idx) ? "" : "teacher"} ${misLines.has(idx) ? "wrong" : ""}" data-i="${idx}"><span class="t">${mmss(e.start)}</span><div><span class="sp">${esc(e.speaker)}</span>${esc(e.text)}${misLines.has(idx) ? ` ${pill("not in the notes", "red")}` : ""}</div></div>`;
  }).join("");
  const misCard = `<div class="card section-gap"><div class="card-head"><h2>Things to revisit next lesson</h2><span class="muted">learner statements the Examiner checked against the notes</span></div>
    ${mis.length ? mis.map((m) => `<div class="misc"><b>${esc(m.name)}</b> at ${mmss(((s.entries || []).find((e) => e.i === m.line) || {}).start)}: “${esc(m.text)}”
        <div class="small" style="margin-top:3px">${pill(m.verdict, VERDICT[m.verdict])} ${esc(m.reason)}</div>
        ${m.source ? `<div class="small muted" style="margin-top:3px">What the notes say (<span class="cite" data-n="${m.source.n}">P${m.source.n}</span> ${esc(m.source.where)}): <span style="color:var(--ink)">${esc(m.notes_say || String(m.source.text).slice(0, 220))}</span></div>` : ""}</div>`).join("")
      : `<div class="empty">Everything learners said about the topic matches the notes.</div>`}
    <p class="hint">The Class Observer passes on-topic statements (not questions or chat) to the Examiner. A wrong idea becomes a reason to follow up, and a question in that learner's personal test.</p></div>`;
  box.innerHTML = `<div class="split even">
    <div class="card"><div class="card-head"><h2>${esc(s.lesson || "Class")}</h2><span class="muted">${esc(day(s.held_on))} · ${Math.round(rep.class_minutes || 0)} min · ${esc(s.source || "")}</span></div>
      <table class="report-table"><tr><th>Learner</th><th>Label</th><th>Score</th><th>Min</th><th>Turns</th><th>Qs</th><th>On topic</th></tr>${rows}</table>
      <p class="hint">Counted in code: minutes on the register, turns, questions and answers. Only “on topic” is a judgement, made by ${esc(rep.judge || "word overlap with the lesson's passages")}. Click a learner to see their lines.</p></div>
    <div class="card"><div class="card-head"><h2>Transcript</h2><span class="muted" id="trNote">${plural((s.entries || []).length, "line")}</span></div>
      <div class="transcript" id="transcript">${lines || `<div class="empty">No transcript lines.</div>`}</div></div>
  </div>${misCard}`;
}

function selectLearnerLines(lid) {
  const s = S.session;
  if (!s) return;
  const x = (s.report.learners || []).find((r) => r.learner_id === lid);
  if (!x) return;
  const ev = new Set(x.evidence || []);
  $$(".report-table tr").forEach((tr) => tr.classList.toggle("sel", +tr.dataset.id === lid));
  let first = null;
  $$("#transcript .line").forEach((ln) => {
    const hit = ev.has(+ln.dataset.i);
    ln.classList.toggle("hl", hit);
    ln.classList.toggle("dim", !hit && ev.size > 0);
    if (hit && !first) first = ln;
  });
  $("#trNote").textContent = ev.size ? `${plural(ev.size, "line")} from ${x.name}` : `${x.name} didn't speak in this class`;
  if (first) {
    const box = $("#transcript");
    box.scrollTop = first.offsetTop - box.offsetTop - 40;
  }
}

// ------------------------------------------------------------------ tests

function pickTest() {
  const tests = S.state ? S.state.tests : [];
  if (S.testId && tests.some((t) => t.id === S.testId)) return S.testId;
  const w = tests.find((t) => t.status === "Needs approval") || tests[0];
  return w ? w.id : null;
}

function pageTests() {
  const st = S.state;
  if (!st) return noCourse();
  const sel = pickTest();
  const taught = new Set(st.lessons.filter((l) => l.status === "Taught").map((l) => l.topic_id));
  const nl = nextLesson();
  if (nl) taught.add(nl.topic_id);
  const statusPill = (t) => pill(t.status, t.status === "Approved" ? "green" : t.status === "Rejected" ? "red" : "amber");
  return `<div class="split list">
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Personal tests</h2><span class="muted">${plural(st.tests.length, "test")}</span></div>
        ${st.tests.length ? st.tests.map((t) => `<div class="test-row ${t.id === sel ? "on" : ""}" data-act="test" data-id="${t.id}">${avatar("Subject Teacher", 30)}
          <div class="grow" style="min-width:0"><div class="top"><b class="ellipsis">${esc(t.name || t.title)}</b>${statusPill(t)}</div><div class="small muted ellipsis" title="${esc((t.targets || []).map((x) => x.topic).join(", "))}">${plural(t.questions, "question")} · ${esc((t.targets || []).map((x) => x.topic.split(":")[0]).join(", "))}</div></div></div>`).join("")
          : `<div class="empty">No tests yet. The Counsellor asks for one when a learner needs help, or make one below.</div>`}
      </div>
      <div class="card"><div class="card-head"><h2>Make a test</h2></div>
        <form class="form" data-form="test">
          <div class="field"><label>Learner</label><select name="learner_id">${st.learners.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Topics</label><div class="checks">${st.topics.map((t) => `<label><input type="checkbox" name="topic" value="${t.id}" ${taught.has(t.id) && t.id === (nl && nl.topic_id) ? "checked" : ""}>${t.seq}. ${esc(t.title)}</label>`).join("")}</div></div>
          <button class="btn primary">Draft the test</button>
          <p class="hint">Each topic is set one level above the learner's current mastery. The Examiner checks the memo answers against the notes.</p>
        </form></div>
    </div>
    <div id="testDetail">${sel ? `<div class="card empty">Loading the test…</div>` : `<div class="card"><h2>Tests wait here for you</h2><p class="muted">Every test the staff draft lands here first. Nothing goes to a learner until you approve it, here or by moving its task in ClickUp.</p></div>`}</div>
  </div>`;
}

async function loadTest(id) {
  S.testId = id;
  const t = await api(`/api/tests/${id}`);
  if (S.page !== "tests" || S.testId !== id) return;
  S.ctx = t.passages || [];
  $$(".test-row").forEach((r) => r.classList.toggle("on", +r.dataset.id === id));
  const items = {};
  ((t.review && t.review.items) || []).forEach((it) => { items[it.id] = it; });
  const qs = (t.questions || []).map((q, i) => {
    const it = items["t" + (i + 1)];
    return `<div class="q"><div class="qh"><b>Q${i + 1}</b>${q.from_class ? pill("From today's class", "violet") : ""}${pill(q.topic, "grey")}${levelBars(q.level)}<span class="small" style="color:var(--violet);font-weight:650">Level ${q.level} ${LEVELS[q.level] || ""}</span>
        <span class="small muted">${plural(q.marks || 1, "mark")}</span><span style="margin-left:auto">${it ? pill(it.verdict, VERDICT[it.verdict]) : ""}</span></div>
      <div>${esc(q.q)}</div><div class="memo"><b>Memo:</b> ${cited(q.answer)}</div></div>`;
  }).join("");
  const waiting = t.status === "Needs approval";
  $("#testDetail").innerHTML = `<div class="card">
    <div class="card-head"><div><h2 style="font-size:18px">${esc(t.title)}</h2><div class="small muted">Drafted by the Subject Teacher, checked by the Examiner${t.examiner_rounds ? ` after ${plural(t.examiner_rounds, "send-back round")}` : ""}</div></div>
      <div class="row">${pill(t.status, t.status === "Approved" ? "green" : t.status === "Rejected" ? "red" : "amber")}${pill(t.verdict === "Passed" ? "Examiner passed" : "Examiner flagged", t.verdict === "Passed" ? "green" : "amber")}</div></div>
    <div class="row" style="margin-bottom:12px">${(t.plan || []).map((x) => `<span class="chip">${esc(x.topic)} · mastery ${x.mastery} → <b style="color:var(--violet)">level ${x.level} ${LEVELS[x.level] || ""}</b></span>`).join("")}</div>
    ${qs || `<div class="empty">No questions.</div>`}
    <div class="row section-gap">${waiting ? `<button class="btn primary" data-act="approve" data-id="${t.id}">Approve and release</button><button class="btn danger" data-act="reject" data-id="${t.id}">Reject</button>` : `<span class="muted">${t.status === "Approved" ? "Released to the learner." : "Rejected. It won't be sent."}</span>`}
      ${clickupLink(t.clickup_task_id)}</div>
    <h4 class="muted small" style="margin:18px 0 6px;text-transform:uppercase;letter-spacing:.6px">Sources</h4>
    <div class="small">${(t.passages || []).map((p) => `<div><span class="cite" data-n="${p.n}">P${p.n}</span> ${esc(p.where)}</div>`).join("")}</div>
  </div>`;
}

// ------------------------------------------------------------------ learners

function pageLearners() {
  const st = S.state;
  if (!st) return noCourse();
  const flagged = new Set(st.flags.map((f) => f.learner_id));
  const taught = new Set(st.lessons.filter((l) => l.status === "Taught").map((l) => l.topic_id));
  const head = st.topics.map((t) => `<th class="topic" title="${esc(t.title)}" style="${taught.has(t.id) ? "" : "opacity:.55"}">${t.seq}. ${esc(t.title.length > 26 ? t.title.slice(0, 25) + "…" : t.title)}</th>`).join("");
  const rows = st.learners.map((l) => `<tr><td class="name" data-act="learner" data-id="${l.id}">${esc(l.name)}${flagged.has(l.id) ? ` <span class="dot red" style="display:inline-block;margin:0 0 1px 4px" title="Flagged"></span>` : ""}</td>
      ${st.topics.map((t) => { const v = (l.mastery || {})[t.id] || 0; return `<td class="cell l${v}" title="${esc(`${l.name}: ${t.title}: ${v ? `level ${v} ${LEVELS[v]}` : "no evidence yet"}`)}">${v || "·"}</td>`; }).join("")}
      <td style="padding-left:8px">${l.last_label ? pill(l.last_label, LABEL[l.last_label]) : ""}</td></tr>`).join("");
  const avg = st.topics.map((t) => {
    const vals = st.learners.map((l) => (l.mastery || {})[t.id]).filter(Boolean);
    const a = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
    return `<td class="cell l${Math.round(a)}" style="opacity:.8">${a ? a.toFixed(1) : "·"}</td>`;
  }).join("");
  const ig = st.integrations;
  return `<div class="card"><div class="card-head"><h2>Mastery by topic</h2><span class="muted">${plural(st.learners.length, "learner")} · click a name for details</span></div>
    ${st.learners.length ? `<div class="heat-wrap"><table class="heat"><thead><tr><th></th>${head}<th>Last class</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td class="name">Class average</td>${avg}<td></td></tr></tfoot></table></div>` : `<div class="empty">No learners yet. Add them below or import them from Moodle.</div>`}
    <div class="heat-foot"><div class="legend">${[1, 2, 3, 4, 5].map((i) => `<span><i class="l${i}"></i>${i} ${LEVELS[i]}</span>`).join("")}<span><i class="l0"></i>no evidence</span></div>
      <p class="hint">From quiz marks and class participation, kept by the Counsellor. Faded topics aren't taught yet. Tests aim one level above mastery.</p></div>
  </div>
  <div class="grid g2 section-gap">
    <div class="card"><div class="card-head"><h2>Add a learner</h2></div>
      <form class="form" data-form="learner"><div class="row"><div class="field" style="flex:1"><label>Name</label><input name="name" required></div>
        <div class="field" style="flex:1"><label>Email (optional)</label><input name="email" type="email"></div></div>
        <button class="btn">Add learner</button></form></div>
    <div class="card"><div class="card-head"><h2>Import from Moodle</h2>${ig.moodle ? pill("Connected", "green") : pill("Not connected", "grey")}</div>
      ${ig.moodle ? `<form class="form" data-form="moodle"><div class="field"><label>Moodle course id</label><input name="moodle_course_id" type="number" min="1" required></div>
          <button class="btn">Import enrolled learners</button><p class="hint">Calls core_enrol_get_enrolled_users and adds anyone not already on the roster.</p></form>`
        : `<p class="muted">Add your Moodle site and a web service token in <a href="#settings">Settings</a> to import the class list.</p>`}</div>
  </div>`;
}

async function openLearner(id, quiet) {
  S.drawer = { type: "learner", id };
  if (!quiet) openDrawer(`<div class="empty">Opening…</div>`);
  const l = await api(`/api/learners/${id}`);
  if (!S.drawer || S.drawer.id !== id) return;
  const weak = (l.mastery || []).filter((m) => m.level <= 2).slice(0, 3);
  $("#drawerBody").innerHTML = `<div class="doc">
    <div class="muted small">Learner</div><h2>${esc(l.name)}</h2>${l.email ? `<div class="muted">${esc(l.email)}</div>` : ""}
    <h4>Mastery</h4>
    ${(l.mastery || []).length ? `<div class="card" style="padding:4px 12px">${l.mastery.map((m) => `<div class="list-row"><span class="small muted" style="width:18px">${m.seq}</span><div class="grow"><b>${esc(m.title)}</b><div class="small muted">${esc(m.basis || "")}</div></div>${levelBars(m.level)}<span class="small" style="width:70px">${m.level} ${LEVELS[m.level] || ""}</span></div>`).join("")}</div>` : `<div class="empty">No evidence yet.</div>`}
    <h4>Classes</h4>
    ${(l.participation || []).length ? `<div class="card" style="padding:4px 12px">${l.participation.map((p) => `<div class="list-row"><div class="grow"><b>${esc(p.lesson || "Class")}</b><div class="small muted">${esc(day(p.held_on))} · ${Math.round(p.minutes)} min · ${p.turns} turns · ${p.on_topic} on topic</div></div>${pill(p.label, LABEL[p.label])}<b style="width:28px;text-align:right">${Math.round(p.score)}</b></div>`).join("")}</div>` : `<div class="empty">No classes read yet.</div>`}
    <h4>Follow-ups</h4>
    ${(l.flags || []).length ? l.flags.map((f) => `<div class="list-row"><span class="dot ${f.status === "Open" ? "amber" : "grey"}"></span><div class="grow">${esc(f.reason)}<div class="small muted">${esc(f.status)} · ${esc(day(f.created_at))}</div></div>${f.clickup_task_id ? clickupLink(f.clickup_task_id, "Task") : ""}</div>`).join("") : `<div class="empty">None.</div>`}
    <h4>Tests</h4>
    ${(l.tests || []).length ? l.tests.map((t) => `<div class="list-row clickable" data-act="goto" data-href="#tests/${t.id}"><div class="grow"><b>${esc(t.title)}</b></div>${pill(t.status, t.status === "Approved" ? "green" : t.status === "Rejected" ? "red" : "amber")}</div>`).join("") : `<div class="empty">None yet.</div>`}
    ${weak.length ? `<div class="row section-gap"><button class="btn primary" data-act="test-for" data-id="${l.id}" data-topics="${weak.map((m) => m.topic_id).join(",")}">Draft a test on ${esc(weak.map((m) => m.title.split(":")[0]).join(", "))}</button></div>` : ""}
  </div>`;
}

// ------------------------------------------------------------------ settings

async function pageSettings() {
  const st = S.state;
  const v = await api("/api/settings");
  const f = (key, label, type = "text", ph = "", hint = "") => `<div class="field"><label for="f-${key}">${label}</label>
    <div class="row" style="flex-wrap:nowrap"><input id="f-${key}" name="${key}" type="${type}" value="${esc(v[key] || "")}" placeholder="${esc(ph)}" autocomplete="off">
    ${type === "password" && v[key] ? `<button type="button" class="btn sm ghost" data-act="clear" data-key="${key}">Remove</button>` : ""}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  const llm = (st && st.llm) || (S.health && S.health.llm) || {};
  const ig = (st && st.integrations) || {};
  const lists = (st && st.course.clickup_lists) || {};
  const opts = st ? st.lessons.map((l) => `<option value="${l.id}" ${nextLesson() && l.id === nextLesson().id ? "selected" : ""}>${l.seq}. ${esc(l.title)}</option>`).join("") : "";
  return `<div class="grid g2">
    <div class="card"><div class="card-head"><h2>Model</h2>${llm.online ? pill("Online", "green") : pill("Offline mode", "amber")}</div>
      <form class="form" data-form="settings">
        ${f("nebius_base_url", "Base URL (any OpenAI-compatible endpoint)", "text", "https://api.tokenfactory.nebius.com/v1/")}
        ${f("nebius_model", "Model", "text", "nvidia/Llama-3_3-Nemotron-Super-49B-v1_5")}
        ${f("nebius_api_key", "API key", "password", "Paste a Nebius Token Factory key")}
        <div class="row"><button class="btn primary">Save</button><span class="hint">${llm.online ? `Using ${esc(llm.label)}` : "Without a key, the staff draft straight from your notes and check with rules in code, so nothing breaks offline."}</span></div>
      </form></div>

    <div class="card"><div class="card-head"><h2>ClickUp</h2>${ig.clickup_course ? pill("Course synced", "green") : ig.clickup ? pill("Token saved", "blue") : pill("Not connected", "grey")}</div>
      <form class="form" data-form="settings">
        ${f("clickup_token", "Personal API token", "password", "pk_…", "ClickUp → Settings → Apps → API token.")}
        <div class="field"><label for="f-clickup_team_id">Workspace</label><div class="row" style="flex-wrap:nowrap">
          <input id="f-clickup_team_id" name="clickup_team_id" value="${esc(v.clickup_team_id || "")}" placeholder="Workspace id">
          <button type="button" class="btn sm" data-act="cu-teams" ${ig.clickup ? "" : "disabled"}>Find</button></div><div id="cuTeams"></div></div>
        <div class="row"><button class="btn primary">Save</button>
          ${st ? `<button type="button" class="btn" data-act="cu-setup" ${ig.clickup ? "" : "disabled"}>Set up this course</button>
          <button type="button" class="btn" data-act="cu-sync" ${ig.clickup_course ? "" : "disabled"}>Check for approvals</button>` : ""}</div>
        ${Object.keys(lists).length ? `<div class="kv small">${Object.entries(lists).map(([k, id]) => `<b>${esc({ lessons: "Lesson plan", followups: "Learner follow-ups", tests: "Tests: needs approval" }[k] || k)}</b><span class="mono">list ${esc(id)}</span>`).join("")}</div>` : ""}
        <p class="hint">Set up creates a Space for the course with three lists. Lesson plans, follow-ups and tests become tasks, and moving a test task to a closed status approves it.</p>
      </form></div>

    <div class="card"><div class="card-head"><h2>Google Meet</h2>${ig.meet ? pill("Connected", "green") : pill("Not connected", "grey")}</div>
      <form class="form" data-form="settings">
        ${f("google_access_token", "OAuth access token", "password", "ya29.…", "Scopes: meetings.space.readonly. For a test, get one from the Google OAuth Playground with your Workspace account.")}
        <button class="btn primary">Save</button></form>
      ${ig.meet && st ? `<p class="hint">Pull a class from <a href="#class">Class report</a>.</p>` : ""}</div>

    <div class="card"><div class="card-head"><h2>LMS (Moodle)</h2>${ig.moodle ? pill("Connected", "green") : pill("Not connected", "grey")}</div>
      <form class="form" data-form="settings">
        ${f("moodle_url", "Site", "url", "https://exams.yourschool.com")}
        ${f("moodle_token", "Web service token", "password", "", "Site administration → Server → Web services → Manage tokens.")}
        <button class="btn primary">Save</button></form>
      ${ig.moodle && st ? `<p class="hint">Import the class list from <a href="#learners">Learners</a>.</p>` : ""}</div>

    <div class="card"><div class="card-head"><h2>Course material</h2><span class="muted">${st ? esc(st.course.title) : "No course"}</span></div>
      ${st ? `<form class="form" data-form="notes"><div class="drop"><input type="file" name="file" accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf" required>
          <div class="hint" style="margin-top:6px">Markdown, text or PDF. The Librarian splits it into numbered passages by chapter, section and page.</div></div>
          <button class="btn primary">Upload notes</button></form>
        ${(st.documents || []).map((d) => `<div class="list-row"><div class="grow"><b>${esc(d.title)}</b><div class="small muted">${plural(d.passages, "passage")}</div></div></div>`).join("")}` : `<p class="muted">Create a course first.</p>`}</div>

    <div class="card"><div class="card-head"><h2>Dates and demo</h2></div>
      <form class="form" data-form="settings">
        ${f("as_of_date", "Treat this date as today (leave empty for the real date)", "date")}
        <button class="btn primary">Save</button></form>
      <div class="row section-gap"><button class="btn" data-act="demo-reset">Reset the demo course</button>
        ${st && !isDemo() ? `<button class="btn danger" data-act="delete-course">Delete this course</button>` : ""}</div>
      <p class="hint">Reset only rebuilds the demo course. Your own courses are left alone.</p></div>
  </div>

  <div class="card section-gap" id="new"><div class="card-head"><h2>New course</h2><span class="muted">the Principal plans the term from this</span></div>
    <form class="form" data-form="course">
      <div class="row"><div class="field" style="flex:2;min-width:220px"><label>Course title</label><input name="title" required placeholder="Ethical Hacking 101"></div>
        <div class="field" style="flex:1;min-width:160px"><label>Teacher</label><input name="teacher" placeholder="Ms Dube"></div>
        <div class="field" style="flex:1;min-width:160px"><label>Subject</label><input name="subject" placeholder="Cyber security"></div></div>
      <div class="row"><div class="field"><label>Term starts</label><input type="date" name="term_start" required></div>
        <div class="field"><label>Exam date</label><input type="date" name="exam_date" required></div>
        <div class="field"><label>Lesson length (min)</label><input type="number" name="slot_minutes" value="45" min="15" max="240"></div>
        <div class="field"><label>Class days</label><div class="checks">${DAYS.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${[0, 2, 4].includes(i) ? "checked" : ""}>${d}</label>`).join("")}</div></div></div>
      <div class="field"><label>Syllabus, one topic per line</label><textarea name="syllabus" required placeholder="1. Introduction to ethical hacking (45 min) | keywords: ethics, scope, authorisation&#10;2. Reconnaissance (90 min) | keywords: OSINT, footprinting, whois"></textarea>
        <div class="hint">Format: <span class="mono">1. Title (45 min) | keywords: a, b</span>. ${llm.online ? "Other formats work too: the model reads them." : "With a model key, any format works."}</div></div>
      <button class="btn primary">Create and plan the term</button>
    </form></div>`;
}

// ------------------------------------------------------------------ actions

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

const ACTIONS = {
  async demo() {
    S.feed = []; S.queue = []; S.agents = {};
    const had = S.courses.some((c) => c.title === DEMO_TITLE);
    const r = await post(`/api/demo/seed?reset=${had ? "true" : "false"}`);
    S.cid = r.course_id;
    await loadCourses();
    await loadState();
    go("#staffroom");
    await post(`/api/demo/run/${S.cid}`);
    const nl = nextLesson();
    toast(`Demo started: the staff are preparing “${esc(nl ? nl.title : "today's lesson")}”, then reading the recorded class.`, "ok", 6000);
  },
  async "demo-reset"() {
    S.feed = []; S.queue = []; S.agents = {};
    const r = await post("/api/demo/seed?reset=true");
    S.cid = r.course_id;
    await loadCourses(); await loadState();
    toast("Demo course rebuilt.", "ok");
    go("#home");
  },
  async "delete-course"(_, el) {
    if (!el.dataset.sure) { el.dataset.sure = "1"; el.textContent = "Click again to delete"; setTimeout(() => { if (el.isConnected) { delete el.dataset.sure; el.textContent = "Delete this course"; } }, 4000); return; }
    await api(`/api/courses/${S.cid}`, { method: "DELETE" });
    S.cid = null;
    await loadCourses(); await loadState();
    toast("Course deleted.");
    go("#home");
  },
  async prepare(id) {
    const r = await post(`/api/lessons/${id}/prepare`);
    if (S.drawer && S.drawer.type === "lesson" && S.drawer.id === +id) {
      S.drawer.job = r.job_id;
      const mf = $("#drawerFeed");
      if (mf) mf.innerHTML = "";
      toast("The staff are on it. Watch them below.");
    } else if (S.page !== "staffroom") {
      go("#staffroom");
    }
  },
  lesson(id) { return openLesson(+id); },
  learner(id) { return openLearner(+id); },
  goto(_, el) { go(el.dataset.href); },
  session(id) { return loadSession(+id); },
  test(id) { history.replaceState(null, "", `#tests/${id}`); return loadTest(+id); },
  "sel-learner"(id) { selectLearnerLines(+id); },
  skip() { while (S.queue.length) show(S.queue.shift()); feedNote(); },
  async replan() {
    await post(`/api/courses/${S.cid}/plan`);
    toast("The Principal is re-planning the rest of the term.");
  },
  async approve(id) {
    await post(`/api/tests/${id}/approve`);
    toast("Approved and released to the learner.", "ok");
    await loadState(); renderChrome(); loadTest(+id);
    $$(".test-row").forEach((r) => { if (+r.dataset.id === +id) r.querySelector(".top .pill").outerHTML = pill("Approved", "green"); });
  },
  async reject(id) {
    await post(`/api/tests/${id}/reject`);
    toast("Rejected. It won't be sent.");
    await loadState(); renderChrome(); loadTest(+id);
    $$(".test-row").forEach((r) => { if (+r.dataset.id === +id) r.querySelector(".top .pill").outerHTML = pill("Rejected", "red"); });
  },
  async "flag-done"(id) {
    await post(`/api/flags/${id}/done`);
    await loadState(); renderChrome(); renderPage();
  },
  async "test-for"(id, el) {
    await post(`/api/courses/${S.cid}/tests`, { learner_id: +id, topic_ids: el.dataset.topics.split(",").map(Number) });
    toast("The Subject Teacher is drafting the test. It will wait for your approval.");
    closeDrawer();
  },
  "claim-sample"(_, el) {
    const form = $('form[data-form="claim"]');
    form.text.value = el.dataset.text;
    form.requestSubmit();
  },
  async clear(_, el) {
    await post(`/api/settings/clear/${el.dataset.key}`);
    toast("Removed.");
    await afterSettings();
  },
  async "cu-teams"() {
    const teams = await api("/api/clickup/teams");
    $("#cuTeams").innerHTML = teams.length ? `<div class="row" style="margin-top:6px">${teams.map((t) => `<button type="button" class="btn sm" data-act="cu-pick" data-id="${esc(t.id)}">${esc(t.name || t.id)}</button>`).join("")}</div>` : `<div class="hint">No workspaces found for this token.</div>`;
  },
  "cu-pick"(id) { $("#f-clickup_team_id").value = id; },
  async "cu-setup"() {
    await post(`/api/courses/${S.cid}/clickup/setup`);
    toast("ClickUp Space ready: Lesson plan, Learner follow-ups and Tests: needs approval.", "ok", 6000);
    await afterSettings();
  },
  async "cu-sync"() {
    await post(`/api/courses/${S.cid}/clickup/sync`);
    toast("Checking ClickUp for approved tests…");
  },
};

const FORMS = {
  async claim(form) {
    const out = $("#claimOut");
    out.innerHTML = `<div class="verdict" style="background:#fff;border:1px solid var(--line)"><span class="typing"><i></i><i></i><i></i></span> The Examiner is checking…</div>`;
    const it = await post(`/api/lessons/${form.dataset.id}/check`, { text: form.text.value });
    out.innerHTML = claimHtml(it);
  },
  async settings(form) {
    const values = {};
    $$("input[name], select[name]", form).forEach((i) => { values[i.name] = i.value; });
    await post("/api/settings", values);
    toast("Saved.", "ok");
    await afterSettings();
  },
  async notes(form) {
    const fd = new FormData(form);
    const r = await api(`/api/courses/${S.cid}/documents`, { method: "POST", body: fd });
    toast(`The Librarian indexed ${plural(r.passages, "passage")}.`, "ok");
    await afterSettings();
  },
  async course(form) {
    const fd = new FormData(form);
    const days = fd.getAll("day");
    fd.delete("day");
    fd.set("slot_days", days.join(","));
    const r = await api("/api/courses", { method: "POST", body: fd });
    S.cid = r.course_id;
    await post(`/api/courses/${S.cid}/plan`);
    await loadCourses(); await loadState();
    toast(`Course created with ${plural(r.topics, "topic")}. The Principal is planning the term. Next, upload your notes.`, "ok", 7000);
    go("#plan");
  },
  async class(form) {
    const fd = new FormData(form);
    const att = fd.get("attendance");
    if (!att || !att.size) fd.delete("attendance");
    if (!fd.get("held_on")) fd.delete("held_on");
    if (!fd.get("lesson_id")) fd.delete("lesson_id");
    const r = await api(`/api/courses/${S.cid}/sessions`, { method: "POST", body: fd });
    S.sessionId = r.session_id;
    toast("The Class Observer is reading the class. The report appears here when the staff finish.", "", 6000);
    form.reset();
  },
  async meet(form) {
    const r = await post(`/api/courses/${S.cid}/sessions/meet`, { meeting_code: form.meeting_code.value, lesson_id: +form.lesson_id.value || null });
    S.sessionId = r.session_id;
    toast("Pulled the class from Meet. The Class Observer is reading it.", "ok");
  },
  async test(form) {
    const topics = $$('input[name="topic"]:checked', form).map((i) => +i.value);
    if (!topics.length) throw new Error("Pick at least one topic");
    await post(`/api/courses/${S.cid}/tests`, { learner_id: +form.learner_id.value, topic_ids: topics });
    toast("The Subject Teacher is drafting the test. The Examiner checks it next.");
  },
  async learner(form) {
    await api(`/api/courses/${S.cid}/learners`, { method: "POST", body: new FormData(form) });
    toast(`${esc(form.name.value)} added.`, "ok");
    await loadState(); renderPage();
  },
  async moodle(form) {
    const r = await post(`/api/courses/${S.cid}/moodle/import`, { moodle_course_id: +form.moodle_course_id.value });
    toast(`Moodle: found ${r.found}, added ${r.added}.`, "ok");
    await loadState(); renderPage();
  },
};

async function afterSettings() {
  S.health = await api("/api/health");
  await loadState();
  renderChrome();
  if (S.page === "settings") renderPage();
}

// ------------------------------------------------------------------ popover

function showCite(el) {
  const n = +el.dataset.n;
  const p = (S.ctx || []).find((x) => +x.n === n);
  const pop = $("#popover");
  pop.innerHTML = p ? `<div class="where">P${n} · ${esc(p.where)}</div><div>${esc(p.text)}</div>`
    : `<div class="where">P${n}</div><div class="muted">This number isn't one of the passages the Librarian supplied, so the Examiner counts it as a bad citation.</div>`;
  pop.hidden = false;
  const r = el.getBoundingClientRect();
  const w = Math.min(420, innerWidth - 24);
  pop.style.maxWidth = w + "px";
  pop.style.left = Math.min(Math.max(12, r.left - 20), innerWidth - w - 12) + "px";
  pop.style.top = r.bottom + 8 + "px";
  const ph = pop.offsetHeight;
  if (r.bottom + 8 + ph > innerHeight - 12) pop.style.top = Math.max(12, r.top - ph - 8) + "px";
}
function hidePopover() { const p = $("#popover"); if (p) p.hidden = true; }

// ------------------------------------------------------------------ wiring

document.addEventListener("click", async (e) => {
  const cite = e.target.closest(".cite");
  if (cite) { e.preventDefault(); e.stopPropagation(); showCite(cite); return; }
  if (!e.target.closest("#popover")) hidePopover();
  if (e.target.id === "drawer" || e.target.closest("#drawerClose")) { closeDrawer(); return; }
  const el = e.target.closest("[data-act]");
  if (!el || e.target.closest("a[href]:not([data-act])")) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  const btn = el.tagName === "BUTTON" ? el : null;
  if (btn) btn.disabled = true;
  try { await fn(el.dataset.id, el, e); } catch (err) { toast(esc(err.message), "bad", 7000); } finally { if (btn && btn.isConnected) btn.disabled = false; }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const fn = FORMS[form.dataset.form];
  if (!fn) return;
  const btn = form.querySelector("button:not([type=button])");
  if (btn) btn.disabled = true;
  try { await fn(form); } catch (err) { toast(esc(err.message), "bad", 7000); } finally { if (btn && btn.isConnected) btn.disabled = false; }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "speed") { S.speed = e.target.value; store("speed", S.speed); }
  if (e.target.id === "courseSelect") {
    S.cid = +e.target.value || null;
    loadState().then(() => { renderChrome(); renderPage(); });
  }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hidePopover(); closeDrawer(); } });
window.addEventListener("hashchange", route);
window.addEventListener("scroll", hidePopover, true);

async function boot() {
  try {
    S.health = await api("/api/health");
    await loadCourses();
    await loadState();
    (await api("/api/events?limit=150")).forEach((ev) => show(ev, false));
  } catch (e) {
    toast(`Couldn't reach the Staffroom server: ${esc(e.message)}`, "bad", 9000);
  }
  route();
  connect();
  pump();
  setInterval(liveDot, 1000);
}

boot();
