# Learning OS — Build Plan

A personal learning operating system: know what to do, how much is left, when it's
due, and how much to do *today*.

This document is the plan of record. It states the architecture, the data model,
the scheduling engine, the phase order, and — explicitly — what we are **not**
building in v1 and why.

---

## 0. The honest framing

### What is actually valuable here

The differentiator is **not** gamification. XP, levels and streaks are a solved,
copied pattern; every study app has them and most are abandoned anyway.

The differentiator is the **planner**: a single number, recomputed continuously,
that answers *"how much do I need to do today across everything I owe?"* — with
honest detection of when the answer is "you cannot finish, something has to give."

No paper planner does that. Most apps don't either, because they schedule one
assignment at a time instead of allocating one shared budget across all of them.

**So the planner ships before the gamification.** This reverses the phase order in
the original brief. Reason: if the planner is good, the app is useful with zero XP.
If the planner is naive (`total ÷ days`), no amount of XP makes it worth opening.

### The real risk, named

This app is a **tracker of work done elsewhere**, not the place the work happens.
Duolingo retains because the app *is* the exercise. Here the exercise is in a
notebook, and the app only records it.

That means the failure mode is not "not motivated enough." It is **logging friction**.
A student who must tap 40 times over 8 days to record 40 exercises will stop tapping
on day 3, the data goes stale, the plan becomes wrong, and the app is dead.

Therefore, a hard design constraint, treated as a P0 requirement and not a polish item:

> **Logging one unit of work must take at most 2 taps from cold app open, and must
> work retroactively for past days.**

Anything that violates this gets redesigned, no matter how good it looks.

### Scope verdict

The brief has 19 sections. Roughly six of them are the product; the rest are v2.
Cut list with reasons in §7.

---

## 1. Architecture

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Server components for reads, server actions for writes |
| Styling | Tailwind CSS | Design tokens in CSS variables, both themes from day 1 |
| Database | Supabase Postgres | Row Level Security on every table, no exceptions |
| Auth | Supabase anonymous auth in v0, upgraded to email later | See below |
| Charts | Recharts | Phase 5 only |
| Icons | Lucide | |
| Animation | Framer Motion | Progress rings, completion feedback |
| Hosting | Vercel | |
| Testing | Vitest for the engine | The scheduler is pure functions and gets real tests |

### Two decisions worth defending

**Anonymous auth first.** For a v0 with one user, a login screen is pure friction
that protects nothing. Supabase anonymous sign-in gives a real `user_id` and real
RLS from commit one, and converts to a permanent account later without a data
migration. Do not build a login form in phase 1.

**Everything derives from two append-only ledgers.** This is the single most
important architectural decision in the document.

- `work_log` — every unit of work ever recorded.
- `xp_events` — every XP grant ever made.

Progress, daily totals, streaks, statistics, graphs, levels and achievement
conditions are all **derived** from these, never stored as mutable counters.

Consequences, all of them good:
- Undo is a row delete, not a reconciliation.
- Statistics and weekly graphs come free in phase 5 — the history is already there.
- A changed XP formula can be replayed; a corrupted counter cannot be repaired.
- Backdated logging works naturally, because a log row carries its own date.

The cost is a few aggregate queries and a materialized view later if it gets slow.
Worth it.

---

## 2. Data model

```sql
profiles          (id, display_name, timezone, daily_capacity_minutes,
                   rest_weekday, created_at)

subjects          (id, user_id, name, color, icon, archived)

assignments       (id, user_id, subject_id, title, kind,
                   total_units, unit_label, minutes_per_unit,
                   assigned_on, due_date, completed_at, archived)

work_log          (id, user_id, assignment_id, units, minutes,
                   logged_for_date, created_at, source)     -- append only

exams             (id, user_id, subject_id, title, exam_date,
                   topics jsonb, target_minutes)

study_sessions    (id, user_id, assignment_id, exam_id,
                   started_at, ended_at, minutes)

schedule_blocks   (id, user_id, weekday, starts_at, ends_at, subject_id)

day_capacity      (id, user_id, date, capacity_minutes)     -- per-date override

xp_events         (id, user_id, amount, reason, ref_type, ref_id, created_at)
                                                            -- append only

achievements      (id, user_id, code, unlocked_at)
```

Notes:
- `kind` in `assignments`: `homework`, `project`, `reading`, `task`.
- `unit_label` is user text: "exercises", "pages", "questions". Keeps the UI honest
  without a rigid taxonomy.
- `minutes_per_unit` starts as a per-subject default and is **learned** from actual
  session data in phase 5 — this is what makes the time estimates stop being fiction.
- `logged_for_date` is separate from `created_at` precisely so that "I did 8 last
  night" is a first-class operation.
