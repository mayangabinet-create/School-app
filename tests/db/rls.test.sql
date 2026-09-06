-- =====================================================================
-- What the policies actually do, run against a real Postgres.
--
-- These are not a restatement of the migration in another language: each
-- one is a thing a modified client could try. The point of RLS is that
-- reaching another student's homework is impossible rather than merely
-- not implemented in the UI.
-- =====================================================================

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dana@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'noa@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'teacher@example.com');

-- Seed as the owner of the data, through the API role, so the WITH CHECK
-- clauses are exercised on the way in too.
set role authenticated;
select become('11111111-1111-1111-1111-111111111111');

insert into public.subject (id, user_id, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'מתמטיקה');

insert into public.assignment (id, user_id, subject_id, title, source_kind, due_on)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-0000-0000-0000-000000000001',
          'דף עבודה — משוואות', 'photo', current_date + 3);

insert into public.assignment_item (assignment_id, position, label, body)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 1, 'תרגיל 1', '2x+5=13'),
         ('bbbbbbbb-0000-0000-0000-000000000001', 2, 'תרגיל 2', '3(x-4)=9');

select assert_eq((select count(*)::int from public.assignment), 1, 'owner sees their own assignment');
select assert_eq((select count(*)::int from public.assignment_item), 2, 'owner sees their own items');

-- ---------------------------------------------------------------------
-- Another student is not merely unlisted; they are invisible.
-- ---------------------------------------------------------------------
select become('22222222-2222-2222-2222-222222222222');

select assert_eq((select count(*)::int from public.assignment), 0, 'another student sees no assignments');
select assert_eq((select count(*)::int from public.assignment_item), 0, 'another student sees no items');
select assert_eq((select count(*)::int from public.subject), 0, 'another student sees no subjects');

-- An UPDATE that matches no visible row silently affects nothing, which is
-- the correct behaviour and the easy one to mistake for a policy working
-- when it is not. Assert the row is genuinely unchanged.
update public.assignment_item set done_at = now();
select become('11111111-1111-1111-1111-111111111111');
select assert_eq((select count(*)::int from public.assignment_item where done_at is not null), 0,
                 'another student cannot tick off somebody else''s exercise');

-- Claiming somebody else's user_id on the way in is refused by WITH CHECK.
select become('22222222-2222-2222-2222-222222222222');
select assert_denied(
  $$insert into public.assignment (user_id, title)
    values ('11111111-1111-1111-1111-111111111111', 'planted')$$,
  'a student cannot create an assignment owned by someone else');

select assert_denied(
  $$insert into public.assignment_item (assignment_id, position, label)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 3, 'planted')$$,
  'a student cannot add an exercise to someone else''s assignment');

-- ---------------------------------------------------------------------
-- The class case the schema is ready for: shared reads, never shared writes.
-- ---------------------------------------------------------------------
select become('33333333-3333-3333-3333-333333333333');
insert into public.class (id, owner_id, name)
  values ('cccccccc-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333', 'י״א 3');

reset role;
insert into public.class_member (class_id, user_id, role) values
  ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'teacher'),
  ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'student');
set role authenticated;

select become('11111111-1111-1111-1111-111111111111');
update public.assignment set class_id = 'cccccccc-0000-0000-0000-000000000001'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';

select become('22222222-2222-2222-2222-222222222222');
select assert_eq((select count(*)::int from public.assignment), 1, 'a classmate can read a shared assignment');
select assert_eq((select count(*)::int from public.assignment_item), 2, 'a classmate can read its exercises');

