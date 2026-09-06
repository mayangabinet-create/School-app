-- =====================================================================
-- Homework tracker — initial schema
--
-- Two decisions are visible in every table here and are worth stating
-- once rather than re-deriving from the columns:
--
-- 1. DEADLINES ARE CALENDAR DAYS, NOT INSTANTS.  Every due date, exam
--    date and activity date is `date`, never `timestamptz`.  Homework is
--    due "Thursday", and storing 2026-09-10T00:00:00Z forces every
--    reader to pick a time zone to render it in — which is how an
--    assignment comes to look overdue on Wednesday evening.  The one
--    place a wall clock genuinely matters is a timetable slot's start
--    and end, which are `time` for the same reason.
--
-- 2. A CLASS IS IN THE SCHEMA BUT NOT IN THE PRODUCT.  `class` and
--    `class_member` exist, and `assignment.class_id` exists, from the
--    first day.  Nothing in the UI reads or writes them yet.  Adding a
--    nullable column now is nearly free; adding a sharing model to a
--    table that already holds a year of a student's homework is a
--    migration with real risk.  The RLS policies below already handle
--    the shared case, so turning it on later is a UI change.
--
-- Every owner-scoped policy uses `(select auth.uid())` rather than a
-- bare `auth.uid()`.  Postgres re-evaluates a bare call once per row
-- scanned; wrapped in a scalar subquery it runs once per query.  It
-- changes nothing about who can read what, and it is the difference
-- between a policy that stays fast on a year of rows and one that does
-- not.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- class

create table public.class (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  join_code   text unique,
  created_at  timestamptz not null default now()
);

