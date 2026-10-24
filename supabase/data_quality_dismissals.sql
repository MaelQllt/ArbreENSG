-- Signalements du contrôle qualité que les superadmins ont choisi d'ignorer.
-- La liste des signalements est calculée dans le navigateur à partir des
-- données ; seule la clé de chaque signalement ignoré est conservée ici
-- (par exemple « doublon:jean-dupond|jean-dupont »).
-- Script idempotent : il peut être exécuté plusieurs fois.

create table if not exists public.data_quality_dismissals (
  key text primary key check (char_length(key) between 1 and 500),
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid default auth.uid() references auth.users(id) on delete set null
);

alter table public.data_quality_dismissals enable row level security;
revoke all on public.data_quality_dismissals from anon, authenticated;
grant select, insert, delete on public.data_quality_dismissals to authenticated;
grant select, insert, update, delete on public.data_quality_dismissals to service_role;

drop policy if exists "Superadmins can read dismissals" on public.data_quality_dismissals;
create policy "Superadmins can read dismissals"
  on public.data_quality_dismissals
  for select
  to authenticated
  using (exists (select 1 from public.superadmins s where s.user_id = auth.uid()));

drop policy if exists "Superadmins can dismiss" on public.data_quality_dismissals;
create policy "Superadmins can dismiss"
  on public.data_quality_dismissals
  for insert
  to authenticated
  with check (exists (select 1 from public.superadmins s where s.user_id = auth.uid()));

drop policy if exists "Superadmins can restore" on public.data_quality_dismissals;
create policy "Superadmins can restore"
  on public.data_quality_dismissals
  for delete
  to authenticated
  using (exists (select 1 from public.superadmins s where s.user_id = auth.uid()));