update public.assignment set title = 'hijacked' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select become('11111111-1111-1111-1111-111111111111');
select assert_eq((select title from public.assignment where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
                 'דף עבודה — משוואות',
                 'a classmate can read a shared assignment but never edit it');

select become('33333333-3333-3333-3333-333333333333');
select assert_eq((select count(*)::int from public.assignment_item), 2,
                 'the class owner reads through membership, not ownership');

-- Somebody outside the class still sees nothing.
select become('00000000-0000-0000-0000-000000000000');
select assert_eq((select count(*)::int from public.assignment), 0, 'a non-member sees nothing shared');

-- ---------------------------------------------------------------------
-- Quota is not something a client gets to have an opinion about.
-- ---------------------------------------------------------------------
select assert_denied(
  $$select public.consume_ai_quota('11111111-1111-1111-1111-111111111111'::uuid, 'extract', 999, 999, 'm')$$,
  'a signed-in client cannot reserve its own quota');
select assert_denied(
  $$select public.record_ai_usage(gen_random_uuid(), 1, 1, 1, true)$$,
  'a signed-in client cannot write a usage row');
select assert_denied(
  $$select public.release_ai_quota(gen_random_uuid())$$,
  'a signed-in client cannot refund its own quota');
select assert_denied(
  $$insert into public.ai_usage (user_id, task, day)
    values ('22222222-2222-2222-2222-222222222222', 'extract', current_date)$$,
  'a signed-in client cannot insert a usage row directly');

reset role;

do $$
declare
  u uuid := '11111111-1111-1111-1111-111111111111';
  r jsonb;
  first_id uuid;
begin
  -- A limit of 2 a month, 5 a day: the monthly one must bite first.
  r := public.consume_ai_quota(u, 'extract', 2, 5, 'test-model');
  perform assert_eq((r->>'ok')::bool, true, 'first call is allowed');
  first_id := (r->>'usage_id')::uuid;
  perform assert_eq((r->>'used_this_month')::int, 1, 'the reservation counts immediately');

  r := public.consume_ai_quota(u, 'extract', 2, 5, 'test-model');
  perform assert_eq((r->>'ok')::bool, true, 'second call is allowed');

  r := public.consume_ai_quota(u, 'extract', 2, 5, 'test-model');
  perform assert_eq((r->>'ok')::bool, false, 'the third call is over the monthly limit');
  perform assert_eq(r->>'code', 'month_quota', 'and says which limit');

  -- A different task has its own budget and is untouched by this one.
  r := public.consume_ai_quota(u, 'some-other-task', 2, 5, 'test-model');
  perform assert_eq((r->>'ok')::bool, true, 'quotas are per task, not shared');

  -- A reservation nothing was spent against can be released.
  perform public.release_ai_quota(first_id);
  r := public.consume_ai_quota(u, 'extract', 2, 5, 'test-model');
  perform assert_eq((r->>'ok')::bool, true, 'releasing an unused reservation frees a slot');

  -- One that was spent against cannot.
  perform public.record_ai_usage((r->>'usage_id')::uuid, 1200, 800, 1000, true);
  perform public.release_ai_quota((r->>'usage_id')::uuid);
  perform assert_eq(
    (select count(*)::int from public.ai_usage where id = (r->>'usage_id')::uuid), 1,
    'a call that actually ran can never be refunded');
end $$;

do $$
declare
  u uuid := '22222222-2222-2222-2222-222222222222';
  r jsonb;
begin
  -- Generous monthly limit, tight daily one: the backstop must bite.
  r := public.consume_ai_quota(u, 'extract', 100, 2, 'test-model');
  perform assert_eq((r->>'ok')::bool, true, 'day 1 of 2');
  r := public.consume_ai_quota(u, 'extract', 100, 2, 'test-model');
  perform assert_eq((r->>'ok')::bool, true, 'day 2 of 2');
  r := public.consume_ai_quota(u, 'extract', 100, 2, 'test-model');
  perform assert_eq((r->>'ok')::bool, false, 'the daily backstop stops a runaway loop');
  perform assert_eq(r->>'code', 'day_quota', 'and says so');

  -- Yesterday's calls do not count against today.
  update public.ai_usage set day = public.app_today() - 1 where user_id = u;
  r := public.consume_ai_quota(u, 'extract', 100, 2, 'test-model');
  perform assert_eq((r->>'ok')::bool, true, 'the daily window is a day, not a lifetime');

  -- Missing limits are never treated as unlimited.
  perform assert_eq((public.consume_ai_quota(u, 'extract', null, 2, 'm')->>'code'),
                    'no_quota_configured', 'a null monthly limit refuses rather than allows');
  perform assert_eq((public.consume_ai_quota(u, 'extract', 0, 2, 'm')->>'code'),
                    'no_quota_configured', 'a zero limit refuses rather than allows');
  perform assert_eq((public.consume_ai_quota(u, 'extract', -1, 2, 'm')->>'code'),
                    'no_quota_configured', 'a negative limit refuses rather than allows');
end $$;

-- my_ai_usage answers for the caller and for nobody else.
set role authenticated;
select become('11111111-1111-1111-1111-111111111111');
do $$
declare mine int; theirs int;
begin
  mine := (public.my_ai_usage('extract')->>'used_this_month')::int;
  perform become('22222222-2222-2222-2222-222222222222');
  theirs := (public.my_ai_usage('extract')->>'used_this_month')::int;
  perform assert_eq(mine > 0, true, 'a student can read their own usage');
  perform assert_eq(mine <> theirs, true, 'and sees only their own');
end $$;
reset role;

-- ---------------------------------------------------------------------
-- Constraints that keep bad rows out regardless of who writes them.
-- ---------------------------------------------------------------------
do $$
begin
  perform assert_denied(
    $q$insert into public.assignment_item (assignment_id, position, label)
       values ('bbbbbbbb-0000-0000-0000-000000000001', 0, 'x')$q$,
    'position must be positive');
  perform assert_denied(
    $q$insert into public.subject (user_id, name, colour)
       values ('11111111-1111-1111-1111-111111111111', 'x', 'indigo')$q$,
    'colour must be a hex value the UI can actually use');
  perform assert_denied(
    $q$insert into public.assignment (user_id, title, source_kind)
       values ('11111111-1111-1111-1111-111111111111', 'x', 'fax')$q$,
    'source_kind is a closed set');
  perform assert_denied(
    $q$insert into public.timetable_slot (user_id, weekday, starts_at, ends_at)
       values ('11111111-1111-1111-1111-111111111111', 2, '10:00', '09:00')$q$,
    'a lesson cannot end before it starts');
end $$;

-- Deleting the student takes the homework with it.
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select assert_eq((select count(*)::int from public.assignment
                  where user_id = '11111111-1111-1111-1111-111111111111'), 0,
                 'deleting an account removes its assignments');
select assert_eq((select count(*)::int from public.assignment_item), 0,
                 'and the exercises underneath them');

\echo '=== RLS AND QUOTA SUITE PASSED ==='
