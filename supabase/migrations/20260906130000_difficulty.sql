-- =====================================================================
-- How much work an exercise is.
--
-- Nullable, and null is not a synonym for average.  An exercise that has
-- not been rated — the rating call failed, or the student typed the row
-- in by hand — is a different thing from one a model looked at and called
-- ordinary, and the ordering treats them differently: unrated exercises
-- sort after every rated one, in page order, rather than into the middle
-- of a list they were never judged against.
--
-- The range lives in the CHECK here and in DIFFICULTY in worksheet.mjs,
-- which is the one place the five levels are named and the only place the
-- prompt's scale is generated from.  A sixth level would be one edit
-- there plus this constraint, and nothing else.
-- =====================================================================

alter table public.assignment_item
  add column difficulty smallint
    check (difficulty is null or difficulty between 1 and 5);

-- The ordering reads "the undone ones, easiest first", on one assignment at
-- a time.  Partial on done_at because a finished exercise never appears in
-- that query and there is no reason to carry it in the index.
create index assignment_item_next_up_idx
  on public.assignment_item (assignment_id, difficulty, position)
  where done_at is null;

-- The progress screen reads "everything I have ever ticked, by day".  It
-- crosses assignments, so it cannot use the index above.
create index assignment_item_done_idx
  on public.assignment_item (assignment_id, done_at)
  where done_at is not null;
