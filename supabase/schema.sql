-- Applied to project tkldxfpzfmbojfxujlkx in the SQL editor. Safe to run again.
-- Campus Filing: saved plans and account deletion.
-- One saved set of walkthrough answers per student per tax year.

create table if not exists public.saved_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tax_year    smallint not null check (tax_year between 2020 and 2100),
  answers     jsonb not null check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 65536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, tax_year)
);

alter table public.saved_plans enable row level security;

drop policy if exists "Students read their own plans" on public.saved_plans;
drop policy if exists "Students add their own plans" on public.saved_plans;
drop policy if exists "Students update their own plans" on public.saved_plans;
drop policy if exists "Students delete their own plans" on public.saved_plans;

create policy "Students read their own plans" on public.saved_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Students add their own plans" on public.saved_plans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Students update their own plans" on public.saved_plans
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Students delete their own plans" on public.saved_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.saved_plans from anon, public;
grant select, insert, update, delete on public.saved_plans to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists saved_plans_touch on public.saved_plans;
create trigger saved_plans_touch before update on public.saved_plans
  for each row execute function public.touch_updated_at();

-- Lets a signed-in student delete their own account without a service key.
-- Saved plans go with it through the foreign key.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Default privileges also hand out TRUNCATE, which ignores Row Level Security.
revoke truncate, references, trigger on public.saved_plans from authenticated, anon, public;
