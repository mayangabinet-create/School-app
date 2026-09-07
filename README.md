# School app — homework tracker

Photograph a worksheet, get a checklist, and be told what to do today.

It does one thing the calendar in a phone does not: it reads the page. The
exercises on a photographed worksheet become rows you tick off, and the app
divides what is left by the days remaining, so "eight exercises by Thursday"
becomes "three of these today".

It does not explain the exercises. That is a different product, and it costs
real money per item.

## Does it need a model at all?

Mostly not, and the architecture says so out loud.

A worksheet numbers its own exercises, and that numbering is the author stating
where each one begins — in the document, for free. `split.mjs` reads it: it
collects every candidate marker (`1.`, `א)`, `תרגיל 3`, `Question 12`) and then
keeps only the longest ASCENDING run of them, which is what throws away the page
number, the year inside a word problem, the price in a shopping question, and the
character OCR read as `8.`. None of those fit the sequence the real exercises
make.

That runs first, always. On the fixture set in `tests/fixtures/worksheets.mjs`
it splits 10 of the 13 pages that have exercises exactly, gets a fourth partly
right, and declines on two — a page with no numbering at all, and a page with a
single exercise. Those numbers are a regression guard and not a measurement:
the pages were written to exercise the splitter, so only real photographed
worksheets can say how it does in the field.

The model does the two things that are left:

- **`extract`** reads a page the splitter could not — an unnumbered one. Expensive,
  and rare.
- **`rate`** is handed the list the splitter already produced and asked only how
  much work each exercise is. Short input, one number out — a fifth of what
  `extract` can cost at their respective budgets, and about a sixth on a typical
  page. A judgement is the thing a regular expression genuinely cannot make.

So the ordinary page costs one cheap call rather than one expensive one, and a
page with no network costs nothing and still becomes a checklist.

## Architecture

Four rules, carried over from the project this one reuses:

1. **The model chooses, the app computes, the student decides.** The model says
   how much work an exercise is. Pace, days remaining, percent complete, and the
   sort are arithmetic, and those are the app's job — a model asked to divide 17
   by 4 is confidently wrong often enough to matter, and nothing downstream
   catches it. Asking one "what should I start with" would give an answer that
   sounds reasonable, changes between calls, and cannot be checked.

   Which order to sort by is neither of theirs. Easiest first suits somebody
   stuck on starting; page order suits a worksheet whose exercises build on each
   other; hardest first suits somebody already sitting down. Each is defensible
   and none is correct, so the student picks and the app answers the question
   they actually asked: which exercise is first, and why that one.
2. **The pure rules live in files with no I/O**, and the tests import the file
   that ships. `lib/policy.mjs`, `lib/worksheet.mjs`, `lib/pace.mjs`. No
   `fetch`, no Deno, no `window`, no Supabase — so the same file is read by the
   Edge Function, by the browser, and by `node --test` without a mock in sight.
3. **The server is the authority.** The browser holds a copy of the quota
   numbers to shape its UI. The Edge Function holds the copy that decides,
   because a modified client can send any request it likes.
4. **Fail closed, never break the screen.** If exercise detection returns
   nothing, or nonsense, the student lands on a manual-entry list — never on an
   empty screen with no way forward. Detection is never perfect; the correction
   step is not optional.

## Cost

Every AI-calling feature has a **monthly** quota, written before the first call
was made, and a much smaller daily backstop against a runaway retry loop. One
feature exists today (`extract`), and `tests/policy.test.mjs` fails the build if
a second one is ever added without its own quota row, or if the priced worst
case per user per month stops being small.

## Tests

```
npm test              # the pure rules and the source guards: node --test
npm run typecheck
npm run build
./tests/db/run.sh     # RLS and quota, against a real Postgres
```

Those four commands are exactly what CI runs, so a green run means what a clean
checkout means.

`tests/db/run.sh` needs a Postgres it can create a database in; point it at one
with `PGHOST`, `PGPORT`, `PGUSER`. It applies every migration in order to a
throwaway database, then runs the suites.

The charts on the progress screen are built from divs and design tokens rather
than a charting library: seven columns and six rows do not need a hundred
kilobytes of JavaScript, and a library's palette would have to be re-themed to
follow these tokens anyway. The difficulty ramp is ordinal — one hue, five steps,
light to dark — and was checked with a validator rather than by eye, in both
themes. The obvious version of it failed: its light end sat at 1.49:1 against
the card, below the 2:1 floor, and the ramp had to be darkened.

`tests/source.test.mjs` is the odd one: it reads the repository rather than
calling it. Rules that a review has to catch by eye every time — a raw-HTML
render, a hard-coded colour, a quota number typed into a screen, a CDN host the
CSP does not allow, a bare `auth.uid()` in a policy — are checked by scanning
the source, because eventually a review does not catch one.

## Layout

```
supabase/functions/_shared/policy.mjs      quotas, model choice, clamping, pricing
supabase/functions/_shared/worksheet.mjs   the prompt, the gate, output parsing
supabase/functions/_shared/pace.mjs        calendar-day arithmetic, the pace calculator
lib/{policy,worksheet,pace}.mjs            one-line re-exports of the above
supabase/functions/_shared/split.mjs       the offline splitter — no model, no network
supabase/functions/_shared/order.mjs       the three orders, and which exercise is first
supabase/functions/_shared/progress.mjs    how many you have done, and the streak
lib/extract/                               pdf.js and Tesseract, lazily, in the browser
lib/ai.ts                                  the call to the proxy, with its watchdog
app/                                       Next.js App Router screens
supabase/migrations/                       schema, RLS, quota functions
tests/                                     node --test suites; SQL suites in tests/db
```

The three rules modules live inside the Edge Function's deploy unit and are
re-exported from `lib/` for ergonomic imports. A re-export has no content, so
it cannot drift from what it re-exports — which is the whole point.

## Setup

1. `cp .env.example .env.local` and fill in the two Supabase values.
2. Apply `supabase/migrations/` in order.
3. Deploy `supabase/functions/ai-proxy`, with `ANTHROPIC_API_KEY` and
   `APP_ORIGIN` set on it. The service-role key is provided by Supabase.
4. `npm run dev`.

Sign-in is a link in an email and no password, which is also the only abuse
protection in place: an account cannot exist until somebody opens a message at
that address. There is no analytics and no CAPTCHA yet — see "Not built" below.

## Not built

Stated rather than implied, so nobody has to read the tree to find out:

- **Phases 2 to 4.** The pace calculator, the progress screen and the streak
  exist and are tested; the calendar, the weekly timetable, exam countdowns and
  XP do not. `exam`, `timetable_slot` and `user_stats` are in the schema and
  unused — the streak on the progress screen is computed from the exercise
  timestamps rather than stored, so it cannot go stale.
- **Analytics.** None. Which means there is no conversion rate, no drop-off,
  and no way to check the assumption the quota rests on — that most students
  never come near it. This should exist before the app is publicised, not after.
- **Class sharing.** The tables and the policies are there and tested; no
  screen reads them.
- **Payments.** Deliberately absent. If they are ever added: open the account
  with the provider, read that provider's own documentation, and put one
  sandbox transaction through end to end BEFORE writing the integration.
