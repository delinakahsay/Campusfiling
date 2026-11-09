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
begin
  select * into inv from public.staff_invites s where s.email = addr;
  if found then
    insert into public.profiles (user_id, role, institution_id)
    values (new.id, inv.role, inv.institution_id)
    on conflict (user_id) do nothing;
    return new;
  end if;

  select d.institution_id into inst
    from public.institution_domains d
   where d.domain = split_part(addr, '@', 2);

  insert into public.profiles (user_id, role, institution_id)
  values (new.id, 'student', inst)
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

create or replace function public.my_role()
returns table (role text, institution text)
language sql stable security definer set search_path = '' as $$
  select coalesce(p.role, 'student'), i.name
    from public.profiles p
    left join public.institutions i on i.id = p.institution_id
   where p.user_id = auth.uid();
$$;

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
