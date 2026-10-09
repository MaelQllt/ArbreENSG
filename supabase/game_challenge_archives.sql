-- Défis quotidiens et hebdomadaires figés à leur première consultation.
-- Les instantanés de graphe sont dédupliqués par contenu ; chaque défi ne stocke
-- qu'une référence, sa période, sa portée de promos et les données du défi.

create table if not exists public.game_graph_snapshots (
  snapshot_hash text primary key,
  graph jsonb not null,
  created_at timestamptz not null default now(),
  constraint game_graph_snapshots_shape check (
    jsonb_typeof(graph) = 'object'
    and jsonb_typeof(graph->'nodes') = 'array'
    and jsonb_typeof(graph->'links') = 'array'
  )
);

create table if not exists public.game_challenge_archives (
  mode text not null check (mode in ('daily', 'weekly')),
  period_key date not null,
  promo_scope text not null,
  promo_years integer[] not null,
  snapshot_hash text not null references public.game_graph_snapshots(snapshot_hash),
  challenge jsonb not null,
  created_at timestamptz not null default now(),
  primary key (mode, period_key, promo_scope)
);

alter table public.game_graph_snapshots enable row level security;
alter table public.game_challenge_archives enable row level security;
revoke all on public.game_graph_snapshots from anon, authenticated;
revoke all on public.game_challenge_archives from anon, authenticated;

create or replace function public.get_game_challenge_archive(
  p_mode text,
  p_period_key date,
  p_promo_scope text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mode', a.mode,
    'period_key', a.period_key,
    'promo_scope', a.promo_scope,
    'promo_years', a.promo_years,
    'challenge', a.challenge,
    'graph', s.graph
  )
  from public.game_challenge_archives a
  join public.game_graph_snapshots s using (snapshot_hash)
  where a.mode = p_mode
    and a.period_key = p_period_key
    and a.promo_scope = p_promo_scope;
$$;

