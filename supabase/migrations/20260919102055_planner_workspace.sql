create table public.planner_workspace (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object' and state->>'version' = '2'),
  revision bigint not null default 1 check (revision > 0),
  check (octet_length(state::text) <= 2097152)
);
alter table public.planner_workspace enable row level security;
revoke all on public.planner_workspace from anon;
grant select, insert, update, delete on public.planner_workspace to authenticated;
create policy planner_select on public.planner_workspace for select to authenticated using ((select auth.uid()) = user_id);
create policy planner_insert on public.planner_workspace for insert to authenticated with check ((select auth.uid()) = user_id);
create policy planner_update on public.planner_workspace for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy planner_delete on public.planner_workspace for delete to authenticated using ((select auth.uid()) = user_id);
