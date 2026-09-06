import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayNumber, daysBetween, calendarDay, paceFor, todayPlan, STATUS,
} from "../supabase/functions/_shared/pace.mjs";

test("dayNumber parses real dates and rejects impossible ones", () => {
  assert.equal(dayNumber("1970-01-01"), 0);
  assert.equal(dayNumber("1970-01-02"), 1);
  assert.equal(dayNumber("2026-02-29"), null, "2026 is not a leap year");
  assert.equal(dayNumber("2024-02-29") !== null, true, "2024 is");
  assert.equal(dayNumber("2026-02-30"), null, "must not roll over into March");
  assert.equal(dayNumber("2026-13-01"), null);
  assert.equal(dayNumber("2026-1-1"), null, "unpadded is not the format we store");
  assert.equal(dayNumber(""), null);
  assert.equal(dayNumber(null), null);
});

test("daysBetween counts calendar days across a month and a leap day", () => {
  assert.equal(daysBetween("2026-09-06", "2026-09-06"), 0);
  assert.equal(daysBetween("2026-09-06", "2026-09-07"), 1);
  assert.equal(daysBetween("2026-08-31", "2026-09-01"), 1);
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2);
  assert.equal(daysBetween("2026-09-07", "2026-09-06"), -1);
  assert.equal(daysBetween("nonsense", "2026-09-06"), null);
});

test("daysBetween is immune to daylight saving", () => {
  // Israel moves its clocks on the last Sunday of March. Subtracting
  // timestamps across it gives 0.958 days; these are calendar days.
  assert.equal(daysBetween("2026-03-27", "2026-03-28"), 1);
  assert.equal(daysBetween("2026-03-26", "2026-03-30"), 4);
});

test("calendarDay uses the student's zone, not the server's", () => {
  // 22:30 UTC on the 6th is already the 7th in Jerusalem (UTC+3 in September).
  const late = new Date("2026-09-06T22:30:00Z");
  assert.equal(calendarDay(late, "Asia/Jerusalem"), "2026-09-07");
  assert.equal(calendarDay(late, "UTC"), "2026-09-06");
});

test("an assignment with nothing left is done, whatever its date says", () => {
  const p = paceFor({ total: 5, done: 5, dueOn: "2020-01-01", today: "2026-09-06" });
  assert.equal(p.status, STATUS.DONE);
  assert.equal(p.remaining, 0);
  assert.equal(p.perDay, 0);
  assert.equal(p.percent, 100);
});

test("days left counts working days, not days until the deadline", () => {
  // Due Friday, today Wednesday: Wednesday and Thursday are the working days.
  const p = paceFor({ total: 8, done: 0, dueOn: "2026-09-11", today: "2026-09-09" });
  assert.equal(p.daysLeft, 2);
  assert.equal(p.perDay, 4);
});

test("perDay rounds up, because finishing a day late is not finishing", () => {
  const p = paceFor({ total: 10, done: 0, dueOn: "2026-09-10", today: "2026-09-06" });
  assert.equal(p.daysLeft, 4);
  assert.equal(p.perDay, 3, "10 over 4 days is 3 a day, not 2");
});

test("due today puts everything remaining on today", () => {
  const p = paceFor({ total: 6, done: 2, dueOn: "2026-09-06", today: "2026-09-06" });
  assert.equal(p.status, STATUS.DUE_TODAY);
  assert.equal(p.daysLeft, 0);
  assert.equal(p.perDay, 4);
});

test("overdue work does not spread over days it already lost", () => {
  const p = paceFor({ total: 6, done: 1, dueOn: "2026-09-01", today: "2026-09-06" });
  assert.equal(p.status, STATUS.OVERDUE);
  assert.equal(p.daysLeft, -5);
  assert.equal(p.perDay, 5, "all of it is today's, not 5 divided by -5");
});

test("no deadline is a state, not a zero", () => {
  const p = paceFor({ total: 4, done: 1, dueOn: null, today: "2026-09-06" });
  assert.equal(p.status, STATUS.UNDATED);
  assert.equal(p.daysLeft, null);
  assert.equal(p.perDay, 0, "an undated assignment must not invent an emergency");
});

test("an unparseable due date degrades to undated rather than to overdue", () => {
  const p = paceFor({ total: 4, done: 0, dueOn: "next tuesday", today: "2026-09-06" });
  assert.equal(p.status, STATUS.UNDATED);
});

test("counts are clamped so bad data cannot produce a negative remainder", () => {
  const p = paceFor({ total: 3, done: 9, today: "2026-09-06" });
  assert.equal(p.done, 3);
  assert.equal(p.remaining, 0);
  assert.equal(p.status, STATUS.DONE);
});

test("an empty assignment is 0 percent, not NaN", () => {
  const p = paceFor({ total: 0, done: 0, today: "2026-09-06" });
  assert.equal(p.percent, 0);
  assert.equal(Number.isFinite(p.percent), true);
});

test("falling behind raises today's number and nothing else", () => {
  const on = paceFor({ total: 10, done: 5, dueOn: "2026-09-11", today: "2026-09-06" });
  const behind = paceFor({ total: 10, done: 5, dueOn: "2026-09-11", today: "2026-09-09" });
  assert.equal(on.perDay, 1);
  assert.equal(behind.perDay, 3);
  // No score, no penalty, no lost streak anywhere in the returned shape.
  assert.deepEqual(
    Object.keys(behind).sort(),
    ["daysLeft", "done", "perDay", "percent", "remaining", "status", "total"],
  );
});

test("todayPlan totals exercises, not assignments", () => {
  const plan = todayPlan([
    { id: "a", total: 4, done: 4, dueOn: "2026-09-06" },   // done, ignored
    { id: "b", total: 3, done: 1, dueOn: "2026-09-04" },   // overdue: 2
    { id: "c", total: 5, done: 0, dueOn: "2026-09-06" },   // due today: 5
    { id: "d", total: 8, done: 0, dueOn: "2026-09-10" },   // 4 days -> 2
    { id: "e", total: 6, done: 0, dueOn: null },           // undated: 0
  ], "2026-09-06");

  assert.equal(plan.dueToday, 9, "2 overdue + 5 due today + 2 of the paced one");
  assert.equal(plan.overdue, 2);
  assert.equal(plan.remaining, 21);
  assert.deepEqual(plan.buckets.overdue.map(r => r.id), ["b"]);
  assert.deepEqual(plan.buckets.dueToday.map(r => r.id), ["c"]);
  assert.deepEqual(plan.buckets.scheduled.map(r => r.id), ["d"]);
  assert.deepEqual(plan.buckets.undated.map(r => r.id), ["e"]);
});

test("todayPlan sorts each dated bucket soonest first", () => {
  const plan = todayPlan([
    { id: "late", total: 1, done: 0, dueOn: "2026-09-20" },
    { id: "soon", total: 1, done: 0, dueOn: "2026-09-08" },
    { id: "mid", total: 1, done: 0, dueOn: "2026-09-12" },
  ], "2026-09-06");
  assert.deepEqual(plan.buckets.scheduled.map(r => r.id), ["soon", "mid", "late"]);
});

test("todayPlan on an empty list is zeroes, not a crash", () => {
  const plan = todayPlan([], "2026-09-06");
  assert.equal(plan.dueToday, 0);
  assert.equal(plan.remaining, 0);
  assert.deepEqual(plan.buckets.overdue, []);
});