create table public.class_member (
  class_id    uuid not null references public.class (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'student' check (role in ('student', 'teacher')),
  joined_at   timestamptz not null default now(),
  primary key (class_id, user_id)
);

create index class_member_user_idx on public.class_member (user_id);

-- Membership is asked about inside the assignment policies, so it has to
-- be answerable without those policies recursing back into it.
create or replace function public.is_class_member(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.class_member m
    where m.class_id = p_class_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_class_member(uuid) from public;
grant execute on function public.is_class_member(uuid) to authenticated;

-- ---------------------------------------------------------------- subject

create table public.subject (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  colour      text not null default '#6366f1'
                check (colour ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index subject_user_idx on public.subject (user_id);

-- ---------------------------------------------------------------- assignment

create table public.assignment (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  class_id    uuid references public.class (id) on delete set null,
  subject_id  uuid references public.subject (id) on delete set null,
  title       text not null check (length(btrim(title)) between 1 and 200),

  -- How the item list got here.  'manual' is not a failure mode: it is
  -- where a student lands whenever detection returns nothing, and it has
  -- to be an ordinary, first-class value rather than a marker of a
  -- degraded row.
  source_kind text not null default 'manual'
                check (source_kind in ('photo', 'pdf', 'manual')),

  due_on      date,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create index assignment_user_open_idx
  on public.assignment (user_id, due_on)
  where archived_at is null;
create index assignment_class_idx on public.assignment (class_id) where class_id is not null;

-- ---------------------------------------------------------------- items

create table public.assignment_item (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignment (id) on delete cascade,

  -- The order the exercises appear on the page.  This is the single
  -- thing the extraction prompt is written to protect, so it is stored
  -- explicitly and never inferred from insertion order or from an id.
  position      int not null check (position > 0),

  label         text not null check (length(label) between 1 and 120),
  body          text not null default '' check (length(body) <= 2000),

  -- The model said it was guessing at this line.  Kept after the
  -- correction screen so a row the student confirmed is distinguishable
  -- from one they never looked at.
  uncertain     bool not null default false,

  -- Nullable rather than a boolean, because "when" is worth having and
  -- costs nothing: it is what a per-day progress view is built from.
  done_at       timestamptz,

  unique (assignment_id, position) deferrable initially deferred
);

create index assignment_item_assignment_idx on public.assignment_item (assignment_id, position);

-- ---------------------------------------------------------------- timetable

create table public.timetable_slot (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid references public.subject (id) on delete cascade,
  -- 0 = Sunday, matching the Israeli school week.
  weekday     smallint not null check (weekday between 0 and 6),
  starts_at   time not null,
  ends_at     time not null,
  check (ends_at > starts_at)
);

create index timetable_slot_user_idx on public.timetable_slot (user_id, weekday);

-- ---------------------------------------------------------------- exams

create table public.exam (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid references public.subject (id) on delete set null,
  title       text not null check (length(btrim(title)) between 1 and 200),
  on_date     date not null,
  topics      text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index exam_user_idx on public.exam (user_id, on_date);

-- ---------------------------------------------------------------- stats

create table public.user_stats (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  xp             int not null default 0 check (xp >= 0),
  streak_count   int not null default 0 check (streak_count >= 0),

  -- Streak protection, in the schema before the streak is in the
  -- product, because a streak that can be lost outright is a punishment
  -- and this app does not punish.  Missing one day spends a shield; it
  -- does not erase a month.
  streak_shields int not null default 2 check (streak_shields >= 0),

  last_active_on date,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- metering

-- One row per AI call, whether or not it succeeded, so cost per user is
-- observable before it is a surprise on a bill.  `day` is stored rather
-- than derived from `created_at` because the quota windows below are
-- calendar windows in the student's zone, not UTC ones.
create table public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  task           text not null,
  model          text,
  day            date not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  cost_microcents int not null default 0,
  ok             bool,
  created_at     timestamptz not null default now()
);

create index ai_usage_quota_idx on public.ai_usage (user_id, task, day);

-- =====================================================================
-- Row level security
-- =====================================================================

alter table public.class            enable row level security;
alter table public.class_member     enable row level security;
alter table public.subject          enable row level security;
alter table public.assignment       enable row level security;
alter table public.assignment_item  enable row level security;
alter table public.timetable_slot   enable row level security;
alter table public.exam             enable row level security;
alter table public.user_stats       enable row level security;
alter table public.ai_usage         enable row level security;

-- class ---------------------------------------------------------------
create policy class_read on public.class for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_class_member(id));
create policy class_write on public.class for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy class_member_read on public.class_member for select to authenticated
  using (user_id = (select auth.uid()) or public.is_class_member(class_id));
create policy class_member_leave on public.class_member for delete to authenticated
  using (user_id = (select auth.uid()));

-- subject -------------------------------------------------------------
create policy subject_own on public.subject for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- assignment ----------------------------------------------------------
-- Reading allows the shared case the schema is ready for; writing never
-- does.  A student cannot edit an assignment they merely received.
create policy assignment_read on public.assignment for select to authenticated
  using (
    user_id = (select auth.uid())
    or (class_id is not null and public.is_class_member(class_id))
  );
create policy assignment_write on public.assignment for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- items ---------------------------------------------------------------
-- Ownership lives on the parent, so every policy here is an EXISTS
-- against it.  `(select auth.uid())` inside the subquery for the same
-- per-row-evaluation reason as everywhere else.
create policy assignment_item_read on public.assignment_item for select to authenticated
  using (exists (
    select 1 from public.assignment a
    where a.id = assignment_id
      and (a.user_id = (select auth.uid())
           or (a.class_id is not null and public.is_class_member(a.class_id)))
  ));
create policy assignment_item_write on public.assignment_item for all to authenticated
  using (exists (
    select 1 from public.assignment a
    where a.id = assignment_id and a.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.assignment a
    where a.id = assignment_id and a.user_id = (select auth.uid())
  ));

-- the rest ------------------------------------------------------------
create policy timetable_slot_own on public.timetable_slot for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy exam_own on public.exam for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_stats_own on public.user_stats for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Readable so the UI can show "18 of 30 left this month" from the same
-- rows the server counts.  Never writable from a client: quota is not a
-- number the browser gets to have an opinion about.
create policy ai_usage_read on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- signup

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_stats (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
