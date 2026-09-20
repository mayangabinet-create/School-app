# School Planner v2

This branch keeps the original project in Git history and replaces the home screen with an English school workspace. Remote main has not been updated.

## Included
- Task creation, editing, deletion, completion/reopening, search, deadline picker and manual input.
- Automatic urgency (overdue, within 24h, within 72h, later) and manually chosen importance.
- Editable weekly timetable with shared time periods, seven day columns and breaks; overlapping periods are rejected.
- Subject-linked notebook and bring-to-class checklist, automatically assembled for tomorrow.
- Weekly deadline workload calculated from unfinished task estimates.
- Exams with manually planned study topics and completion checkboxes.
- On-device mode and separate private Supabase account mode. Device data is not silently uploaded.

## Data and security
New project: School app (`zmrwxspnydeckckworkp`). No other Supabase projects are used.
Only the new planner_workspace migration is required in this fresh project. The older migrations are legacy worksheet-app migrations; do not deploy those for this planner.
The workspace is one JSON document per user, protected by four owner-only RLS policies and indexed by its primary key. Revision-checked updates detect competing device edits instead of silently overwriting them. This deliberately simple storage suits a personal planner; large/team usage should move to normalized per-item tables.
The repository contains only the project's public publishable key, never a secret/service-role key. Environment variables can override the project settings, but URL and key must always be changed together.
The legacy scan, progress and assignment URLs redirect home; no AI feature is offered or called by the planner.

## Run and publish
Use Node 22.18+ or 24. Run `npm ci`, `npm test`, `npm run typecheck`, then `npm run build`.
The app is statically exported and published to GitHub Pages by `.github/workflows/pages.yml`.
In the new Supabase project's Authentication URL Configuration, allow `https://mayangabinet-create.github.io/School-app/auth/callback/`. The browser exchanges the PKCE code on the static callback page. For local testing allow `http://localhost:3000/auth/callback/`.
Default Supabase email delivery can restrict recipients/rates. Full real-user email sign-in and multi-device saving must be tested after an origin and email delivery are configured. No real user emails were sent during development.

## Known limits
No AI, realtime subscription, offline cloud edits, attachments or calendar integration. Refresh the page to pull cloud changes made on another device. Device-only storage is lost if browser storage is cleared. The timetable shares period boundaries across days. Deadline values use device-local time. All progress statistics are based on retained tasks, so deleting a completed task removes it from those totals.
