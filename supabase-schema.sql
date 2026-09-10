-- 在 Supabase Dashboard -> SQL Editor 中完整执行本文件。

create table if not exists public.user_learning_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_learning_state enable row level security;

drop policy if exists "Users can read their own LearnHub data" on public.user_learning_state;
create policy "Users can read their own LearnHub data"
on public.user_learning_state for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own LearnHub data" on public.user_learning_state;
create policy "Users can insert their own LearnHub data"
on public.user_learning_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own LearnHub data" on public.user_learning_state;
create policy "Users can update their own LearnHub data"
on public.user_learning_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.user_learning_state from anon;
grant select, insert, update on table public.user_learning_state to authenticated;

create or replace function public.set_learnhub_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_learnhub_updated_at on public.user_learning_state;
create trigger set_learnhub_updated_at
before update on public.user_learning_state
for each row execute function public.set_learnhub_updated_at();
