/* Demo LMS: a sample host school. Courses, weekly modules, assignments, quizzes and a gradebook.
   Fast Track is an external tool here: a course tab, a launch card, and gradebook columns that
   read its real scores from /api/ft/{course}/board. Everything else is placeholder data. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const IC = {
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h4"/></svg>`,
  quiz: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01"/></svg>`,
  task: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l1 2h3v16H5V5h3z"/><path d="m9 13 2 2 4-4"/></svg>`,
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`,
  out: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>`,
};

const COURSES = [
  { id: "cyber", code: "CYB-501", title: "Cyber Security Learnership", teacher: "Facilitator", b: "linear-gradient(135deg,#7a2e6e,#3b2a6b)", progress: 0.12, ft: true },
  { id: "dev", code: "SWD-502", title: "Software Development", teacher: "T. Mokoena", b: "linear-gradient(135deg,#1e3a6b,#2f6b8f)", progress: 0.46 },
  { id: "data", code: "DAT-410", title: "Data Analytics", teacher: "R. Naidoo", b: "linear-gradient(135deg,#25603f,#3f8f6a)", progress: 0.58 },
  { id: "net", code: "NET-305", title: "Network Engineering", teacher: "S. Dlamini", b: "linear-gradient(135deg,#8a4b12,#b8792b)", progress: 0.31 },
  { id: "cloud", code: "CLD-201", title: "Cloud Fundamentals", teacher: "L. Botha", b: "linear-gradient(135deg,#334155,#64748b)", progress: 0.67 },
  { id: "ux", code: "UXD-110", title: "UX Design", teacher: "K. Pillay", b: "linear-gradient(135deg,#6b2142,#a33a63)", progress: 0.22 },
];
const DUE = [
  { d: 18, m: "Nov", t: "Assignment 2: Security policy brief", c: "CYB-501", s: "warn", st: "Due soon" },
  { d: 20, m: "Nov", t: "Quiz 3: Identity theft", c: "CYB-501", s: "plum", st: "Quiz" },
  { d: 24, m: "Nov", t: "Project milestone 1", c: "SWD-502", s: "grey", st: "Upcoming" },
  { d: 28, m: "Nov", t: "Practical: VLAN set-up", c: "NET-305", s: "grey", st: "Upcoming" },
];

const S = { ftCourse: null, board: null, topics: [] };

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}
async function ft() {
  if (S.board) return S.board;
  const courses = await api("/api/ft/courses");
  const c = courses.find((x) => /melsoft/i.test(x.title)) || courses[0];
  if (!c) return null;
  S.ftCourse = c;
  S.board = await api(`/api/ft/${c.id}/board`);
  S.topics = S.board.topics;
  return S.board;
}
const ftLink = (role) => `/fast-track?role=${role}`;
const modOf = (t) => (/^(KM-\d+)/.exec(t) || [])[1] || "Other";
// Stable placeholder marks per learner and item.
const mark = (name, k, lo = 48, hi = 92) => { let h = 7; for (const ch of name + k) h = (h * 31 + ch.charCodeAt(0)) % 9973; return lo + (h % (hi - lo)); };

function nav(which) { document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.nav === which)); }

function route() {
  const [p, id, tab] = (location.hash.replace(/^#\/?/, "") || "").split("/");
  window.scrollTo({ top: 0 });
  if (p === "course") return pageCourse(id, tab || "modules");
  if (p === "grades") return pageCourse("cyber", "grades");
  return pageHome();
}

function pageHome() {
  nav("home");
  $("#app").innerHTML = `<section class="hello"><h1>Good afternoon.</h1><p>You have 2 items due this week and 1 quiz to mark.</p></section>
    <div class="cols">
      <section><div class="row between"><h2 class="h2">My courses</h2><a class="small" href="#/courses">View all</a></div>
        <div class="courses">${COURSES.map((c) => `<a class="card course" href="#/course/${c.id}">
          <div class="banner" style="--b:${c.b}"><span class="code">${esc(c.code)}</span></div>
          <div class="body"><h3>${esc(c.title)}</h3><div class="t">${esc(c.teacher)}${c.ft ? ` · <span class="pill plum" style="padding:0 7px">Fast Track</span>` : ""}</div>
            <div class="prog"><i style="width:${Math.round(c.progress * 100)}%"></i></div>
            <div class="meta"><span>${Math.round(c.progress * 100)}% complete</span><span>Term 4</span></div></div></a>`).join("")}</div></section>
      <aside class="grid">
        <div class="card pad"><h2 class="h2">Coming up</h2><div class="list" style="margin-top:12px">${DUE.map((d) => `<div><span class="date"><b>${d.d}</b><span>${d.m}</span></span>
          <div class="grow"><b>${esc(d.t)}</b><div class="small mute">${esc(d.c)}</div></div><span class="pill ${d.s}">${esc(d.st)}</span></div>`).join("")}</div></div>
        <div class="card pad"><div class="row"><span class="ic plum">${IC.bolt}</span><div><b>Fast Track</b><div class="small mute">External tool · Cyber Security Learnership</div></div></div>
          <p class="small" style="color:var(--ink-2);margin:12px 0 14px">Chapter ladders built from your course notes. Scores flow back into the gradebook.</p>
          <a class="btn primary" href="#/course/cyber/fasttrack">Open in course</a></div>
      </aside>
    </div>`;
}

const TABS = [["modules", "Modules"], ["assignments", "Assignments"], ["quizzes", "Quizzes"], ["grades", "Gradebook"], ["fasttrack", "Fast Track"]];

async function pageCourse(id, tab) {
  nav(tab === "grades" ? "grades" : "courses");
  const c = COURSES.find((x) => x.id === id) || COURSES[0];
  const head = `<div class="crumbs"><a href="#/">Dashboard</a> / ${esc(c.code)}</div>
    <div class="card chead"><div class="banner" style="--b:${c.b}"><span class="code">${esc(c.code)}</span></div>
      <div class="in"><div><h1>${esc(c.title)}</h1><div class="mute small">${esc(c.teacher)} · Term 4 · ${c.ft ? "28" : "24"} learners</div></div>
        <span class="pill ${c.progress > .4 ? "ok" : "warn"}">${c.progress > .4 ? "On schedule" : "Behind schedule"}</span></div>
      <nav class="ctabs">${TABS.filter(([k]) => c.ft || k !== "fasttrack").map(([k, n]) => `<a class="${k === tab ? "on" : ""}" href="#/course/${c.id}/${k}">${n}${k === "fasttrack" ? ` <span class="ext">External tool</span>` : ""}</a>`).join("")}</nav></div>`;
  $("#app").innerHTML = head + `<div class="section" id="tab"><div class="mute">Loading…</div></div>`;
  const body = $("#tab");
  try {
    if (tab === "fasttrack") body.innerHTML = await tabFastTrack();
    else if (tab === "grades") body.innerHTML = await tabGrades(c);
    else if (tab === "assignments") body.innerHTML = tabAssignments();
    else if (tab === "quizzes") body.innerHTML = tabQuizzes();
    else body.innerHTML = await tabModules(c);
  } catch (e) { body.innerHTML = `<div class="card pad">Couldn't load this tab: ${esc(e.message)}</div>`; }
}

async function tabModules(c) {
  let weeks;
  if (c.ft) {
    await ft();
    const mods = [...new Set(S.topics.map((t) => modOf(t.title)))];
    weeks = mods.map((m, i) => ({ title: `Week ${i + 1}: ${m}`, items: S.topics.filter((t) => modOf(t.title) === m).slice(0, 4).map((t) => t.title.replace(/^KM-\d+\s+/, "")) }));
  } else {
    weeks = [1, 2, 3, 4].map((w) => ({ title: `Week ${w}`, items: ["Reading pack", "Recorded class", "Practice task"] }));
  }
  return weeks.map((w, i) => `<details class="card week section" ${i < 2 ? "open" : ""}><summary><b>${esc(w.title)}</b><span class="pill ${i === 0 ? "ok" : i === 1 ? "warn" : "grey"}">${i === 0 ? "Complete" : i === 1 ? "In progress" : "Not started"}</span></summary>
    <div class="items">${w.items.map((t, k) => `<div class="it"><span class="ic">${k % 3 === 1 ? IC.video : IC.file}</span><div>${esc(t)}<div class="small mute">${k % 3 === 1 ? "Recorded class · 45 min" : "Notes"}</div></div><span class="small mute">${i === 0 ? "Viewed" : ""}</span></div>`).join("")}
      ${c.ft ? `<div class="it"><span class="ic plum">${IC.bolt}</span><div><b>Fast Track ladder</b><div class="small mute">External tool · graded</div></div><a class="btn" href="${ftLink("student")}" target="_blank" rel="noopener">Launch ${IC.out}</a></div>` : ""}
    </div></details>`).join("");
}

function tabAssignments() {
  const a = [["Assignment 1: Governance and legislation", "Graded", "ok", "12 Oct"], ["Assignment 2: Security policy brief", "Due 18 Nov", "warn", "18 Nov"], ["Assignment 3: Incident report", "Opens 25 Nov", "grey", "2 Dec"]];
  return `<div class="card pad"><div class="items" style="padding:0">${a.map(([t, s, k, d]) => `<div class="it"><span class="ic">${IC.task}</span><div><b>${t}</b><div class="small mute">Due ${d} · submitted online</div></div><span class="pill ${k}">${s}</span></div>`).join("")}</div></div>`;
}
function tabQuizzes() {
  const q = [["Quiz 1: Computer and mobile security", "Closed · avg 71%", "ok"], ["Quiz 2: Viruses and spyware", "Closed · avg 64%", "ok"], ["Quiz 3: Identity theft", "Opens 20 Nov", "plum"]];
  return `<div class="card pad"><div class="items" style="padding:0">${q.map(([t, s, k]) => `<div class="it"><span class="ic">${IC.quiz}</span><div><b>${t}</b><div class="small mute">20 questions · 30 minutes</div></div><span class="pill ${k}">${s}</span></div>`).join("")}</div></div>`;
}

async function tabGrades(c) {
  if (!c.ft) return `<div class="card pad mute">The gradebook for this sample course is empty.</div>`;
  const b = await ft();
  const show = S.topics.slice(0, 3);
  const rows = b.learners.map((l) => {
    const name = l.name.replace(" (sample)", "");
    const cells = show.map((t) => { const ch = l.chapters[t.id] || {}; const top = ch.top || 0;
      return `<td class="ft n"><span class="lvl">${Array.from({ length: 10 }, (_, i) => `<i class="${i < top ? "on" : ""}"></i>`).join("")}</span>${top}/10</td>`; }).join("");
    const acc = l.answered ? Math.round((100 * l.correct) / l.answered) + "%" : "–";
    return `<tr><td><b>${esc(name)}</b>${l.sample ? ` <span class="pill grey" style="padding:0 6px">sample</span>` : ""}</td><td class="n">${mark(name, "a1")}%</td><td class="n">${mark(name, "q1")}%</td><td class="n">${mark(name, "q2", 40, 90)}%</td>${cells}<td class="ft n">${acc}</td><td class="ft n">${l.xp.toLocaleString("en-ZA")}</td></tr>`;
  }).join("");
  return `<div class="card"><div class="pad row between" style="flex-wrap:wrap"><div><h2 class="h2">Gradebook</h2><div class="small mute">Columns marked Fast Track sync from the external tool when a learner clears a level.</div></div>
      <span class="pill plum">${IC.bolt.replace("<svg", '<svg width="12" height="12"')} Synced just now</span></div>
    <div class="gbwrap"><table class="gb"><thead><tr><th>Learner</th><th>Assign. 1</th><th>Quiz 1</th><th>Quiz 2</th>${show.map((t) => `<th class="ft" title="${esc(t.title)}">FT · ${esc(t.title.split(":")[0])}</th>`).join("")}<th class="ft">FT accuracy</th><th class="ft">FT XP</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="mute">No learners yet.</td></tr>`}</tbody></table></div></div>`;
}

async function tabFastTrack() {
  const b = await ft();
  const active = b ? b.learners.filter((l) => l.answered).length : 0;
  const levels = b ? b.learners.reduce((s, l) => s + l.levels, 0) : 0;
  return `<div class="card tool"><div class="copy"><span class="pill plum">${IC.bolt.replace("<svg", '<svg width="12" height="12"')} External tool</span>
      <h2>Staffroom Fast Track</h2><p>Each chapter of the course notes becomes a ten-level ladder with a final quiz. Every question cites the passage it came from.</p>
      <div class="facts"><span><b>${S.topics.length}</b> chapters</span><span><b>${active}</b> learners active</span><span><b>${levels}</b> levels cleared</span></div>
      <div class="row" style="flex-wrap:wrap"><a class="btn primary" href="${ftLink("student")}" target="_blank" rel="noopener">Launch as student ${IC.out}</a><a class="btn" href="${ftLink("facilitator")}" target="_blank" rel="noopener">Open facilitator view</a></div>
      <p class="small mute" style="margin-top:14px">Opens in a new tab. Scores return to the Gradebook automatically.</p></div>
    <div class="peek" aria-hidden="true">${(b ? b.learners : []).slice(0, 4).map((l) => `<div><small>${esc(l.name.replace(" (sample)", ""))}</small><div class="bar"><i style="width:${Math.min(100, l.levels * 8)}%"></i></div></div>`).join("")}</div></div>`;
}

window.addEventListener("hashchange", route);
route();
