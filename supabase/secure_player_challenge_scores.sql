-- Les scores ne doivent plus être insérés directement depuis le navigateur.
-- La fonction ne crédite que des chemins valides et une fois par archive,
-- identifiée par le mode, la période et la sélection de promos.

begin;

-- Les anciennes réussites ne stockaient pas la sélection de promos. On les
-- garde sous une portée legacy et elles restent comptées comme déjà réalisées.
alter table public.player_challenge_completions
  add column if not exists promo_scope text;
update public.player_challenge_completions
set promo_scope = 'legacy'
where promo_scope is null;
alter table public.player_challenge_completions
  alter column promo_scope set not null;
alter table public.player_challenge_completions
  drop constraint if exists player_challenge_completions_pkey;
alter table public.player_challenge_completions
  add constraint player_challenge_completions_pkey
  primary key (user_id, mode, period_key, promo_scope);

drop policy if exists "Players can record their own challenge completions"
  on public.player_challenge_completions;
revoke all on public.player_challenge_completions from public, anon, authenticated;
grant select on public.player_challenge_completions to authenticated;

revoke all on function public.freeze_game_challenge_archive(text, date, integer[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.freeze_game_challenge_archive(text, date, integer[], jsonb, jsonb)
  to service_role;
grant execute on function public.get_game_challenge_archive(text, date, text)
  to service_role;

create or replace function public.record_player_challenge_completion(
  p_mode text,
  p_period_key date,
  p_promo_scope text,
  p_path text[],
  p_hints_used integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user uuid := auth.uid();
  current_paris_date date := (now() at time zone 'Europe/Paris')::date;
  challenge_row jsonb;
  graph_snapshot jsonb;
  promo_years integer[];
  challenge_constraint jsonb;
  challenge_start text;
  challenge_end text;
  challenge_distance integer;
  path_nodes_count integer;
  path_index integer;
  path_from text;
  path_to text;
  constraint_type text;
  constraint_student_id text;
  base_points integer;
  calculated_points integer;
  inserted_rows integer;
begin
  if authenticated_user is null then
    raise exception 'Connecte-toi pour enregistrer un défi.' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('daily', 'weekly') then
    raise exception 'Mode de défi invalide.' using errcode = '22023';
  end if;
  if p_period_key is null
    or p_period_key < date '2026-09-01'
    or p_period_key > current_paris_date
    or (p_mode = 'weekly' and extract(isodow from p_period_key) <> 1) then
    raise exception 'Période de défi invalide.' using errcode = '22023';
  end if;
  if p_promo_scope is null or char_length(p_promo_scope) > 300 then
    raise exception 'Sélection de promos invalide.' using errcode = '22023';
  end if;
  if p_hints_used is null or p_hints_used < 0 or p_hints_used > 3 then
    raise exception 'Nombre d’indices invalide.' using errcode = '22023';
  end if;
  if p_path is null or cardinality(p_path) < 2 or cardinality(p_path) > 101
    or exists (select 1 from unnest(p_path) path_id where path_id is null or path_id = '') then
    raise exception 'Chemin invalide.' using errcode = '22023';
  end if;

  select a.challenge, s.graph, a.promo_years
    into challenge_row, graph_snapshot, promo_years
  from public.game_challenge_archives a
  join public.game_graph_snapshots s using (snapshot_hash)
  where a.mode = p_mode
    and a.period_key = p_period_key
    and a.promo_scope = p_promo_scope;
  if challenge_row is null or graph_snapshot is null then
    raise exception 'Défi archivé introuvable.' using errcode = '22023';
  end if;

  challenge_start := challenge_row->>'startId';
  challenge_end := challenge_row->>'endId';
  challenge_distance := (challenge_row->>'distance')::integer;
  challenge_constraint := challenge_row->'constraint';
  if challenge_start is null or challenge_end is null
    or challenge_distance is null or challenge_distance < 1
    or p_path[1] <> challenge_start
    or p_path[cardinality(p_path)] <> challenge_end then
    raise exception 'Le chemin ne relie pas les deux étudiants du défi.' using errcode = '22023';
  end if;

  select count(distinct path_id)
    into path_nodes_count
  from unnest(p_path) path_id;
  if path_nodes_count <> cardinality(p_path) then
    raise exception 'Le chemin ne peut pas contenir de boucle.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_path) path_node(path_id)
    left join jsonb_array_elements(graph_snapshot->'nodes') node on node->>'id' = path_node.path_id
    where node is null or not ((node->>'promo')::integer = any(promo_years))
  ) then
    raise exception 'Le chemin contient un étudiant hors des promos du défi.' using errcode = '22023';
  end if;

  for path_index in 1..(cardinality(p_path) - 1) loop
    path_from := p_path[path_index];
    path_to := p_path[path_index + 1];
    if not exists (
      select 1
      from jsonb_array_elements(graph_snapshot->'links') link
      where (coalesce(link->'source'->>'id', link->>'source') = path_from
        and coalesce(link->'target'->>'id', link->>'target') = path_to)
        or (coalesce(link->'source'->>'id', link->>'source') = path_to
        and coalesce(link->'target'->>'id', link->>'target') = path_from)
    ) then
      raise exception 'Le chemin contient un lien absent du graphe.' using errcode = '22023';
    end if;
  end loop;

  if challenge_constraint is not null and challenge_constraint <> 'null'::jsonb then
    constraint_type := challenge_constraint->>'type';
    constraint_student_id := challenge_constraint->>'studentId';
    if constraint_type not in ('through', 'avoid') or constraint_student_id is null then
      raise exception 'Règle du défi invalide.' using errcode = '22023';
    end if;
    if (constraint_type = 'through' and not (constraint_student_id = any(p_path)))
      or (constraint_type = 'avoid' and constraint_student_id = any(p_path)) then
      raise exception 'Le chemin ne respecte pas la règle du défi.' using errcode = '22023';
    end if;
  end if;

  base_points := case
    when p_mode = 'daily' and cardinality(p_path) - 1 = challenge_distance then 10
    when p_mode = 'daily' then 5
    when p_mode = 'weekly' and cardinality(p_path) - 1 = challenge_distance then 20
    else 10
  end;
  calculated_points := greatest(0, base_points - case p_hints_used
    when 0 then 0 when 1 then 1 when 2 then 2 else 4 end);

  if exists (
    select 1
    from public.player_challenge_completions
    where user_id = authenticated_user
      and mode = p_mode
      and period_key = p_period_key
      and promo_scope = 'legacy'
  ) then
    return jsonb_build_object('already_completed', true, 'points', 0);
  end if;

  insert into public.player_challenge_completions (user_id, mode, period_key, promo_scope, points)
  values (authenticated_user, p_mode, p_period_key, p_promo_scope, calculated_points)
  on conflict (user_id, mode, period_key, promo_scope) do nothing;
  get diagnostics inserted_rows = row_count;

  return jsonb_build_object(
    'already_completed', inserted_rows = 0,
    'points', calculated_points
  );
end;
$$;

revoke all on function public.record_player_challenge_completion(text, date, text, text[], integer)
  from public, anon;
grant execute on function public.record_player_challenge_completion(text, date, text, text[], integer)
  to authenticated;

commit;
