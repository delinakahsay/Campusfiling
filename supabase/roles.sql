-- Campus Filing: institutions, roles, and usage reporting.
--
-- Run after schema.sql, in the Supabase SQL editor. Written to be safe to
-- run twice.
--
-- Three things live here.
--
-- Who may sign up. Students self-register and must use a GW address.
-- Staff do not self-register at all: an address has to be listed in
-- staff_invites before it can create an account outside a GW domain, and
-- that listing is also what grants the role. Nobody can sign themselves
-- up as a university administrator, which is the point.
--
-- What an administrator can see. A university administrator gets counts
-- and never contents. This is enforced by not granting any read on
-- saved_plans rather than by declining to ask for one: the reporting
-- function returns aggregates, and the answers column is unreachable
-- from an administrator's session no matter what query they send.
--
-- Everything here follows the same rules as schema.sql: Row Level
-- Security on every table, search_path pinned on every function, and
-- TRUNCATE revoked because the default grant includes it and it ignores
-- row security.

-- ---------------------------------------------------------------- orgs

create table if not exists public.institutions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

-- Coverage, not raw counts, is what the Administrator Usage Report is
-- specified to show: unique students completing a filing plan as a share
-- of total enrollment. That needs a denominator.
alter table public.institutions
  add column if not exists enrollment integer;

update public.institutions
   set enrollment = 25374
 where slug = 'gwu' and enrollment is distinct from 25374;

create table if not exists public.institution_domains (
  domain          text primary key,
  institution_id  uuid not null references public.institutions(id) on delete cascade
);

insert into public.institutions (name, slug)
values ('George Washington University', 'gwu')
on conflict (slug) do nothing;

insert into public.institution_domains (domain, institution_id)
select d, i.id
  from public.institutions i,
       unnest(array['gwu.edu', 'gwmail.gwu.edu']) as d
 where i.slug = 'gwu'
on conflict (domain) do nothing;

-- --------------------------------------------------------------- roles

-- A text column with a check rather than an enum: adding a role later is
-- an ordinary migration instead of an ALTER TYPE.
create table if not exists public.profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  role           text not null default 'student'
                   check (role in ('student', 'university_admin', 'tax_operations')),
  institution_id uuid references public.institutions(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- The name is for addressing someone and for the initials in the header.
-- It is the only thing the product knows about a person beyond their
-- address, and it is never required to produce a filing plan.
alter table public.profiles
  add column if not exists full_name text;

-- A short, readable version of the plan, captured when the student saves
-- rather than recomputed later. The walkthrough has already done the
-- arithmetic at that moment, and recomputing it anywhere else would mean
-- a second implementation of the tax logic that could drift from the
-- first. Figures only: this holds what the plan concluded, not the
-- answers behind it, which live in the answers column already.
alter table public.saved_plans
  add column if not exists summary jsonb;

-- The only way to hold a staff role, and the only way to sign up from a
-- non-GW address. Seeded by hand, never by the application.
create table if not exists public.staff_invites (
  email          text primary key,
  role           text not null check (role in ('university_admin', 'tax_operations')),
  institution_id uuid references public.institutions(id) on delete set null
);

insert into public.staff_invites (email, role, institution_id)
values ('kahdelina@gmail.com', 'tax_operations', null)
on conflict (email) do update set role = excluded.role;

insert into public.staff_invites (email, role, institution_id)
select 'chrisenriquezwork@gmail.com', 'university_admin', i.id
  from public.institutions i where i.slug = 'gwu'
on conflict (email) do update
  set role = excluded.role, institution_id = excluded.institution_id;

-- ------------------------------------------------------------ activity

-- Counted for reporting. Deliberately holds no part of the document and
-- no figure read from it: a row records that a read happened, not what
-- it said.
create table if not exists public.document_reads (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('local', 'assisted', 'guide')),
  created_at timestamptz not null default now()
);

create index if not exists document_reads_user on public.document_reads (user_id);

-- ---------------------------------------------------------- signup gate

-- The API checks the domain too, so a rejected student gets a readable
-- message instead of a database error. This trigger is the backstop: the
-- publishable key is public, so /auth/v1/signup can be called directly
-- without going through the site, and that path has to be shut as well.
create or replace function public.enforce_signup_domain()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(coalesce(new.email, ''));
  dom  text := split_part(addr, '@', 2);
begin
  if exists (select 1 from public.staff_invites s where s.email = addr) then
    return new;
  end if;
  if exists (select 1 from public.institution_domains d where d.domain = dom) then
    return new;
  end if;
  raise exception 'Campus Filing accounts are limited to GW email addresses.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists enforce_signup_domain on auth.users;
create trigger enforce_signup_domain before insert on auth.users
  for each row execute function public.enforce_signup_domain();

-- A profile for every account, with the role and institution resolved
-- from the address at the moment it is created.
create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(coalesce(new.email, ''));
  inv  public.staff_invites%rowtype;
  inst uuid;
  nm   text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
