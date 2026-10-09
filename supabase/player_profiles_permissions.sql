-- Répare les privilèges de table si player_accounts.sql a déjà été exécuté
-- avec des droits limités aux colonnes. RLS garde l'accès limité à son profil.
grant select, insert, update on public.player_profiles to authenticated;
