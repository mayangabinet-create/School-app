-- =====================================================================
-- Which exercise to start with is the student's choice, not the app's.
--
-- Easiest first suits somebody stuck on starting.  Page order suits a
-- worksheet whose exercises build on each other, where skipping ahead
-- costs more than it saves.  Hardest first suits somebody already sitting
-- down with a clear head.  Each is defensible and none is correct, so the
-- app stores which one was picked rather than deciding.
--
-- The allowed values here must match ORDER_VALUES in order.mjs, which is
-- also where the picker gets its labels.  A value the constraint rejects
-- fails to save with no explanation the student can act on, and a value
-- the UI has no label for renders as a blank button — so a test compares
-- this list against that module rather than trusting two lists to stay in
-- step.
--
-- NOT NULL with a default rather than nullable, because "no preference"
-- and "easiest first" are the same thing to every reader, and a nullable
-- column would make every one of them write the coalesce.
-- =====================================================================

alter table public.user_stats
  add column exercise_order text not null default 'easiest'
    check (exercise_order in ('easiest', 'page', 'hardest'));
