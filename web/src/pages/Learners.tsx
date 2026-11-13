/* Student plans on their own pages: #/learners lists every learner's track plan, and
   #/learners/<id> is one learner's profile: their plan plus where they are in each chapter. */
import { useEffect, useState } from "react";
import { api, melsoftCourse, splitTitle, type Board } from "@/lib/api";
import { Checks, Lanes } from "@/pages/Facilitator";
import { Icon, StatusPill } from "@/components/ui/kit";
import { Participation, TrackPlans, type Summary } from "@/pages/FacExtras";
import { cn } from "@/lib/utils";

type Chapter = { topic_id: number; title: string; top: number; quiz: boolean; taught: boolean; state: string };

export default function Learners({ id }: { id?: number }) {
  const [cid, setCid] = useState<number | null>(null);
  const [fac, setFac] = useState<Summary | null>(null);
  const [me, setMe] = useState<{ chapters: Chapter[]; floors: number; percent: number } | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const load = async () => {
    const c = cid ?? (await melsoftCourse())?.id;
    if (!c) throw new Error("No course with notes yet");
    setCid(c);
    const [f, b, st] = await Promise.all([api<Summary>(`/api/ft/${c}/facilitator`), api<Board>(`/api/ft/${c}/board`), api<{ sessions: any[] }>(`/api/state/${c}`)]);
    setFac(f); setBoard(b); setSessions(st.sessions || []);
    setMe(id ? await api(`/api/ft/${c}/student/${id}`) : null);
  };
  useEffect(() => { setMe(null); load().catch((e) => setErr(String(e.message || e))); }, [id]);
  if (err) return <div className="glass p-6">Couldn't open the learners: {err}</div>;
  if (!fac || !cid) return <div className="py-6 text-pink-200/70">Opening the learners…</div>;

  const t = id ? fac.tracks.find((x) => x.learner_id === id) : null;
  const back = id ? "#/learners" : "#/class";
  return (
    <>
      <a href={back} className="inline-flex items-center gap-1.5 text-sm text-pink-300 hover:underline">
        <span className="rotate-180">{Icon.arrow}</span>{id ? "All student plans" : "Back to the class"}</a>
      {id && !t ? <div className="glass mt-4 p-6">No learner with that number.</div> : id && t ? (
        <>
          <header className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-display">{t.name.replace(" (sample)", "")}</h1>
            {t.sample && <span className="rounded-full border border-pink-300/25 px-2 py-0.5 text-xs text-pink-200/80">sample</span>}
            <StatusPill s={t.status} />
          </header>
          <p className="mt-2 text-body text-pink-200/80">Pace, finish date and what they can be tested on, from their own Fast Track history.</p>
          <div className="mt-6"><TrackPlans cid={cid} data={{ ...fac, tracks: [t] }} reload={() => load()} /></div>
          {me && (
            <section className="mt-10">
              <h2 className="text-h2">Chapters</h2>
              <p className="mt-1 text-muted text-pink-200/70">{me.floors} floors built · {me.percent}% of the course</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {me.chapters.map((c) => {
                  const s = splitTitle(c.title);
                  return (
                    <div key={c.topic_id} className={cn("glass flex items-center gap-3 px-4 py-3", !c.top && "opacity-60")}>
                      <div className="min-w-0 flex-1"><div className="text-label text-pink-300">{s.mod} {s.kt}</div>
                        <div className="truncate text-sm" title={s.name}>{s.name}</div></div>
                      <span className="shrink-0 font-mono text-sm">{c.quiz ? "★" : `${c.top}/10`}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <h1 className="mt-4 text-display">Student plans</h1>
          <p className="mt-2 max-w-[70ch] text-body text-pink-200/80">Each learner's pace from their own history, a personal finish date against the exam, and the topics they can be tested on. Topics unlock only once covered. Open a learner for their full profile.</p>
          {board && board.learners.length > 0 && (
            <section className="mt-8">
              <h2 className="text-h2">The race</h2>
              <p className="mt-1 text-muted text-pink-200/70">Levels cleared across all chapters. Every level is five questions cited to the notes.</p>
              <div className="glass mt-4 px-5 pb-4 pt-1"><Lanes learners={board.learners} /></div>
            </section>
          )}
          <h2 className="mt-10 text-h2">Track plans</h2>
          <div className="mt-4"><TrackPlans cid={cid} data={fac} reload={() => load()} /></div>
          {board && (
            <section className="mt-10">
              <h2 className="text-h2">Learners to check</h2>
              <p className="mt-1 text-muted text-pink-200/70">Picked from their answers: accuracy, confident mistakes and stalled climbs.</p>
              <div className="mt-4"><Checks learners={board.learners} /></div>
            </section>
          )}
          <section className="mt-10">
            <h2 className="text-h2">Class participation</h2>
            <p className="mt-1 text-muted text-pink-200/70">From the latest Google Meet transcript: who took part and how well, with the lines as evidence. It shapes each learner's test.</p>
            <div className="mt-4"><Participation sessions={sessions} /></div>
          </section>
        </>
      )}
    </>
  );
}
