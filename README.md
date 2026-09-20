# School Planner

A clean, English school workspace for tasks, deadlines, weekly classes, notes, exam preparation and progress.

**Live site:** https://mayangabinet-create.github.io/School-app/

## Features

- Create, edit, complete, reopen and delete tasks.
- Enter a deadline manually or choose it with the date picker.
- Automatic urgency from the deadline, plus student-controlled importance.
- Weekly workload based on unfinished tasks and estimated minutes.
- Editable weekly timetable with custom periods and breaks.
- Subject notes and a prepare-for-tomorrow bag checklist.
- Exams with study topics and preparation dates.
- Completion statistics and progress rings.
- Device-only storage without an account, or private cross-device saving through Supabase.

The app intentionally has no AI and no focus timer.

## Run locally

Requires Node.js 22.18 or newer.

```bash
npm ci
npm test
npm run typecheck
npm run dev
```

Open `http://localhost:3000`.

## Build and publish

```bash
npm run build
```

Next.js creates a static export in `out/`. Every push to `main` runs `.github/workflows/pages.yml`, which tests the project, builds it with the `/School-app` repository path, verifies the exported pages and publishes them to GitHub Pages.

GitHub Pages must use **GitHub Actions** as its publishing source.

## Data and authentication

The planner uses the Supabase project `School app` (`zmrwxspnydeckckworkp`). The browser contains only the public publishable key; no service-role or secret key is shipped.

Signed-in data is stored in `public.planner_workspace`. Row Level Security restricts each user to their own row. Anonymous device-only data stays in browser storage and is not silently uploaded when signing in.

For email sign-in, Supabase Authentication must allow this redirect URL:

```text
https://mayangabinet-create.github.io/School-app/auth/callback/
```

## Main files

- `components/Planner.tsx` — the main product UI.
- `components/planner.css` — the planner design and responsive layout.
- `lib/planner.ts` — planner types, validation, urgency and ranking.
- `lib/use-planner.ts` — device and Supabase persistence.
- `supabase/migrations/20260919102055_planner_workspace.sql` — private workspace table and RLS policies.
- `scripts/check-export.mjs` — verifies the GitHub Pages build before publishing.

## Current limits

- No notifications, attachments, calendar integration or offline cloud editing.
- Device-only data is lost if browser storage is cleared.
- Cloud changes made on another device require a refresh.
- The timetable uses shared period times across the week.
