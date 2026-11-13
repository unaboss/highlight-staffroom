/* Dev notes: a floating Note button on every Staffroom page. Mark an area (drag) or pick an
   element (click), type what should change, and it is saved with a screenshot of that spot to
   dev-notes/ for the developer to work through. Each note shows its status: new, working on it,
   done or question.
   Alt+N starts a note. ?present=1 hides the button for a presentation (remembered); ?present=0
   brings it back. Lives in a shadow root so it never picks up page styles. */
(function () {
  if (window.__devNotes) return;
  window.__devNotes = true;
  const KEY = "staffroom-dev-notes-hidden";
  const store = {
    get() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } },
    set(v) { try { v ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch (e) {} },
  };
  const qs = new URLSearchParams(location.search);
  if (qs.get("present") === "1") store.set(true);
  if (qs.get("present") === "0") store.set(false);

  const host = document.createElement("div");
  host.id = "dev-notes-host";
  host.style.cssText = "position:fixed;inset:auto;z-index:2147483000;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .fab{position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:8px;height:42px;padding:0 16px 0 13px;border-radius:999px;border:1px solid rgba(255,170,210,.35);background:#16121a;color:#ffe3f0;font-size:14px;font-weight:650;cursor:pointer;box-shadow:0 10px 30px -10px rgba(0,0,0,.7),0 0 0 4px rgba(230,25,127,.12)}
    .fab:hover{border-color:#ff7ab8}.fab:focus-visible,button:focus-visible,textarea:focus-visible{outline:2px solid #ff7ab8;outline-offset:2px}
    .fab svg{width:17px;height:17px;stroke:#ff7ab8;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .badge{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#e6197f;color:#fff;font-size:11.5px;display:grid;place-items:center}
    .badge[hidden],.fab[hidden]{display:none}
    .panel{position:fixed;right:18px;bottom:72px;width:min(380px,calc(100vw - 36px));max-height:min(70vh,560px);display:flex;flex-direction:column;border-radius:16px;border:1px solid rgba(255,170,210,.25);background:#120f15;color:#ffe3f0;box-shadow:0 30px 80px -20px rgba(0,0,0,.85)}
    .panel[hidden],.compose[hidden],.overlay[hidden]{display:none}
    .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 14px 10px 16px;border-bottom:1px solid rgba(255,170,210,.12)}
    .head b{font-size:15px}.head small{display:block;color:rgba(255,200,225,.6);font-size:12px;margin-top:2px}
    .btn{all:unset;box-sizing:border-box;cursor:pointer;padding:8px 12px;border-radius:10px;font-size:13px;font-weight:650;text-align:center}
    .primary{background:linear-gradient(180deg,#f0328f,#c40f6b);color:#fff}
    .ghost{border:1px solid rgba(255,170,210,.25);color:#ffd0e6}
    .ghost:hover{border-color:rgba(255,170,210,.5)}
    .modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 14px}
    .paste{margin:-2px 14px 10px;font-size:12.5px;color:rgba(255,200,225,.65)}.paste b{color:#ffd0e6;font-weight:650}
    .list{overflow:auto;padding:4px 14px 14px;display:grid;gap:8px}
    .empty{color:rgba(255,200,225,.6);font-size:13px;padding:6px 2px 10px}
    .item{display:grid;grid-template-columns:56px 1fr;gap:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,170,210,.1)}
    .item img,.item .noimg{width:56px;height:42px;object-fit:cover;border-radius:6px;background:#0c0b0e;border:1px solid rgba(255,170,210,.15)}
    .item p{margin:0;font-size:13px;line-height:1.4;color:#ffe3f0;word-break:break-word}
    .meta{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11.5px;color:rgba(255,200,225,.6)}
    .st{padding:1px 8px;border-radius:999px;font-weight:650;font-size:11px;border:1px solid}
    .st.new{border-color:rgba(255,170,210,.35);color:#ffd0e6}
    .st.working{border-color:#ff7ab8;color:#fff;background:rgba(230,25,127,.25)}
    .st.done{border-color:rgba(255,170,210,.2);color:#ffb3d6;background:rgba(255,170,210,.08)}
    .st.question{border-color:#ffd166;color:#ffd166}
    .reply{margin-top:6px;padding-left:8px;border-left:2px solid #e6197f;font-size:12.5px;color:rgba(255,220,235,.85)}
    .foot{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-top:1px solid rgba(255,170,210,.12);font-size:12px;color:rgba(255,200,225,.55)}
    .link{all:unset;cursor:pointer;color:#ff9ccb;font-size:12px}.link:hover{text-decoration:underline}
    .overlay{position:fixed;inset:0;cursor:crosshair;background:rgba(12,11,14,.08)}
    .hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:#16121a;border:1px solid rgba(255,170,210,.35);color:#ffe3f0;font-size:13px;box-shadow:0 10px 30px -10px rgba(0,0,0,.7);pointer-events:none;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}
    .box{position:fixed;border:2px solid #ff3d9a;background:rgba(255,61,154,.10);border-radius:4px;pointer-events:none;box-shadow:0 0 0 9999px rgba(12,11,14,.25)}
    .box[hidden]{display:none}
    .compose{position:fixed;right:18px;bottom:72px;width:min(400px,calc(100vw - 36px));padding:14px;border-radius:16px;border:1px solid rgba(255,170,210,.25);background:#120f15;color:#ffe3f0;box-shadow:0 30px 80px -20px rgba(0,0,0,.85);display:grid;gap:10px}
    .shot{width:100%;max-height:180px;object-fit:contain;border-radius:10px;background:#0c0b0e;border:1px solid rgba(255,170,210,.15)}
    .where{font-size:12px;color:rgba(255,200,225,.6);word-break:break-all}
    textarea{width:100%;min-height:96px;resize:vertical;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,170,210,.25);background:#0c0b0e;color:#ffe3f0;font-size:14px;line-height:1.45}
    .row{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .err{color:#ffd166;font-size:12.5px}
    @media (prefers-reduced-motion:no-preference){.fab,.panel,.compose{transition:transform .15s}.fab:active{transform:scale(.97)}}
  </style>
  <button class="fab" part="fab" aria-label="Leave a note (Alt+N)" title="Leave a note (Alt+N)">
    <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>Note<span class="badge" hidden></span></button>
  <section class="panel" hidden role="dialog" aria-label="Notes">
    <div class="head"><div><b>Notes</b><small>Mark what should change. I pick them up as you go.</small></div>
      <button class="btn ghost close" aria-label="Close notes">Close</button></div>
    <div class="modes"><button class="btn primary area">Mark an area</button><button class="btn ghost pick">Pick an element</button></div>
    <p class="paste">Or snip anything with <b>Win+Shift+S</b> and press <b>Ctrl+V</b> on the page.</p>
    <div class="list"></div>
    <div class="foot"><span>Alt+N starts a note</span><button class="link hide">Hide for presenting</button></div>
  </section>
  <div class="overlay" hidden><div class="hint"></div><div class="box" hidden></div></div>
  <form class="compose" hidden>
    <img class="shot" alt="The marked area" hidden>
    <div class="where"></div>
    <textarea placeholder="What should change here?" aria-label="Your note"></textarea>
    <div class="row"><span class="err"></span><span style="display:flex;gap:8px">
      <button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary save">Save note</button></span></div>
  </form>`;
  const $ = (s) => root.querySelector(s);
  const fab = $(".fab"), badge = $(".badge"), panel = $(".panel"), list = $(".list");
  const overlay = $(".overlay"), hint = $(".hint"), box = $(".box");
  const compose = $(".compose"), shot = $(".shot"), where = $(".where"), ta = $("textarea"), err = $(".err");
  let draft = null, timer = 0, seen = "";

  const LABEL = { new: "New", working: "Working on it", done: "Done", question: "Question" };
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
  };

  async function refresh() {
    try {
      const r = await fetch("/api/dev-notes", { cache: "no-store" });
      if (!r.ok) return;
      const { notes } = await r.json();
      const open = notes.filter((n) => n.status !== "done").length;
      badge.hidden = !open; badge.textContent = open;
      const sig = JSON.stringify(notes.map((n) => [n.id, n.status, n.updated_at]));
      if (sig === seen && list.childElementCount) return;
      seen = sig;
      list.innerHTML = notes.length ? notes.map((n) => `
        <div class="item">
          ${n.has_shot ? `<img src="/api/dev-notes/${n.id}/shot.png?v=${encodeURIComponent(n.updated_at)}" alt="">` : `<div class="noimg"></div>`}
          <div><div class="meta"><b>#${n.id}</b><span class="st ${n.status}">${LABEL[n.status] || n.status}</span><span>${ago(n.updated_at)}</span></div>
            <p>${esc(n.note)}</p>
            ${n.status === "question" && n.question ? `<div class="reply">${esc(n.question)}</div>` : ""}
            ${n.summary ? `<div class="reply">${esc(n.summary)}</div>` : ""}</div>
        </div>`).join("") : `<div class="empty">No notes yet. Mark an area or pick an element, then say what should change.</div>`;
    } catch (e) { /* server restarting: try again next tick */ }
  }
  const poll = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000); };

  function showFab(on) { fab.hidden = !on; if (!on) { panel.hidden = true; compose.hidden = true; } }
  function openPanel() { compose.hidden = true; panel.hidden = false; refresh(); }
  fab.addEventListener("click", () => (panel.hidden ? openPanel() : (panel.hidden = true)));
  $(".close").addEventListener("click", () => { panel.hidden = true; fab.focus(); });
  $(".hide").addEventListener("click", () => { store.set(true); showFab(false); });
  $(".area").addEventListener("click", () => startCapture("area"));
  $(".pick").addEventListener("click", () => startCapture("pick"));

  /* capture: drag a rectangle, or click to pick the element under the pointer */
  let mode = "area", start = null, hover = null;
  function startCapture(m) {
    mode = m; start = null; hover = null;
    panel.hidden = true; compose.hidden = true; overlay.hidden = false; box.hidden = true;
    hint.textContent = m === "pick" ? "Click the element you mean (or drag an area). Esc cancels." : "Drag over the area you mean, or click an element. Esc cancels.";
  }
  const stopCapture = () => { overlay.hidden = true; box.hidden = true; };
  const under = (x, y) => {
    overlay.style.pointerEvents = "none"; host.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    overlay.style.pointerEvents = ""; host.style.pointerEvents = "";
    return el && el !== host ? el : document.body;
  };
  const place = (r) => { box.hidden = false; Object.assign(box.style, { left: r.x + "px", top: r.y + "px", width: r.width + "px", height: r.height + "px" }); };
  overlay.addEventListener("pointerdown", (e) => { start = { x: e.clientX, y: e.clientY }; overlay.setPointerCapture(e.pointerId); });
  overlay.addEventListener("pointermove", (e) => {
    if (start) {
      const r = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y) };
      if (r.width > 6 || r.height > 6) place(r);
    } else {
      hover = under(e.clientX, e.clientY);
      place(hover.getBoundingClientRect());
    }
  });
  overlay.addEventListener("pointerup", (e) => {
    if (!start) return;
    const w = Math.abs(e.clientX - start.x), h = Math.abs(e.clientY - start.y);
    let rect, el;
    if (w > 12 && h > 12) {
      rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), width: w, height: h };
      el = under(rect.x + w / 2, rect.y + h / 2);
    } else {
      el = under(e.clientX, e.clientY);
      const b = el.getBoundingClientRect();
      rect = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    start = null;
    stopCapture();
    finishCapture(rect, el, w > 12 && h > 12 ? "region" : "element");
  });

  function selectorFor(el) {
    if (!(el instanceof Element)) return "";
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      if (n.id) { parts.unshift("#" + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => !/[:\[\]/]/.test(c)).slice(0, 2);
      if (cls.length) p += "." + cls.map((c) => CSS.escape(c)).join(".");
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
      if (n === document.body) break;
    }
    return parts.join(" > ");
  }

  let lib = null;
  const loadLib = () => lib || (lib = new Promise((ok, no) => {
    if (window.htmlToImage) return ok(window.htmlToImage);
    const s = document.createElement("script");
    s.src = "/static/vendor/html-to-image.js";
    s.onload = () => ok(window.htmlToImage); s.onerror = () => no(new Error("screenshot library did not load"));
    document.head.appendChild(s);
  }));

  async function grab(rect) {
    const h2i = await loadLib();
    const doc = document.documentElement, pad = 16;
    const W = Math.max(doc.scrollWidth, innerWidth), H = Math.min(Math.max(doc.scrollHeight, innerHeight), Math.ceil(scrollY + innerHeight));   // nothing below the viewport is needed
    const ratio = W * H > 9e6 ? 1 : Math.min(2, devicePixelRatio || 1);
    const opts = {
      width: W, height: H, pixelRatio: ratio, cacheBust: false,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#0c0b0e",
      filter: (n) => n !== host,
    };
    let canvas;
    try { canvas = await h2i.toCanvas(doc, opts); }
    catch (e) { canvas = await h2i.toCanvas(doc, { ...opts, skipFonts: true }); }
    const sx = Math.max(0, rect.x + scrollX - pad), sy = Math.max(0, rect.y + scrollY - pad);
    const sw = Math.min(W - sx, rect.width + pad * 2), sh = Math.min(H - sy, rect.height + pad * 2);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw * ratio)); out.height = Math.max(1, Math.round(sh * ratio));
    out.getContext("2d").drawImage(canvas, sx * ratio, sy * ratio, sw * ratio, sh * ratio, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  async function finishCapture(rect, el, how) {
    draft = {
      mode: how, url: location.href,
      viewport: { width: innerWidth, height: innerHeight, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY), dpr: devicePixelRatio || 1 },
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      selector: selectorFor(el), text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 600),
    };
    where.textContent = `${location.pathname}${location.hash} · ${draft.selector || "page"}`;
    shot.hidden = true; err.textContent = "Taking the screenshot…"; ta.value = "";
    compose.hidden = false; ta.focus();
    try { draft.image = await grab(rect); shot.src = draft.image; shot.hidden = false; err.textContent = ""; }
    catch (e) { draft.shot_error = String(e && e.message || e); err.textContent = "No screenshot this time, the note still saves."; }
  }
  compose.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!draft || !ta.value.trim()) { err.textContent = "Write a note first."; ta.focus(); return; }
    const btn = $(".save"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      const r = await fetch("/api/dev-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, note: ta.value }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
      draft = null; seen = ""; openPanel();
    } catch (e2) { err.textContent = "Could not save: " + (e2.message || e2); }
    finally { btn.disabled = false; btn.textContent = "Save note"; }
  });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); compose.requestSubmit(); } });
  $(".cancel").addEventListener("click", () => { draft = null; compose.hidden = true; });

  /* paste a screenshot taken with the Snipping Tool (or any image) to start a note with it */
  const editable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  document.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item || store.get()) return;
    const busy = !compose.hidden || !panel.hidden;
    if (!busy && editable(document.activeElement)) return;
    e.preventDefault();
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {              // always store as PNG
        const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const keep = draft && !compose.hidden ? draft : null;
        draft = keep || { mode: "pasted", url: location.href, rect: {}, selector: "", text: "",
          viewport: { width: innerWidth, height: innerHeight, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY), dpr: devicePixelRatio || 1 } };
        draft.image = c.toDataURL("image/png"); delete draft.shot_error;
        if (!keep) { where.textContent = `${location.pathname}${location.hash} · pasted screenshot`; ta.value = ""; }
        shot.src = draft.image; shot.hidden = false; err.textContent = "";
        panel.hidden = true; compose.hidden = false; ta.focus();
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(item.getAsFile());
  }, true);

  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "n" || e.key === "N" || e.code === "KeyN")) {
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) { const hide = !store.get(); store.set(hide); showFab(!hide); return; }
      if (store.get()) { store.set(false); showFab(true); }
      startCapture("area");
    } else if (e.key === "Escape" && (!overlay.hidden || !compose.hidden || !panel.hidden)) {
      e.stopPropagation();
      if (!overlay.hidden) stopCapture(); else if (!compose.hidden) { compose.hidden = true; draft = null; } else panel.hidden = true;
    }
  }, true);

  const mount = () => { document.body.appendChild(host); showFab(!store.get()); refresh(); poll(); };
  document.body ? mount() : document.addEventListener("DOMContentLoaded", mount);
})();
