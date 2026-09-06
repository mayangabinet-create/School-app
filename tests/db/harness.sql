-- Enough of Supabase's own schema for the migrations to apply and for the
-- policies to be exercised locally. Not a mock of Supabase — just the two
-- objects every migration in this repo actually depends on.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Roles are cluster-wide, so a re-run must not fail on the second database.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- The current request's user, as Supabase exposes it: read from a GUC that
-- the API gateway sets from the verified JWT. Tests set it directly.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Supabase grants the API roles table privileges by default and relies on
-- RLS for the actual authorisation. Reproduced here so the policies are
-- what the tests are testing, rather than a missing GRANT.
alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant all on functions to anon, authenticated;

create or replace function assert_eq(actual anyelement, expected anyelement, what text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — expected %, got %', what, expected, actual;
  end if;
  raise notice 'ok: %', what;
end $$;

create or replace function assert_denied(sql text, what text)
returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL: % — the statement was allowed and should not have been', what;
exception
  when insufficient_privilege or check_violation then
    raise notice 'ok: % (refused)', what;
end $$;

create or replace function become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
end $$;
