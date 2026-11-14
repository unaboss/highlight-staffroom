// Run with: cd web && npm test   (plain node --test, no test framework needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fastTrackTarget, finished, moduleSummary, nextFloor, taughtModules } from "../src/lib/pick.ts";

const ch = (topic_id: number, mod: string, top: number, quiz = false) => ({ topic_id, mod, top, quiz });
const course = [
  ch(1, "KM-01", 10, true), ch(2, "KM-01", 7), ch(3, "KM-01", 4), ch(4, "KM-01", 0),
  ch(5, "KM-03", 0), ch(6, "KM-03", 2),
];
const taught = taughtModules(["KM-01", "KM-03"]);

test("only KM-01 counts as taught in class", () => {
  assert.deepEqual([...taught], ["KM-01"]);
  assert.deepEqual([...taughtModules(["AB-1", "AB-2"])], ["AB-1"]);
});

test("a leaf starts on that chapter", () => {
  assert.equal(fastTrackTarget({ kind: "leaf", id: 6 }, course, taught)?.topic_id, 6);
});

test("a branch starts on the module's next unfinished chapter", () => {
  assert.equal(fastTrackTarget({ kind: "branch", mod: "KM-01" }, course, taught)?.topic_id, 2);
  assert.equal(fastTrackTarget({ kind: "branch", mod: "KM-03" }, course, taught)?.topic_id, 5);
});

test("the trunk starts on the course's next unfinished taught chapter, then anything unfinished", () => {
  assert.equal(fastTrackTarget({ kind: "trunk" }, course, taught)?.topic_id, 2);
  const km01Done = course.map((c) => (c.mod === "KM-01" ? { ...c, top: 10, quiz: true } : c));
  assert.equal(fastTrackTarget({ kind: "trunk" }, km01Done, taught)?.topic_id, 5);
  const allDone = course.map((c) => ({ ...c, top: 10, quiz: true }));
  assert.equal(fastTrackTarget({ kind: "trunk" }, allDone, taught)?.topic_id, 1);
});

test("floors and module roll-up", () => {
  assert.equal(finished(ch(9, "x", 10)), true);
  assert.equal(nextFloor(ch(9, "x", 4)), 5);
  assert.equal(nextFloor(ch(9, "x", 10)), 11);
  assert.equal(nextFloor(ch(9, "x", 10, true)), null);
  assert.deepEqual(moduleSummary(course.slice(0, 4)), { count: 4, finished: 1, level: 5 });
  assert.deepEqual(moduleSummary([]), { count: 0, finished: 0, level: 0 });
});
