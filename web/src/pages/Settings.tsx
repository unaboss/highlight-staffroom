/* Settings for facilitators: the AI model the agents use (one source of truth
   with /staffroom) and the Google Meet, Moodle and ClickUp connections. A saved key is never sent
   back to the browser; only its last four characters are shown. */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { LoadError, SkeletonCard, Spinner } from "@/components/ui/loading";
import Connectors from "@/pages/Connectors";

type Preset = { label: string; base_url: string; model: string };
type ModelState = { provider: string; base_url: string; model: string; has_key: boolean; key_hint: string; online: boolean; presets: Record<string, Preset>; read_only?: boolean };
type Test = { ok: boolean; ms?: number; model?: string; error?: string } | null;
type Detected = { ok: boolean; provider?: string; label?: string; base_url?: string; default?: string; error?: string;
  models?: { id: string; recommended: boolean; note?: string }[] } | null;

const field = "w-full rounded-xl border border-pink-300/25 bg-[#0c0b0e] px-3.5 py-2.5 text-body text-pink-50 outline-none placeholder:text-pink-200/40 focus:border-pink-300";
const ghost = "inline-flex items-center gap-2 rounded-full border border-pink-300/30 px-4 py-2 text-sm font-semibold text-pink-100 hover:border-pink-300/60 disabled:opacity-50";
const primary = "inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(230,25,127,.75)] disabled:opacity-50";

