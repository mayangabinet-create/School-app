/**
 * How much of this is due today.
 *
 * This is the one piece of logic the whole product rests on, so it is a pure
 * function over plain values with its own tests, and the model never touches
 * it. The model's job is to say which exercises are on the page. Pace, days
 * remaining and percentage complete are arithmetic, and arithmetic is the
 * app's job: a language model asked to divide 17 by 4 will be confidently
 * wrong often enough to matter, and nothing downstream would catch it.
 *
 * Nothing here is stored, either. A stored pace goes stale the moment an item
 * is ticked, and then the home screen is lying. It is recomputed on every
 * render — which is also what makes "silently recalculate when the student
 * falls behind" free rather than a feature.
 *
 * Dates are calendar days as "YYYY-MM-DD" strings, never Date objects with a
 * time in them. A deadline is a day on a timetable, not an instant, and
 * subtracting timestamps across a daylight-saving boundary quietly gives 0.958
 * days where a student expects 1.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" → days since epoch, or null if it is not a real date. */
export function dayNumber(iso) {
  const m = DAY_RE.exec(String(iso || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Rejects 2026-02-30, which Date.UTC would happily roll over into March.
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / 86_400_000);
}

/** Whole calendar days from `from` to `to`. Negative when `to` is past. */
export function daysBetween(from, to) {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null) return null;
  return b - a;
}

/**
 * The calendar day a given instant falls on, in a given IANA time zone.
 *
 * Takes the instant as an argument rather than reading the clock, so it stays
 * testable. Israel is UTC+2/+3, so a student working at 23:30 is on a
 * different calendar day than a UTC server thinks — which is exactly the sort
 * of off-by-one that makes an assignment look overdue the evening before.
 */
export function calendarDay(date, timeZone = "Asia/Jerusalem") {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

export const STATUS = {
  DONE: "done",
  OVERDUE: "overdue",
  DUE_TODAY: "due-today",
  SCHEDULED: "scheduled",
  UNDATED: "undated",
};

/**
 * Pace for one assignment.
 *
 * `daysLeft` is the number of days the student can still WORK, which is not
 * the same as the number of days until the deadline. Homework due Friday is
 * handed in at Friday's lesson, so the days available are Wednesday and
 * Thursday when today is Wednesday — two, not three. Due today means zero
 * working days left and everything remaining lands now; that is the honest
 * answer, not a rounding error.
 *
 * `perDay` is what to do today to finish on time, and it is deliberately a
 * ceiling: telling a student to do 2.4 exercises is telling them nothing, and
 * rounding down means finishing a day late.
 */
export function paceFor({ total = 0, done = 0, dueOn = null, today }) {
  const t = Math.max(0, Math.trunc(total));
  const d = Math.min(t, Math.max(0, Math.trunc(done)));
  const remaining = t - d;
  const percent = t === 0 ? 0 : Math.round((d / t) * 100);

  const base = { total: t, done: d, remaining, percent };

  if (t > 0 && remaining === 0) {
    return { ...base, status: STATUS.DONE, daysLeft: null, perDay: 0 };
  }

  const diff = dueOn ? daysBetween(today, dueOn) : null;

  if (diff === null) {
    // No deadline is a real state, not a missing value. Showing "0 days left"
    // for an assignment nobody set a date on would invent an emergency.
    return { ...base, status: STATUS.UNDATED, daysLeft: null, perDay: 0 };
  }

  if (diff < 0) {
    return {
      ...base,
      status: STATUS.OVERDUE,
      daysLeft: diff,
      // Overdue work does not spread over the days it has already lost. All of
      // what is left is today's, which is also the only advice that helps.
      perDay: remaining,
    };
  }

  if (diff === 0) {
    return { ...base, status: STATUS.DUE_TODAY, daysLeft: 0, perDay: remaining };
  }

  return {
    ...base,
    status: STATUS.SCHEDULED,
    daysLeft: diff,
    perDay: Math.ceil(remaining / diff),
  };
}

/**
 * What today actually looks like across everything open.
 *
 * `dueToday` counts exercises, not assignments, because "you have 3 things due"
 * tells a student nothing about whether that is ten minutes or an evening.
 *
 * There is no penalty anywhere in this function and there should never be one.
 * Falling behind recalculates the number and says nothing about it; a student
 * who missed a day is shown a bigger number today, not a smaller score.
 */
export function todayPlan(assignments, today) {
  let dueToday = 0;
  let overdue = 0;
  let remaining = 0;
  const buckets = { overdue: [], dueToday: [], scheduled: [], undated: [] };

  for (const a of assignments) {
    const pace = paceFor({ ...a, today });
    if (pace.status === STATUS.DONE) continue;
    remaining += pace.remaining;

    const row = { ...a, pace };
    if (pace.status === STATUS.OVERDUE) {
      overdue += pace.remaining;
      dueToday += pace.remaining;
      buckets.overdue.push(row);
    } else if (pace.status === STATUS.DUE_TODAY) {
      dueToday += pace.remaining;
      buckets.dueToday.push(row);
    } else if (pace.status === STATUS.SCHEDULED) {
      dueToday += pace.perDay;
      buckets.scheduled.push(row);
    } else {
      buckets.undated.push(row);
    }
  }

  // Soonest deadline first inside each dated bucket; the undated ones keep the
  // order they arrived in.
  const bySoonest = (x, y) => (dayNumber(x.dueOn) ?? 0) - (dayNumber(y.dueOn) ?? 0);
  buckets.overdue.sort(bySoonest);
  buckets.dueToday.sort(bySoonest);
  buckets.scheduled.sort(bySoonest);

  return { dueToday, overdue, remaining, buckets };
}
