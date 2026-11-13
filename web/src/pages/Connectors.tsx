/* Settings > Connections: Google Meet, Moodle and ClickUp. Each runs live once its key is saved,
   and in demo mode (sample data, same flow) until then. Keys go to the server and are never sent
   back; only a masked hint is shown. Public demo: keys and options are read-only, actions still run. */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

type Mode = "live" | "demo";
type Task = { id: number; learner: string; name: string; mode: Mode; url: string; status: "open" | "closed"; created_at: string; closed_at: string | null };
type Grade = { id: number; learner: string; chapter: string; score: number; max: number; mode: Mode; status: string; detail: string; sent_at: string };
type Status = {
  read_only: boolean; course: { id: number; title: string } | null; config: Record<string, string>;
  meet: { mode: Mode; last: { id: number; source: string; held_on: string } | null };
  moodle: { mode: Mode; grades: Grade[]; learners: { id: number; name: string }[]; chapters: { id: number; title: string }[] };
  clickup: { mode: Mode; tasks: Task[]; open: number; closed: number; flagged: number };
};
type TestRes = { ok: boolean; mode: Mode; message: string; ms?: number } | null;
type Field = { k: string; label: string; secret?: boolean; config?: boolean; placeholder?: string; hint?: string };

const field = "w-full rounded-xl border border-pink-300/25 bg-[#0c0b0e] px-3.5 py-2.5 text-body text-pink-50 outline-none placeholder:text-pink-200/40 focus:border-pink-300 disabled:opacity-60";
const ghost = "inline-flex items-center gap-2 rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold text-pink-100 hover:border-pink-300/60 disabled:opacity-50";
const primary = "inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(230,25,127,.75)] disabled:opacity-50";
const name = (s: string) => s.replace(" (sample)", "");
const chap = (t: string) => (t.includes(":") ? t.split(":").slice(1).join(":").trim() : t);

export default function Connectors({ readOnly }: { readOnly: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const load = () => Promise.all([api<Status>("/api/connectors"), api<Record<string, string>>("/api/settings")])
    .then(([st, k]) => { setS(st); setKeys(k); }).catch((e) => setErr(String(e.message || e)));
  useEffect(() => { load(); }, []);
  if (err && !s) return <div className="glass mt-10 p-6">Couldn't load the connections: {err}</div>;
  if (!s) return null;
  const ro = readOnly || s.read_only;
  return (
    <section className="mt-10">
      <h2 className="text-h2">Connections</h2>
      <p className="mt-1 max-w-[70ch] text-muted text-pink-200/70">Each tool runs <b className="text-pink-100">live</b> once its key is saved here, and in <b className="text-pink-100">demo</b> mode with sample data until then. Leave a key blank to keep what's saved.</p>
      <div className="mt-4 grid gap-5">
        <Card id="meet" title="Google Meet" mode={s.meet.mode} ro={ro} keys={keys} cfg={s.config} reload={load}
          blurb="Pulls the class register and transcript after class, then scores each learner's participation."
          fields={[{ k: "google_access_token", label: "OAuth access token", secret: true, placeholder: "Token with meetings.space.readonly" },
                   { k: "meet_code", label: "Class Meet code", config: true, placeholder: "abc-defg-hij" }]}>
          <MeetPanel s={s} />
        </Card>
        <Card id="moodle" title="Moodle (LMS)" mode={s.moodle.mode} ro={ro} keys={keys} cfg={s.config} reload={load}
          blurb="A signed link opens Fast Track already signed in as the learner. Final-quiz marks go back to the gradebook."
          fields={[{ k: "moodle_url", label: "Moodle site", placeholder: "https://exams.example.com" },
                   { k: "moodle_token", label: "Web service token", secret: true },
                   { k: "moodle_course_id", label: "Course id", config: true, placeholder: "e.g. 42", hint: "for grades" },
                   { k: "moodle_activity_id", label: "Fast Track activity id", config: true, placeholder: "e.g. 7", hint: "for grades" }]}>
          <MoodlePanel s={s} reload={load} />
        </Card>
        <Card id="clickup" title="ClickUp" mode={s.clickup.mode} ro={ro} keys={keys} cfg={s.config} reload={load}
          blurb="A flagged learner gets a task, “Fast Track: chapter”, with their launch link inside. It closes itself when they clear the final quiz."
          fields={[{ k: "clickup_token", label: "Personal token", secret: true, placeholder: "pk_…" },
                   { k: "clickup_team_id", label: "Workspace id", placeholder: "Blank: first Workspace" },
                   { k: "clickup_list_id", label: "List id", config: true, placeholder: "Blank: we create one", hint: "optional" }]}>
          <ClickUpPanel s={s} reload={load} />
        </Card>
      </div>
    </section>
  );
}

function Badge({ mode }: { mode: Mode }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
    mode === "live" ? "bg-pink-300 text-[#1a0d14]" : "border border-dashed border-pink-300/40 text-pink-200")}>
    <span className={cn("size-1.5 rounded-full", mode === "live" ? "bg-[#1a0d14]" : "bg-pink-300/60")} />{mode === "live" ? "Live" : "Demo mode"}</span>;
}

