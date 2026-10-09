-- Profils des comptes joueurs. La table reste privée ; le classement n'expose que
-- les champs affichés dans l'interface, via la fonction dédiée en bas du script.
create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  pseudo text not null check (char_length(btrim(pseudo)) between 2 and 32),
  arrival_year smallint not null check (arrival_year between 1950 and 2100),
  program_code text not null check (program_code in ('ING', 'LG', 'M')),
  filiere text check (filiere is null or char_length(filiere) <= 100),
  bio text check (bio is null or char_length(bio) <= 280),
  created_at timestamptz not null default now()
);

alter table public.player_profiles
  add column if not exists filiere text check (filiere is null or char_length(filiere) <= 100);

-- Une réussite par joueur, par défi quotidien ou hebdomadaire. La clé primaire
-- empêche de recompter le même défi sur une période.
create table if not exists public.player_challenge_completions (
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('daily', 'weekly')),
  period_key date not null,
  points integer not null default 0 check (points >= 0),
  completed_at timestamptz not null default now(),
  primary key (user_id, mode, period_key)
);

alter table public.player_challenge_completions
  add column if not exists points integer not null default 0 check (points >= 0);

-- Les anciennes lignes d'une version sans colonne points reçoivent le barème
-- de base. Les lignes déjà notées sont conservées.
update public.player_challenge_completions
set points = case when mode = 'daily' then 5 else 10 end
where points = 0;

alter table public.player_challenge_completions enable row level security;
revoke all on public.player_challenge_completions from anon, authenticated;
grant select, insert on public.player_challenge_completions to authenticated;

drop policy if exists "Players can read their own challenge completions" on public.player_challenge_completions;
create policy "Players can read their own challenge completions"
  on public.player_challenge_completions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Players can record their own challenge completions" on public.player_challenge_completions;
create policy "Players can record their own challenge completions"
  on public.player_challenge_completions for insert to authenticated
  with check ((select auth.uid()) = user_id);

create unique index if not exists player_profiles_pseudo_lower_unique
  on public.player_profiles (lower(btrim(pseudo)));

alter table public.player_profiles enable row level security;
revoke all on public.player_profiles from anon, authenticated;
grant select, insert, update on public.player_profiles to authenticated;

drop policy if exists "Players can read their own profile" on public.player_profiles;
create policy "Players can read their own profile"
  on public.player_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Players can create their own profile" on public.player_profiles;
create policy "Players can create their own profile"
  on public.player_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Players can update their own profile" on public.player_profiles;
create policy "Players can update their own profile"
  on public.player_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.is_player_pseudo_available(p_pseudo text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select char_length(btrim(coalesce(p_pseudo, ''))) between 2 and 32
    and not exists (
      select 1
      from public.player_profiles
      where lower(btrim(pseudo)) = lower(btrim(coalesce(p_pseudo, '')))
    );
$$;

revoke all on function public.is_player_pseudo_available(text) from public;
grant execute on function public.is_player_pseudo_available(text) to anon, authenticated;

-- Classement public limité aux informations déjà affichées dans le profil joueur.
-- Aucun e-mail, bio ou identifiant interne n'est renvoyé. Le booléen indique
-- uniquement au joueur connecté si une ligne correspond à son propre compte.
drop function if exists public.get_player_leaderboard();
create or replace function public.get_player_leaderboard()
returns table (
  pseudo text,
  first_name text,
  last_name text,
  arrival_year smallint,
  program_code text,
  filiere text,
  daily_challenges bigint,
  weekly_challenges bigint,
  points bigint,
  is_current_user boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with challenge_totals as (
    select
      user_id,
      count(*) filter (where mode = 'daily')::bigint as daily_challenges,
      count(*) filter (where mode = 'weekly')::bigint as weekly_challenges,
      coalesce(sum(points), 0)::bigint as total_points
    from public.player_challenge_completions
    group by user_id
  )
  select
    profile.pseudo,
    profile.first_name,
    profile.last_name,
    profile.arrival_year,
    profile.program_code,
    profile.filiere,
    coalesce(challenge_totals.daily_challenges, 0)::bigint,
    coalesce(challenge_totals.weekly_challenges, 0)::bigint,
    coalesce(challenge_totals.total_points, 0)::bigint,
    coalesce(auth.uid() = profile.user_id, false)
  from public.player_profiles as profile
  left join challenge_totals on challenge_totals.user_id = profile.user_id
  order by coalesce(challenge_totals.total_points, 0) desc, lower(profile.pseudo) asc;
$$;

revoke all on function public.get_player_leaderboard() from public;
grant execute on function public.get_player_leaderboard() to anon, authenticated;
