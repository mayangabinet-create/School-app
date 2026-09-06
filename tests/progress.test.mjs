import { test } from "node:test";
import assert from "node:assert/strict";
import { streakDays, summariseProgress, WEEK_DAYS } from "../supabase/functions/_shared/progress.mjs";

const at = (day, hour = "12:00") => ({ done_at: `${day}T${hour}:00Z` });

test("a streak counts consecutive days ending today", () => {
  assert.equal(streakDays(["2026-09-04", "2026-09-05", "2026-09-06"], "2026-09-06"), 3);
});

test("a streak ending yesterday still counts", () => {
  // Otherwise it appears broken at half past midnight to somebody who has
  // simply not started today yet.
  assert.equal(streakDays(["2026-09-04", "2026-09-05"], "2026-09-06"), 2);
});

test("one missed day is forgiven; two end it", () => {
  // A streak that can be lost outright is a punishment, and a fifteen-year-old
  // who loses one stops opening the app.
  assert.equal(streakDays(["2026-09-06", "2026-09-04", "2026-09-03"], "2026-09-06"), 3);
  assert.equal(streakDays(["2026-09-06", "2026-09-03"], "2026-09-06"), 1);
});

test("the forgiveness is spent once, not once per gap", () => {
  const days = ["2026-09-06", "2026-09-04", "2026-09-02"];
  assert.equal(streakDays(days, "2026-09-06"), 2, "the second gap ends it");
});

test("a streak that stopped days ago is zero, not negative", () => {
  assert.equal(streakDays(["2026-08-01"], "2026-09-06"), 0);
  assert.equal(streakDays([], "2026-09-06"), 0);
});

test("a streak spanning a month boundary keeps counting", () => {
  assert.equal(streakDays(["2026-08-30", "2026-08-31", "2026-09-01"], "2026-09-01"), 3);
});

test("a streak spanning a leap day keeps counting", () => {
  assert.equal(streakDays(["2024-02-28", "2024-02-29", "2024-03-01"], "2024-03-01"), 3);
});

test("counting ignores exercises that were never ticked", () => {
  const summary = summariseProgress(
    [at("2026-09-06"), { done_at: null }, {}, at("2026-09-05")],
    { today: "2026-09-06" },
  );
  assert.equal(summary.total, 2);
  assert.equal(summary.today, 1);
});

test("a timestamp late at night counts as the student's day, not the server's", () => {
  // 22:30 UTC on the 5th is already the 6th in Jerusalem.
  const summary = summariseProgress([at("2026-09-05", "22:30")], {
    today: "2026-09-06",
    timeZone: "Asia/Jerusalem",
  });
  assert.equal(summary.today, 1);

  const utc = summariseProgress([at("2026-09-05", "22:30")], {
    today: "2026-09-06",
    timeZone: "UTC",
  });
  assert.equal(utc.today, 0);
});

test("the week is the last seven days, inclusive of today", () => {
  const items = [
    at("2026-09-06"), at("2026-08-31"), // both inside
    at("2026-08-30"),                   // one day outside
  ];
  const summary = summariseProgress(items, { today: "2026-09-06" });
  assert.equal(summary.thisWeek, 2);
  assert.equal(summary.total, 3, "outside the week is still counted in the total");
  assert.equal(summary.recent.length, WEEK_DAYS);
});

test("the recent series is oldest first, with a row for every day", () => {
  const summary = summariseProgress([at("2026-09-06"), at("2026-09-06")], { today: "2026-09-06" });
  assert.deepEqual(summary.recent.map((d) => d.day), [
    "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
    "2026-09-04", "2026-09-05", "2026-09-06",
  ]);
  // A day with nothing on it keeps its slot, or a seven-day week silently
  // becomes a five-day one and the busy days look denser than they were.
  assert.deepEqual(summary.recent.map((d) => d.count), [0, 0, 0, 0, 0, 0, 2]);
});

test("difficulty is counted per band, and unrated is its own band", () => {
  const summary = summariseProgress([
    { ...at("2026-09-06"), difficulty: 1 },
    { ...at("2026-09-06"), difficulty: 1 },
    { ...at("2026-09-06"), difficulty: 5 },
    { ...at("2026-09-06"), difficulty: null },
    { ...at("2026-09-06") },
  ], { today: "2026-09-06" });

  assert.equal(summary.byDifficulty[1], 2);
  assert.equal(summary.byDifficulty[5], 1);
  assert.equal(summary.byDifficulty[3], 0);
  assert.equal(summary.byDifficulty.unrated, 2, "null and missing are the same thing here");
  const banded = [1, 2, 3, 4, 5].reduce((n, k) => n + summary.byDifficulty[k], 0);
  assert.equal(banded + summary.byDifficulty.unrated, summary.total, "every row lands in exactly one band");
});

test("an out-of-range difficulty falls into unrated rather than a sixth band", () => {
  const summary = summariseProgress(
    [{ ...at("2026-09-06"), difficulty: 9 }, { ...at("2026-09-06"), difficulty: 0 }],
    { today: "2026-09-06" },
  );
  assert.equal(summary.byDifficulty.unrated, 2);
  assert.equal(Object.keys(summary.byDifficulty).length, 6);
});

test("a corrupt timestamp is skipped, not counted as today", () => {
  const summary = summariseProgress(
    [{ done_at: "not a date" }, at("2026-09-06")],
    { today: "2026-09-06" },
  );
  assert.equal(summary.total, 1);
});

test("an empty list is zeroes with a full week of empty days", () => {
  const summary = summariseProgress([], { today: "2026-09-06" });
  assert.equal(summary.total, 0);
  assert.equal(summary.streak, 0);
  assert.equal(summary.recent.length, WEEK_DAYS);
  assert.deepEqual(summary.recent.map((d) => d.count), [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(summariseProgress(null, { today: "2026-09-06" }).total, 0);
});
