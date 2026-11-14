/* What a Fast Track pick on the student landing means, kept free of React and imports so it can be
   checked with plain `node --test` (web/tests/pick.test.ts).
   The tree: trunk = the whole course, a branch = one module (KM-xx), a leaf = one chapter (KTxx).
   Picking one sets how deep the Fast Track goes: a leaf is that chapter, a branch is the module's next
   unfinished chapter, the trunk is the course's next unfinished chapter (taught work first). */

export type PickChap = { topic_id: number; mod: string; top: number; quiz: boolean };
export type Pick = { kind: "trunk" } | { kind: "branch"; mod: string } | { kind: "leaf"; id: number };

/** Modules the class has finished in class. For now (dev note 45) we assume only KM-01. */
export const TAUGHT_IN_CLASS = ["KM-01"];

export const finished = (c: { top: number; quiz: boolean }) => c.quiz || c.top >= 10;

/** The modules treated as taught: KM-01 if the course has it, otherwise its first module. */
export function taughtModules(mods: string[]): Set<string> {
  const have = mods.filter((m) => TAUGHT_IN_CLASS.includes(m));
  return new Set(have.length ? have : mods.slice(0, 1));
}

/** The chapter a pick starts on. Undefined only when there are no chapters at all. */
export function fastTrackTarget<T extends PickChap>(pick: Pick, chapters: T[], taught: Set<string>): T | undefined {
  if (pick.kind === "leaf") return chapters.find((c) => c.topic_id === pick.id);
  if (pick.kind === "branch") {
    const own = chapters.filter((c) => c.mod === pick.mod);
    return own.find((c) => !finished(c)) || own[0];
  }
  return chapters.find((c) => taught.has(c.mod) && !finished(c)) || chapters.find((c) => !finished(c)) || chapters[0];
}

/** The floor a chapter opens on: 1-10, 11 for the final quiz, null when it is complete. */
export function nextFloor(c: { top: number; quiz: boolean }): number | null {
  if (c.quiz) return null;
  return Math.min(11, c.top + 1);
}

/** One module's roll-up for its card: chapters, how many finished, and a 0-10 level (mean floor). */
export function moduleSummary(chapters: { top: number; quiz: boolean }[]) {
  const n = chapters.length;
  const level = n ? Math.round(chapters.reduce((s, c) => s + Math.min(10, c.quiz ? 10 : c.top), 0) / n) : 0;
  return { count: n, finished: chapters.filter(finished).length, level };
}

export const pickKey = (p: Pick) => (p.kind === "trunk" ? "trunk" : p.kind === "branch" ? `b:${p.mod}` : `l:${p.id}`);