begin
  select * into inv from public.staff_invites s where s.email = addr;
  if found then
    insert into public.profiles (user_id, role, institution_id, full_name)
    values (new.id, inv.role, inv.institution_id, nm)
    on conflict (user_id) do nothing;
    return new;
  end if;

  select d.institution_id into inst
    from public.institution_domains d
   where d.domain = split_part(addr, '@', 2);

  insert into public.profiles (user_id, role, institution_id, full_name)
  values (new.id, 'student', inst, nm)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_profile_for_user on auth.users;
create trigger create_profile_for_user after insert on auth.users
  for each row execute function public.create_profile_for_user();

-- Anyone who signed up before this file ran.
insert into public.profiles (user_id, role, institution_id)
select u.id,
       coalesce(s.role, 'student'),
       coalesce(s.institution_id, d.institution_id)
  from auth.users u
  left join public.staff_invites s on s.email = lower(u.email)
  left join public.institution_domains d on d.domain = split_part(lower(u.email), '@', 2)
on conflict (user_id) do nothing;

-- ----------------------------------------------------------------- RLS

alter table public.institutions        enable row level security;
alter table public.institution_domains enable row level security;
alter table public.profiles            enable row level security;
alter table public.staff_invites       enable row level security;
alter table public.document_reads      enable row level security;

-- A student reads their own profile. Nobody reads anyone else's, including
-- administrators: reporting goes through the function below, which returns
-- counts rather than rows.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists institutions_select on public.institutions;
create policy institutions_select on public.institutions
  for select to authenticated using (true);

drop policy if exists document_reads_insert_own on public.document_reads;
create policy document_reads_insert_own on public.document_reads
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists document_reads_select_own on public.document_reads;
create policy document_reads_select_own on public.document_reads
  for select to authenticated using ((select auth.uid()) = user_id);

-- institution_domains and staff_invites get row security and no policy at
-- all, which denies everything. Only the SECURITY DEFINER functions above
-- read them, and the staff list is not something a signed-in student
-- should be able to enumerate.

revoke all on public.institution_domains from anon, authenticated, public;
revoke all on public.staff_invites       from anon, authenticated, public;
revoke all on public.institutions        from anon, public;
revoke all on public.profiles            from anon, public;
revoke all on public.document_reads      from anon, public;

grant select on public.institutions to authenticated;
grant select on public.profiles to authenticated;
grant select, insert on public.document_reads to authenticated;

revoke truncate, references, trigger on public.institutions        from authenticated, anon, public;
revoke truncate, references, trigger on public.institution_domains from authenticated, anon, public;
revoke truncate, references, trigger on public.profiles            from authenticated, anon, public;
revoke truncate, references, trigger on public.staff_invites       from authenticated, anon, public;
revoke truncate, references, trigger on public.document_reads      from authenticated, anon, public;

-- ----------------------------------------------------------- reporting

/* These two gained columns after they first shipped, and Postgres will
   not let CREATE OR REPLACE change a function's return type. Dropping
   first is what makes this file safe to run again over an older
   version of itself; the grants below are reapplied either way. */
drop function if exists public.my_role();
drop function if exists public.institution_usage();

create or replace function public.my_role()
returns table (role text, institution text, full_name text)
language sql stable security definer set search_path = '' as $$
  select coalesce(p.role, 'student'), i.name, p.full_name
    from public.profiles p
    left join public.institutions i on i.id = p.institution_id
   where p.user_id = auth.uid();
$$;

