/**
 * How much you have actually done.
 *
 * Counting, and nothing but counting. Every number here is derived from the
 * timestamps already on the rows, so none of it can go stale and none of it
 * needs a migration when the definition of "this week" changes.
 *
 * No I/O in this file, and no clock: the caller passes the calendar day in.
 * Reading a clock inside a counting function makes it untestable, and makes two
 * numbers on the same screen disagree when the day rolls over between them.
 */

const DAY_MS = 86_400_000;

/** The calendar day a stored timestamp falls on, in the student's zone. */
function dayOf(timestamp, timeZone) {
  if (!timestamp) return null;
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function shiftDay(iso, by) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + by * DAY_MS).toISOString().slice(0, 10);
}

export const WEEK_DAYS = 7;

/**
 * Consecutive days of doing something, ending today or yesterday.
 *
 * Two deliberate softenings, both of which exist so that this number can only
 * ever encourage:
 *
 * Ending YESTERDAY still counts, so a streak does not appear broken at
 * half past midnight to somebody who has simply not started today yet.
 *
 * ONE missed day inside the run is forgiven — the schema calls it a shield —
 * so a day off does not erase a month. A streak that can be lost outright is a
 * punishment, and a fifteen-year-old who loses one stops opening the app. Two
 * missed days in a row do end it, because at that point the number would be
 * describing something that is not happening.
 */
export function streakDays(days, today) {
  const seen = new Set(days);
  if (seen.size === 0) return 0;

  let cursor = today;
  if (!seen.has(cursor)) {
    cursor = shiftDay(today, -1);
    if (!seen.has(cursor)) return 0;
  }

  let count = 0;
  let forgiven = false;

  // Terminates because every pass either steps the cursor back a day or breaks,
  // and two consecutive missed days always break: the first spends the
  // forgiveness, the second finds it spent.
  while (true) {
    if (seen.has(cursor)) count++;
    else if (forgiven) break;
    else forgiven = true;
    cursor = shiftDay(cursor, -1);
  }

  return count;
}

/**
 * Everything the progress screen shows, from the exercise rows themselves.
 *
 * `items` is every exercise the student owns, across every assignment — a
 * count of what they have done is not a per-worksheet fact.
 */
export function summariseProgress(items, { today, timeZone = "Asia/Jerusalem" }) {
  const done = [];
  const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unrated: 0 };
  const perDay = new Map();

  for (const item of items ?? []) {
    const stamp = item?.done_at ?? item?.doneAt;
    if (!stamp) continue;
    const day = dayOf(stamp, timeZone);
    if (!day) continue;

    done.push({ day, difficulty: item.difficulty ?? null });
    perDay.set(day, (perDay.get(day) ?? 0) + 1);

    const level = item.difficulty;
    if (level >= 1 && level <= 5) byDifficulty[level]++;
    else byDifficulty.unrated++;
  }

  const weekStart = shiftDay(today, -(WEEK_DAYS - 1));
  const inWeek = done.filter((d) => d.day >= weekStart && d.day <= today).length;

  // Oldest first, so a chart reads left to right in the direction time runs.
  const recent = [];
  for (let i = WEEK_DAYS - 1; i >= 0; i--) {
    const day = shiftDay(today, -i);
    recent.push({ day, count: perDay.get(day) ?? 0 });
  }

  return {
    total: done.length,
    today: perDay.get(today) ?? 0,
    thisWeek: inWeek,
    activeDays: perDay.size,
    streak: streakDays([...perDay.keys()], today),
    byDifficulty,
    recent,
  };
}