create or replace function public.freeze_game_challenge_archive(
  p_mode text,
  p_period_key date,
  p_promo_years integer[],
  p_challenge jsonb,
  p_graph jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_years integer[];
  normalized_scope text;
  graph_hash text;
  start_id text;
  end_id text;
  path_length integer;
  path_index integer;
  path_from text;
  path_to text;
  rule_type text;
  rule_student_id text;
  distinct_path_nodes integer;
  archive_row jsonb;
begin
  if p_mode is null or p_mode not in ('daily', 'weekly') then
    raise exception 'Mode d’archive invalide.' using errcode = '22023';
  end if;

  if p_period_key < date '2026-09-01'
    or p_period_key > (now() at time zone 'Europe/Paris')::date
    or (p_mode = 'weekly' and extract(isodow from p_period_key) <> 1) then
    raise exception 'Période d’archive invalide.' using errcode = '22023';
  end if;

  select array_agg(year order by year), string_agg(year::text, ',' order by year)
    into normalized_years, normalized_scope
  from (select distinct unnest(p_promo_years) as year) selected_years;
  if coalesce(cardinality(normalized_years), 0) < 3 then
    raise exception 'Il faut au moins trois promos pour archiver un défi.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'mode', a.mode,
    'period_key', a.period_key,
    'promo_scope', a.promo_scope,
    'promo_years', a.promo_years,
    'challenge', a.challenge,
    'graph', s.graph
  )
  into archive_row
  from public.game_challenge_archives a
  join public.game_graph_snapshots s using (snapshot_hash)
  where a.mode = p_mode
    and a.period_key = p_period_key
    and a.promo_scope = normalized_scope;
  if archive_row is not null then return archive_row; end if;

  if jsonb_typeof(p_challenge) is distinct from 'object'
    or jsonb_typeof(p_graph) is distinct from 'object'
    or jsonb_typeof(p_graph->'nodes') is distinct from 'array'
    or jsonb_typeof(p_graph->'links') is distinct from 'array' then
    raise exception 'Instantané de défi invalide.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_graph->'nodes') > 10000
    or jsonb_array_length(p_graph->'links') > 30000
    or octet_length(p_graph::text) > 2000000 then
    raise exception 'Instantané de défi trop volumineux.' using errcode = '22023';
  end if;

  start_id := p_challenge->>'startId';
  end_id := p_challenge->>'endId';
  if jsonb_typeof(p_challenge->'solutionPath') is distinct from 'array' then
    raise exception 'Chemin du défi invalide.' using errcode = '22023';
  end if;
  path_length := jsonb_array_length(coalesce(p_challenge->'solutionPath', '[]'::jsonb));
  if start_id is null or end_id is null or path_length < 2
    or start_id = end_id
    or p_challenge->'solutionPath'->>0 is distinct from start_id
    or p_challenge->'solutionPath'->>(path_length - 1) is distinct from end_id
    or (p_challenge->>'distance')::integer is distinct from path_length - 1 then
    raise exception 'Chemin du défi invalide.' using errcode = '22023';
  end if;

  select count(distinct path_id)
    into distinct_path_nodes
  from jsonb_array_elements_text(p_challenge->'solutionPath') as path_nodes(path_id);
  if distinct_path_nodes <> path_length then
    raise exception 'Le chemin du défi ne peut pas contenir de boucle.' using errcode = '22023';
  end if;

  if not exists (select 1 from jsonb_array_elements(p_graph->'nodes') n where n->>'id' = start_id)
    or not exists (select 1 from jsonb_array_elements(p_graph->'nodes') n where n->>'id' = end_id) then
    raise exception 'Étudiant absent du graphe archivé.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_challenge->'solutionPath') as path_nodes(path_id)
    join jsonb_array_elements(p_graph->'nodes') n on n->>'id' = path_nodes.path_id
    where not ((n->>'promo')::integer = any(normalized_years))
  ) then
    raise exception 'Le chemin contient une promo non sélectionnée.' using errcode = '22023';
  end if;

  for path_index in 0..(path_length - 2) loop
    path_from := p_challenge->'solutionPath'->>path_index;
    path_to := p_challenge->'solutionPath'->>(path_index + 1);
    if not exists (
      select 1
      from jsonb_array_elements(p_graph->'links') link
      where (coalesce(link->'source'->>'id', link->>'source') = path_from
        and coalesce(link->'target'->>'id', link->>'target') = path_to)
        or (coalesce(link->'source'->>'id', link->>'source') = path_to
        and coalesce(link->'target'->>'id', link->>'target') = path_from)
    ) then
      raise exception 'Le chemin du défi contient un lien absent du graphe.' using errcode = '22023';
    end if;
  end loop;

  if p_challenge->'constraint' is not null and p_challenge->'constraint' <> 'null'::jsonb then
    rule_type := p_challenge->'constraint'->>'type';
    rule_student_id := p_challenge->'constraint'->>'studentId';
    if rule_type not in ('through', 'avoid') or rule_student_id is null
      or not exists (select 1 from jsonb_array_elements(p_graph->'nodes') n where n->>'id' = rule_student_id) then
      raise exception 'Règle du défi invalide.' using errcode = '22023';
    end if;
    if rule_type = 'through' and not exists (
      select 1 from jsonb_array_elements_text(p_challenge->'solutionPath') as path_nodes(path_id)
      where path_nodes.path_id = rule_student_id
    ) then
      raise exception 'Le chemin ne respecte pas la règle obligatoire.' using errcode = '22023';
    end if;
    if rule_type = 'avoid' and exists (
      select 1 from jsonb_array_elements_text(p_challenge->'solutionPath') as path_nodes(path_id)
      where path_nodes.path_id = rule_student_id
    ) then
      raise exception 'Le chemin contient le noeud interdit.' using errcode = '22023';
    end if;
  end if;

  graph_hash := md5(p_graph::text);
  insert into public.game_graph_snapshots (snapshot_hash, graph)
  values (graph_hash, p_graph)
  on conflict (snapshot_hash) do nothing;

  insert into public.game_challenge_archives (
    mode, period_key, promo_scope, promo_years, snapshot_hash, challenge
  ) values (
    p_mode, p_period_key, normalized_scope, normalized_years, graph_hash, p_challenge
  )
  on conflict (mode, period_key, promo_scope) do nothing;

  return public.get_game_challenge_archive(p_mode, p_period_key, normalized_scope);
end;
$$;

revoke all on function public.get_game_challenge_archive(text, date, text) from public;
revoke all on function public.freeze_game_challenge_archive(text, date, integer[], jsonb, jsonb) from public;
grant execute on function public.get_game_challenge_archive(text, date, text) to anon, authenticated;
grant execute on function public.freeze_game_challenge_archive(text, date, integer[], jsonb, jsonb) to anon, authenticated;