-- A student may correct their own name. Nothing else about a profile is
-- theirs to change: the role and the institution are assigned, and a
-- student who could edit either would be granting themselves access.
create or replace function public.set_my_name(new_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  nm text := nullif(btrim(coalesce(new_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if length(coalesce(nm, '')) > 80 then
    raise exception 'name too long';
  end if;
  update public.profiles set full_name = nm where user_id = auth.uid();
  return nm;
end;
$$;

revoke execute on function public.set_my_name(text) from public, anon;
grant execute on function public.set_my_name(text) to authenticated;

-- Counts only. There is no path from here to a student's answers, and an
-- administrator has no read on saved_plans to fall back on.
create or replace function public.institution_usage()
returns table (
  institution    text,
  enrollment     integer,
  students       bigint,
  plans          bigint,
  documents_read bigint,
  last_activity  timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  caller_role text;
  caller_inst uuid;
begin
  select p.role, p.institution_id into caller_role, caller_inst
    from public.profiles p where p.user_id = auth.uid();

  if caller_role is null then
    raise exception 'not signed in';
  end if;
  if caller_role not in ('university_admin', 'tax_operations') then
    raise exception 'not permitted';
  end if;

  return query
    select i.name,
           i.enrollment,
           count(distinct p.user_id),
           count(distinct sp.id),
           count(distinct dr.id),
           greatest(max(sp.updated_at), max(dr.created_at))
      from public.institutions i
      left join public.profiles p
        on p.institution_id = i.id and p.role = 'student'
      left join public.saved_plans sp on sp.user_id = p.user_id
      left join public.document_reads dr on dr.user_id = p.user_id
     where caller_role = 'tax_operations' or i.id = caller_inst
     group by i.id, i.name, i.enrollment
     order by i.name;
end;
$$;

revoke execute on function public.my_role()                from public, anon;
revoke execute on function public.institution_usage()      from public, anon;
revoke execute on function public.enforce_signup_domain()  from public, anon, authenticated;
revoke execute on function public.create_profile_for_user() from public, anon, authenticated;

grant execute on function public.my_role()           to authenticated;
grant execute on function public.institution_usage() to authenticated;

-- ------------------------------------------------- editable site content

-- US-22: the tax content manager updates the FAQ and deadline pages when
-- IRS rules change. The text lives here, keyed by a slot the page knows,
-- and every save records who made it and when. Content is applied to the
-- page as plain text, never as markup, so nothing stored here can carry
-- script onto a public page.

create table if not exists public.site_content (
  slot        text primary key check (slot ~ '^[a-z0-9:-]{1,80}$'),
  content     text not null check (length(content) <= 2000),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Figure overrides, separate from prose because they are numbers with
-- bounds, not text. The walkthrough, the estimator and every data-tax
-- span on the site read these on load, so a saved change reaches the
-- arithmetic, not just a display. Brackets stay in code: a bracket edit
-- changes seven numbers that must stay ordered, which is a code change
-- with a test suite, not a field.
create table if not exists public.tax_figure_overrides (
  tax_year    integer not null check (tax_year between 2020 and 2100),
  figure      text not null,
  value       numeric not null check (value >= 0 and value <= 1000000),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (tax_year, figure)
);

alter table public.site_content         enable row level security;
alter table public.tax_figure_overrides enable row level security;

-- Public text on public pages: anyone may read, including signed-out
-- visitors, because the pages that render it are open to everyone.
drop policy if exists site_content_read on public.site_content;
create policy site_content_read on public.site_content
  for select to anon, authenticated using (true);

drop policy if exists tax_overrides_read on public.tax_figure_overrides;
create policy tax_overrides_read on public.tax_figure_overrides
  for select to anon, authenticated using (true);

revoke all on public.site_content         from anon, authenticated, public;
revoke all on public.tax_figure_overrides from anon, authenticated, public;
grant select on public.site_content         to anon, authenticated;
grant select on public.tax_figure_overrides to anon, authenticated;

-- Writes go through these two, which read the caller's role from their
-- profile row. There is no insert or update grant on either table, so
-- the functions are the only doors.

create or replace function public.set_site_content(slot_name text, new_content text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  caller_role text;
  caller_mail text;
begin
  select p.role into caller_role from public.profiles p where p.user_id = auth.uid();
  if caller_role is distinct from 'tax_operations' then
    raise exception 'not permitted';
  end if;
  select lower(u.email) into caller_mail from auth.users u where u.id = auth.uid();

  if new_content is null or btrim(new_content) = '' then
    delete from public.site_content where slot = slot_name;
    return;
  end if;

  insert into public.site_content (slot, content, updated_by)
  values (slot_name, new_content, caller_mail)
  on conflict (slot) do update
    set content = excluded.content,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$$;

create or replace function public.set_tax_figure(figure_year integer, figure_name text, figure_value numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  caller_role text;
  caller_mail text;
  allowed text[] := array[
    'singleStandardDeduction', 'dependentFloor', 'dependentEarnedBump',
    'unearnedFilingTrigger', 'qualifyingRelativeIncomeTest',
    'selfEmploymentTrigger', 'aotcMax', 'aotcRefundable', 'llcMax',
    'studentLoanInterestCap', 'studentLoanPhaseoutStart',
    'studentLoanPhaseoutEnd', 'capitalLossLimit', 'freeFileIncomeLimit',
    'mileageFirstHalf', 'mileageSecondHalf'
  ];
begin
  select p.role into caller_role from public.profiles p where p.user_id = auth.uid();
  if caller_role is distinct from 'tax_operations' then
    raise exception 'not permitted';
  end if;
  if not (figure_name = any(allowed)) then
    raise exception 'that figure is not editable here';
  end if;
  select lower(u.email) into caller_mail from auth.users u where u.id = auth.uid();

  if figure_value is null then
    delete from public.tax_figure_overrides
     where tax_year = figure_year and figure = figure_name;
    return;
  end if;

  insert into public.tax_figure_overrides (tax_year, figure, value, updated_by)
  values (figure_year, figure_name, figure_value, caller_mail)
  on conflict (tax_year, figure) do update
    set value = excluded.value,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$$;

revoke execute on function public.set_site_content(text, text) from public, anon;
revoke execute on function public.set_tax_figure(integer, text, numeric) from public, anon;
grant execute on function public.set_site_content(text, text) to authenticated;
grant execute on function public.set_tax_figure(integer, text, numeric) to authenticated;

revoke truncate, references, trigger on public.site_content         from authenticated, anon, public;
revoke truncate, references, trigger on public.tax_figure_overrides from authenticated, anon, public;