export default function Settings() {
  const [ro, setRo] = useState(false);
  useEffect(() => { api<{ mode?: { public: boolean } }>("/api/health").then((h) => setRo(!!h.mode?.public)).catch(() => {}); }, []);
  return (
    <>
      <a href="/fast-track/" className="inline-flex items-center gap-1.5 text-sm text-pink-300 hover:underline"><span className="rotate-180">{Icon.arrow}</span>Back</a>
      <h1 className="mt-4 text-display">Settings</h1>
      <p className="mt-2 max-w-[62ch] text-body text-pink-200/80">The AI model the staff agents think with, and the tools they read from. Keys stay on this server; the page only ever shows their last four characters.</p>
      {ro && <p role="note" className="mt-6 rounded-xl border border-dashed border-pink-300/40 px-4 py-3 text-body text-pink-100">This is the public demo, so settings are read-only. Run Classroom Fast Track yourself to add your own API key and connections.</p>}
      <fieldset disabled={ro} className="contents"><ModelSection /></fieldset><Connectors readOnly={ro} />
    </>
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return <span className="mb-1.5 flex items-baseline justify-between gap-3 text-label text-pink-200/80"><span className="font-semibold">{children}</span>{hint && <span className="text-pink-200/55">{hint}</span>}</span>;
}

function ModelSection() {
  const [m, setM] = useState<ModelState | null>(null);
  const [provider, setProvider] = useState("custom");
  const [base, setBase] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test" | "detect">("");
  const [found, setFound] = useState<Detected>(null);
  const [test, setTest] = useState<Test>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const fill = (s: ModelState) => { setM(s); setProvider(s.provider); setBase(s.base_url); setModel(s.model); setKey(""); setReplacing(!s.has_key); };
  useEffect(() => { api<ModelState>("/api/settings/model").then(fill).catch((e) => setErr(String(e.message || e))); }, []);

  const pick = (p: string) => {
    setProvider(p); setTest(null); setSaved(false); setFound(null);
    const pr = m?.presets[p];
    if (pr) { setBase(pr.base_url); setModel(pr.model); }
  };
  const body = () => ({ provider, base_url: base, model, ...(key.trim() ? { api_key: key.trim() } : {}) });
  const save = async () => {
    setBusy("save"); setErr(""); setSaved(false);
    try { fill(await api<ModelState>("/api/settings/model", { json: body() })); setSaved(true); }
    catch (e: any) { setErr(String(e.message || e)); } finally { setBusy(""); }
  };
  const detect = async () => {
    setBusy("detect"); setFound(null); setTest(null);
    try {
      const d = await api<Detected>("/api/settings/model/detect", { json: { provider: provider === "custom" && !base ? "auto" : (m?.presets[provider] || provider === "custom" ? provider : "auto"), base_url: base, ...(key.trim() ? { api_key: key.trim() } : {}) } });
      setFound(d);
      if (d?.ok) { setProvider(d.provider || "custom"); setBase(d.base_url || ""); if (d.default) setModel(d.default); }
    } catch (e: any) { setFound({ ok: false, error: String(e.message || e) }); } finally { setBusy(""); }
  };
  const run = async () => {
    setBusy("test"); setTest(null);
    try { setTest(await api<Test>("/api/settings/model/test", { json: body() })); }
    catch (e: any) { setTest({ ok: false, error: String(e.message || e) }); } finally { setBusy(""); }
  };

  if (err && !m) return <LoadError className="mt-8" message={err} onRetry={() => { setErr(""); api<ModelState>("/api/settings/model").then(fill).catch((e) => setErr(String(e.message || e))); }} />;
  if (!m) return <SkeletonCard className="mt-8" lines={5} label="Loading settings" />;
  const opts: [string, string][] = [...Object.entries(m.presets).map(([k, v]) => [k, v.label] as [string, string]), ["custom", "Custom"]];
  const models = found?.ok ? found.models || [] : [];
  return (
    <section className="glass mt-8 grid gap-5 p-5 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-h2">AI model (API key)</h2>
          <p className="mt-1 text-muted text-pink-200/70">Any OpenAI-compatible provider. Without a key the agents run in offline mode.</p></div>
        <span className={cn("inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-semibold", m.online ? "bg-pink-300 text-[#1a0d14]" : "border border-dashed border-pink-300/40 text-pink-200")}>
          <span className={cn("size-2 rounded-full", m.online ? "bg-[#1a0d14]" : "bg-pink-300/50")} />Model: {m.online ? "online" : "offline"}</span>
      </div>

      <div role="radiogroup" aria-label="Provider" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {opts.map(([k, l]) => (
          <button key={k} role="radio" aria-checked={provider === k} onClick={() => pick(k)}
            className={cn("rounded-xl border px-3 py-2.5 text-sm font-semibold", provider === k ? "border-pink-300/70 bg-pink-500/15 text-pink-50 shadow-[0_0_18px_-6px_#e6197f]" : "border-pink-300/15 text-pink-200/80 hover:border-pink-300/40")}>{l}</button>
        ))}
      </div>
      {provider === "deepseek" && <p className="-mt-2 text-label text-pink-200/65">Use deepseek-chat. deepseek-reasoner doesn't support the JSON replies the agents rely on.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2"><Label>Base URL</Label>
          <input className={field} value={base} onChange={(e) => { setBase(e.target.value); setProvider("custom"); }} placeholder="https://api.example.com/v1" spellCheck={false} /></label>
        <label className="block"><Label hint={m.has_key && !replacing ? "saved" : undefined}>API key</Label>
          {m.has_key && !replacing ? (
            <div className="flex items-center gap-2">
              <span className={cn(field, "font-mono text-pink-200")}>{m.key_hint}</span>
              <button type="button" className={ghost} onClick={() => { setReplacing(true); setKey(""); }}>Replace</button>
              <button type="button" className={ghost} disabled={!!busy} onClick={detect} title="Find the provider and its models from the key">{busy === "detect" ? <><Spinner />Detecting…</> : "Detect"}</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input className={cn(field, "font-mono")} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" autoComplete="off" spellCheck={false} />
              <button type="button" className={ghost} disabled={!!busy || !key.trim()} onClick={detect} title="Find the provider and its models from the key">{busy === "detect" ? <><Spinner />Detecting…</> : "Detect"}</button>
            </div>
          )}</label>
        <label className="block"><Label>Model</Label>
          {models.length ? (
            <select className={cn(field, "font-mono")} value={model} onChange={(e) => setModel(e.target.value)}>
              {!models.some((x) => x.id === model) && model && <option value={model}>{model}</option>}
              {models.map((x) => <option key={x.id} value={x.id}>{x.id}{x.recommended ? "" : ` (${x.note || "not recommended"})`}</option>)}
            </select>
          ) : (
            <input className={cn(field, "font-mono")} value={model} onChange={(e) => setModel(e.target.value)} placeholder="model name" spellCheck={false} />
          )}</label>
      </div>
      {found && (
        <p role="status" className={cn("-mt-1 text-sm", found.ok ? "text-pink-100" : "text-pink-200")}>
          {found.ok ? <><span className="inline-flex items-center gap-1.5 font-semibold">{Icon.check} Detected: {found.label}</span> · {found.models?.length || 0} models · picked <b className="font-mono">{found.default}</b>. Click Save to use it.</>
            : <><b>Couldn't detect.</b> {found.error}</>}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!m.read_only && <button className={primary} disabled={!!busy} onClick={save}>{busy === "save" ? <><Spinner />Saving…</> : "Save"}</button>}
        <button className={ghost} disabled={!!busy} onClick={run}>{busy === "test" ? <><Spinner />Testing…</> : "Test connection"}</button>
        {saved && <span className="inline-flex items-center gap-1.5 text-sm text-pink-200">{Icon.check} Saved</span>}
        {err && <span className="text-sm text-pink-200">{err}</span>}
      </div>
      {test && (
        <div role="status" className={cn("rounded-xl border px-4 py-3 text-sm", test.ok ? "border-pink-300/40 bg-pink-300/10 text-pink-50" : "border-dashed border-pink-300/40 text-pink-100")}>
          {test.ok ? <><b>OK</b> · {test.model} answered in {test.ms} ms</> : <><b>Couldn't connect.</b> {test.error}</>}
        </div>
      )}
    </section>
  );
}