- RLS policy on every table: `user_id = auth.uid()`. Written in the same migration
  that creates the table, never later.

---

## 3. The scheduling engine

Lives in `lib/engine/`, pure TypeScript, zero database imports, fully unit-tested.
The UI calls it; it never calls the UI.

### Inputs

- Open assignments: remaining units, `minutes_per_unit`, `due_date`.
- Upcoming exams: `target_minutes`, `exam_date`.
- Per-day capacity: profile default, minus school hours from `schedule_blocks`,
  overridden by `day_capacity`, zero on rest days.
- Today's date.

### Algorithm (v1, deterministic — no AI)

1. Build the day list from today to the furthest deadline.
2. For each item compute `remaining_minutes` and its **window** — the available days
   between today and the day before the due date, excluding zero-capacity days.
3. Compute `slack = window_capacity − remaining_minutes` for each item.
4. Sort by ascending slack (tightest first). This is a critical-ratio rule, and it
   beats plain earliest-deadline-first when a distant assignment is large.
5. Greedily allocate each item evenly across its window, respecting the remaining
   capacity of each day; when a day fills up, spill to the next day inside the window.
6. If an item cannot fit inside its window, mark it **at risk** and say so plainly.
7. Recompute on every write. **The plan is never persisted as truth** — only explicit
   user overrides ("today I want to do 10") are stored.

### Why step 6 matters

Naive `40 ÷ 8 = 5/day` will happily tell a student to do five exercises a day while
silently ignoring that they also have a science test and two other assignments that
same week. The result is a plan that is arithmetically correct and practically a lie.

Instead:

```
⚠️  Friday is not reachable.
    Math needs 6h 30m before Friday. You have 4h of free capacity.

    Options:
      • Move 2h from the weekend        → finishes Thursday
      • Raise the daily budget to 95m   → finishes Friday, tight
      • Drop 12 exercises               → ask the teacher
```

Honest infeasibility detection is the single feature most likely to make this app
trusted rather than ignored.

### Exams: ramp, not flat

Exam study is allocated with weight proportional to `1 / (days_until + 1)`, capped
per day. Twenty minutes nine days out, an hour the day before. Flat allocation for
exams is wrong and everybody knows it from experience.

### "Behind schedule"

`expected_by_now` = even pace from `assigned_on` to `due_date`, evaluated today.
`behind = expected_by_now − actual_units`. Show both the deficit and the recomputed
pace. Never show only the scolding number.

---

## 4. Gamification, specified rather than vibed

### XP

XP is proportional to **estimated minutes**, not to unit count:

```
xp(entry) = max(5, round(entry.units * assignment.minutes_per_unit * 0.5))
```

Rationale: if XP were per-unit, splitting one assignment into 100 tiny "units"
would inflate the numbers and make every statistic meaningless. Tie the score to
time and it stays comparable across subjects.

Bonuses: daily goal reached +25. Assignment finished before its due date +50.
Completed focus session +1 per 2 minutes.

### Levels

`xp_required(n) = round(100 * n^1.6)`. Levels 1–5 arrive fast, then it stretches.
Names are cosmetic and come from a static table.

### Streaks — deliberately forgiving

A day counts when either:
- logged minutes ≥ 60% of the day's recommended minutes, or
- at least one unit was logged on a day with no recommendation.

Plus:
- **Rest weekday**: one configurable weekday that never breaks a streak.
- **Freezes**: one earned per 7 consecutive days, maximum 2 held, consumed
  automatically on a missed day.

A streak system that punishes a sick day trains people to delete the app. The brief's
instinct here was right; this is the mechanism that implements it.

### Achievements — first eight only

First Step · Speed Run (10 units in a day) · 7 Day Streak · Homework Hero (5
assignments finished early) · Comeback (recover from behind to on-track) · Deep Work
(a 45-minute session) · Early Bird (finished 2+ days early) · Clean Week (every day
on target).

All eight are computable as queries over the two ledgers. No extra state.

---

## 5. Screens, in build order

1. **Home** — today's ring, today's plan across all subjects, one-tap logging on each
   row, at-risk banner. This is the whole app; everything else is secondary.
2. **Quick Add** — subject, title, unit count, due date. Four fields, under 20 seconds.
3. **Assignment detail** — unit grid, history, pace, edit.
4. **Calendar** — month view with deadline and exam markers, agenda per tapped day.
5. **Exam countdown** — days remaining, topic checklist, daily recommendation.
6. **Focus mode** — timer, session log, summary card at the end.
7. **Statistics** — weekly minutes, units, completion rate, per-subject bars.
8. **Timetable** — weekly grid, entered once, feeds the capacity model.

