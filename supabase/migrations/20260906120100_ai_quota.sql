-- =====================================================================
-- AI quota: reserve, record, release
--
-- The server decides.  The browser carries a copy of the limits so it can
-- grey out a button and say "8 left this month", but a modified client can
-- send whatever it likes, so nothing here trusts a number that came from
-- one.  The limits themselves are passed in by the Edge Function, which
-- reads them from lib/policy.mjs — the same file the tests import and the
-- same file the browser imports.  One source, three readers.
--
-- Quota is spent by RESERVING before the call and RECORDING after it.
-- Counting only completed calls would let a client fire fifty requests in
-- parallel, all of which pass a check none of them has yet affected.
-- =====================================================================

-- Windows are calendar windows in the student's own zone, not UTC ones.
-- A single zone is honest for this product's audience; when that stops
-- being true it becomes a column on user_stats and this constant becomes
-- a lookup, and nothing else changes.
create or replace function public.app_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;

-- ---------------------------------------------------------------- reserve

create or replace function public.consume_ai_quota(
  p_user_id   uuid,
  p_task      text,
  p_per_month int,
  p_per_day   int,
  p_model     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today       date := public.app_today();
  v_month_start date := date_trunc('month', v_today)::date;
  v_month       int;
  v_day         int;
  v_id          uuid;
begin
  if p_per_month is null or p_per_day is null or p_per_month <= 0 or p_per_day <= 0 then
    -- A caller that forgot to pass limits must not be treated as unlimited.
    -- This is the shape of the previous project's most expensive bug.
    return jsonb_build_object('ok', false, 'code', 'no_quota_configured');
  end if;

  -- Serialise this user's calls for this task.  Without it, two requests
  -- that arrive together both count 29 of 30 and both proceed.  Held to
  -- the end of the transaction, so it is released whether we commit or
  -- fail.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_task, 0));

  select
    count(*) filter (where day >= v_month_start),
    count(*) filter (where day = v_today)
  into v_month, v_day
  from public.ai_usage
  where user_id = p_user_id and task = p_task;

  if v_month >= p_per_month then
    return jsonb_build_object(
      'ok', false, 'code', 'month_quota',
      'used_this_month', v_month, 'per_month', p_per_month);
  end if;

  if v_day >= p_per_day then
    return jsonb_build_object(
      'ok', false, 'code', 'day_quota',
      'used_today', v_day, 'per_day', p_per_day);
  end if;

  insert into public.ai_usage (user_id, task, model, day)
  values (p_user_id, p_task, p_model, v_today)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'usage_id', v_id,
    'used_this_month', v_month + 1, 'per_month', p_per_month);
end;
$$;

-- ---------------------------------------------------------------- record

create or replace function public.record_ai_usage(
  p_usage_id uuid,
  p_input    int,
  p_output   int,
  p_cost     int,
  p_ok       bool
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.ai_usage
  set input_tokens = greatest(0, coalesce(p_input, 0)),
      output_tokens = greatest(0, coalesce(p_output, 0)),
      cost_microcents = greatest(0, coalesce(p_cost, 0)),
      ok = p_ok
  where id = p_usage_id;
$$;

-- ---------------------------------------------------------------- release

-- For the one case where a reservation should not have been spent: the
-- request never reached the model, so no tokens exist and nothing was
-- paid for.  Guarded on the token counts being untouched, so it can never
-- refund a call that actually ran.
create or replace function public.release_ai_quota(p_usage_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.ai_usage
  where id = p_usage_id
    and input_tokens = 0
    and output_tokens = 0;
$$;

-- These three are the service role's, called from the Edge Function.  A
-- browser holding an anon or user token must never reach them: the whole
-- point of reserving server-side is that the client cannot mint quota.
revoke all on function public.consume_ai_quota(uuid, text, int, int, text) from public, anon, authenticated;
revoke all on function public.record_ai_usage(uuid, int, int, int, bool) from public, anon, authenticated;
revoke all on function public.release_ai_quota(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- reporting

-- What the student has spent, for their own screen.  security INVOKER on
-- purpose: it answers for whoever is asking and for nobody else, which
-- the RLS policy on ai_usage already enforces.  It returns counts only —
-- the limits live in policy.mjs, so there is exactly one place to change
-- a number a person reads.
create or replace function public.my_ai_usage(p_task text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'task', p_task,
    'used_this_month', count(*) filter (where day >= date_trunc('month', public.app_today())::date),
    'used_today', count(*) filter (where day = public.app_today())
  )
  from public.ai_usage
  where user_id = (select auth.uid()) and task = p_task;
$$;

grant execute on function public.my_ai_usage(text) to authenticated;
grant execute on function public.app_today() to authenticated, service_role;