function Card({ id, title, blurb, mode, fields, ro, keys, cfg, reload, children }: {
  id: string; title: string; blurb: string; mode: Mode; fields: Field[]; ro: boolean; keys: Record<string, string>;
  cfg: Record<string, string>; reload: () => Promise<unknown>; children: React.ReactNode;
}) {
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [msg, setMsg] = useState("");
  const [test, setTest] = useState<TestRes>(null);
  const value = (f: Field) => edit[f.k] ?? (f.secret ? "" : (f.config ? cfg[f.k] : keys[f.k]) || "");
  const save = async () => {
    setBusy("save"); setMsg(""); setTest(null);
    try {
      const sec = Object.fromEntries(fields.filter((f) => !f.config && f.k in edit).map((f) => [f.k, edit[f.k]]));
      const con = Object.fromEntries(fields.filter((f) => f.config && f.k in edit).map((f) => [f.k, edit[f.k]]));
      if (Object.keys(sec).length) await api("/api/settings", { json: sec });
      if (Object.keys(con).length) await api("/api/connectors/config", { json: con });
      setEdit({}); await reload(); setMsg("Saved");
    } catch (e: any) { setMsg(String(e.message || e)); } finally { setBusy(""); }
  };
  const run = async () => {
    setBusy("test"); setTest(null);
    try { setTest(await api<TestRes>(`/api/connectors/${id}/test`, { method: "POST" })); }
    catch (e: any) { setTest({ ok: false, mode, message: String(e.message || e) }); } finally { setBusy(""); }
  };
  return (
    <div className="glass grid gap-6 p-5 md:p-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div><b className="text-h3">{title}</b><p className="mt-1 text-label text-pink-200/70">{blurb}</p></div>
          <Badge mode={mode} />
        </div>
        {fields.map((f) => (
          <label key={f.k} className="block">
            <span className="mb-1.5 flex items-baseline justify-between gap-3 text-label text-pink-200/80"><span className="font-semibold">{f.label}</span>
              <span className="text-pink-200/55">{f.secret && keys[f.k] ? `saved ${keys[f.k]}` : f.hint}</span></span>
            <input className={cn(field, f.secret && "font-mono")} type={f.secret ? "password" : "text"} autoComplete="off" spellCheck={false} disabled={ro}
              value={value(f)} placeholder={f.secret && keys[f.k] ? "Saved. Paste to replace" : f.placeholder}
              onChange={(e) => setEdit({ ...edit, [f.k]: e.target.value })} />
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          {!ro && <button className={primary} disabled={!!busy || !Object.keys(edit).length} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>}
          <button className={ghost} disabled={!!busy} onClick={run}>{busy === "test" ? "Testing…" : "Test connection"}</button>
          {msg && <span className="inline-flex items-center gap-1.5 text-sm text-pink-200">{msg === "Saved" && Icon.check}{msg}</span>}
        </div>
        {test && (
          <p role="status" className={cn("rounded-xl border px-4 py-3 text-sm", test.ok ? "border-pink-300/40 bg-pink-300/10 text-pink-50" : "border-dashed border-pink-300/40 text-pink-100")}>
            <b>{test.ok ? (test.mode === "live" ? "Connected" : "Demo mode") : "Couldn't connect."}</b> {test.message}{test.ms ? ` (${test.ms} ms)` : ""}
          </p>
        )}
      </div>
      <div className="min-w-0 rounded-2xl border border-pink-300/15 bg-black/20 p-4 md:p-5">{children}</div>
    </div>
  );
}

const Pill = ({ on, children }: { on: boolean; children: React.ReactNode }) =>
  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", on ? "bg-pink-300 text-[#1a0d14]" : "border border-pink-300/30 text-pink-200/80")}>{children}</span>;

function MeetPanel({ s }: { s: Status }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  const pull = async () => {
    setBusy(true); setOut("");
    try {
      const r = await api<{ job_id: number; attendees: number; lines: number; mode: Mode }>("/api/connectors/meet/import", { json: { meeting_code: code } });
      setOut(`Pulled ${r.attendees} attendees and ${r.lines} transcript lines${r.mode === "demo" ? " from the sample class" : ""}. Scoring participation…`);
      for (let i = 0; i < 90; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        const j = await api<{ status: string; result?: { flags?: number } | null }>(`/api/jobs/${r.job_id}`).catch(() => null);
        if (j && j.status !== "running") {
          setOut(`Pulled ${r.attendees} attendees and ${r.lines} transcript lines. ` + (j.status === "done"
            ? `Participation scored${j.result?.flags != null ? `, ${j.result.flags} learner${j.result.flags === 1 ? "" : "s"} flagged for follow-up` : ""}.`
            : "Scoring stopped early; see the Staffroom board for details."));
          break;
        }
      }
    } catch (e: any) { setOut(String(e.message || e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-3">
      <b className="text-body">After class</b>
      <p className="text-label text-pink-200/70">{s.meet.mode === "live" ? "Uses the Meet code below, or the saved one." : "Demo mode pulls the recorded sample class (register and transcript)."}</p>
      <div className="flex flex-wrap gap-2">
        {s.meet.mode === "live" && <input className={cn(field, "max-w-[220px] font-mono")} value={code} onChange={(e) => setCode(e.target.value)} placeholder={s.config.meet_code || "abc-defg-hij"} spellCheck={false} />}
        <button className={primary} disabled={busy} onClick={pull}>{busy ? "Pulling…" : "Pull class from Meet"}</button>
      </div>
      {out && <p role="status" className="text-sm text-pink-100">{out}</p>}
      {s.meet.last && <p className="text-label text-pink-200/60">Last pull: {s.meet.last.held_on} · {s.meet.last.source === "meet:demo" ? "sample class" : "Meet"}. <a className="text-pink-300 hover:underline" href="/fast-track/#/learners">See participation</a></p>}
    </div>
  );
}

function MoodlePanel({ s, reload }: { s: Status; reload: () => Promise<unknown> }) {
  const [learner, setLearner] = useState<number | "">(s.moodle.learners[0]?.id ?? "");
  const [topic, setTopic] = useState<number | "">("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const make = async () => {
    setCopied(false);
    const q = new URLSearchParams({ learner_id: String(learner), minutes: "60", ...(topic ? { topic_id: String(topic) } : {}) });
    setUrl((await api<{ url: string }>(`/api/connectors/moodle/launch-link?${q}`)).url);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* clipboard blocked */ } };
  return (
    <div className="grid gap-3">
      <b className="text-body">Launch from the LMS</b>
      <p className="text-label text-pink-200/70">The course page links here. The link is signed for one learner and expires after an hour.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className={field} value={learner} onChange={(e) => { setLearner(Number(e.target.value)); setUrl(""); }} aria-label="Learner">
          {s.moodle.learners.map((l) => <option key={l.id} value={l.id}>{name(l.name)}</option>)}
        </select>
        <select className={field} value={topic} onChange={(e) => { setTopic(e.target.value ? Number(e.target.value) : ""); setUrl(""); }} aria-label="Chapter">
          <option value="">All chapters</option>
          {s.moodle.chapters.map((c) => <option key={c.id} value={c.id}>{chap(c.title)}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={!learner} onClick={make}>Make launch link</button>
        {url && <><a className={ghost} href={url} target="_blank" rel="noopener">Open {Icon.arrow}</a><button className={ghost} onClick={copy}>{copied ? "Copied" : "Copy"}</button></>}
      </div>
      {url && <code className="block break-all rounded-lg bg-black/40 px-3 py-2 text-xs text-pink-200/80">{url}</code>}
      <div className="mt-2 flex items-center justify-between gap-2"><b className="text-body">Grades sent back</b>
        <button className="text-sm text-pink-300 hover:underline" onClick={() => reload()}>Refresh</button></div>
      {s.moodle.grades.length ? (
        <ul className="grid gap-1.5 text-sm">
          {s.moodle.grades.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate"><b>{name(g.learner)}</b> · {chap(g.chapter)} · {g.max ? Math.round((100 * g.score) / g.max) : 0}%</span>
              <span title={g.detail} className="shrink-0"><Pill on={g.status === "sent"}>{g.status === "sent" ? (g.mode === "demo" ? "sent (demo)" : "sent") : g.status}</Pill></span>
            </li>
          ))}
        </ul>
      ) : <p className="text-label text-pink-200/60">None yet. Final-quiz marks appear here the moment a learner finishes one.</p>}
    </div>
  );
}

function ClickUpPanel({ s, reload }: { s: Status; reload: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  const sync = async () => {
    setBusy(true); setOut("");
    try {
      const r = await api<{ opened: number; closed: number; errors: string[] }>("/api/connectors/clickup/sync", { json: {} });
      setOut(r.errors.length ? `ClickUp: ${r.errors[0]}` : `Opened ${r.opened} task${r.opened === 1 ? "" : "s"}, closed ${r.closed}.`);
      await reload();
    } catch (e: any) { setOut(String(e.message || e)); } finally { setBusy(false); }
  };
  const t = s.clickup;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-body">Follow-up tasks</b>
        <span className="text-label text-pink-200/70">{t.flagged} flagged · {t.open} open · {t.closed} closed</span>
      </div>
      <p className="text-label text-pink-200/70">Flagged means a chapter was taught in class and the learner hasn't caught up on it in Fast Track. One task per learner, for their earliest missed chapter.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={primary} disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync flagged learners"}</button>
        {out && <span role="status" className="text-sm text-pink-100">{out}</span>}
      </div>
      {t.tasks.length > 0 && (
        <ul className="grid max-h-[300px] gap-1.5 overflow-auto pr-1 text-sm">
          {t.tasks.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3">
              <a className={cn("min-w-0 truncate hover:underline", k.status === "closed" && "text-pink-200/55 line-through")} href={k.url} target="_blank" rel="noopener" title={k.mode === "demo" ? "Demo task: opens the learner's launch link" : "Open in ClickUp"}>{k.name}</a>
              <Pill on={k.status === "open"}>{k.status === "open" ? "open" : "closed"}</Pill>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
