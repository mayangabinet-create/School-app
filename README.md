# School app — homework tracker

Photograph a worksheet, get a checklist, and be told what to do today.

It does one thing the calendar in a phone does not: it reads the page. The
exercises on a photographed worksheet become rows you tick off, and the app
divides what is left by the days remaining, so "eight exercises by Thursday"
becomes "three of these today".

It does not explain the exercises. That is a different product, and it costs
real money per item.

## Architecture

Four rules, carried over from the project this one reuses:

1. **The model chooses, the app computes.** The model says which exercises are
   on the page. Pace, days remaining and percent complete are arithmetic, and
   arithmetic is the app's job — a model asked to divide 17 by 4 is
   confidently wrong often enough to matter, and nothing downstream catches it.
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

- **Phases 2 to 4.** The pace calculator exists and is tested; the calendar,
  the weekly timetable, exam countdowns, XP and streaks do not. `exam`,
  `timetable_slot` and `user_stats` are in the schema and unused.
- **Analytics.** None. Which means there is no conversion rate, no drop-off,
  and no way to check the assumption the quota rests on — that most students
  never come near it. This should exist before the app is publicised, not after.
- **Class sharing.** The tables and the policies are there and tested; no
  screen reads them.
- **Payments.** Deliberately absent. If they are ever added: open the account
  with the provider, read that provider's own documentation, and put one
  sandbox transaction through end to end BEFORE writing the integration.