---

## 6. Phases and gates

Estimates assume focused working days. Each phase has an exit gate that must be met
before the next phase starts.

### Phase 0 — Foundations · 1 day
Next.js and TypeScript and Tailwind. Supabase project, schema, RLS, anonymous auth,
typed data layer, seed script, deployed to Vercel.
**Gate:** a seeded assignment is readable in production.

### Phase 1 — The loop · 3–4 days
Subjects, assignments, quick add, `work_log` writes, one-tap and backdated logging,
home screen with derived progress. No XP, no animations, no calendar.
**Gate — the important one:** use it daily for **seven consecutive days** with no
gamification whatsoever. If logging does not survive a week unrewarded, the tracking
model is wrong and more features will not rescue it. Fix that before continuing.

### Phase 2 — The planner · 3–4 days
Capacity model, the engine of §3 as tested pure functions, today's cross-subject plan,
at-risk detection with options, behind-and-ahead state, recomputation on every write.
**Gate:** engine unit tests pass, including a deliberately infeasible fixture.

### Phase 3 — Gamification · 2–3 days
`xp_events` ledger, levels, streaks with freezes and rest day, daily goal ring,
completion micro-animations, the eight achievements.
**Gate:** deleting a `work_log` row correctly reverses XP, progress and streak.

### Phase 4 — Time and calendar · 3–4 days
Timetable, capacity derived from school hours, exams, countdowns, the exam ramp,
calendar month and agenda views.
**Gate:** a school day with six lessons automatically lowers that day's budget.

### Phase 5 — Focus and statistics · 3–4 days
Timer sessions, session summaries, weekly statistics from the ledgers, Recharts
graphs, per-subject breakdown, and **learned `minutes_per_unit`** from real sessions.
**Gate:** estimates measurably converge toward actual time after two weeks of data.

### Phase 6 — Polish and real product · 3–5 days
Installable PWA, offline log queue with sync, empty and loading and error states,
dark mode audit, upgrade from anonymous to permanent account, notifications,
mobile responsiveness pass.
**Gate:** logging works with the phone in airplane mode and syncs on reconnect.

**Total: roughly 16 to 24 working days.** At two to three hours a day that is five to
eight weeks, not two to four. The original two-to-four-week estimate holds only for
full-time days with the cuts in §7 applied.

---

## 7. Explicitly cut from v1

**Progress map / skill tree.** It needs a curriculum taxonomy per subject per grade
level. That is content work, not engineering, and it is a large hidden cost that
produces nothing until it is complete. Deferred to v2, and when it returns it should
be **user-authored** — the student writes their own topic chain — rather than shipped
as built-in curriculum data.

**AI planning.** The deterministic engine of §3 covers the great majority of real
cases, is debuggable, is free, and works offline. An AI planner that produces a
different schedule on each run destroys trust in exactly the number the app exists
to provide.

**But AI has a much better job in this app: parsing input, not making decisions.**

```
"30 math exercises for Friday and a science test Tuesday"
   ↓
[{subject: Math, units: 30, due: 2026-09-11},
 {subject: Science, kind: exam, date: 2026-09-15}]
```

That collapses quick-add to a single sentence, is trivially verifiable by the user
before saving, and is worth adding in phase 6. Planning stays deterministic.

**Social features, sharing, leaderboards.** Not in scope. A single-player tool that
works beats a social one that nobody's classmates joined.

---

## 8. Scores, honestly

| Element | Score (out of 10) | Comment |
|---|---|---|
| Core idea: one cross-subject daily number | 8.5 | Genuinely useful, genuinely underserved |
| Workload calculator as originally specified | 4 | Plain division ignores every other obligation |
| The same calculator as specified in §3 | 8 | Shared capacity plus honest infeasibility |
| Gamification layer | 5 | Competent and borrowed; does not address the real risk |
| Progress map | 3 | Content cost disguised as a feature |
| AI planning as proposed | 4 | Wrong job for AI here |
| AI parsing as proposed in §7 | 8 | Cheap, verifiable, removes real friction |
| Technology choices | 8 | Sensible and boring, which is correct |
| Scope discipline of the original brief | 3 | Nineteen sections, six of them are the product |
| The brief overall | 6 | Strong instinct, plan too wide, one blind spot |

The blind spot, restated once because it decides whether this app lives:
**the enemy is logging friction, not lack of motivation.**

---

## 9. First commit after this document

1. `npx create-next-app` with TypeScript and Tailwind.
2. Supabase project, migration `0001_init.sql` with all tables and RLS.
3. `lib/engine/schedule.ts` with the §3 algorithm and its test file — written before
   any screen, because it is the product.
4. Home screen reading real data.
