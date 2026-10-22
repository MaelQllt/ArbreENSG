-- Easter egg ENSGdle : journal des découvertes.
--
-- Aucune policy et aucun grant : la seule voie d'accès est le rôle de service,
-- utilisé par la fonction edge `notify-easter-egg`. Aucun RPC n'est nécessaire.
--
-- `ip_hash` n'est jamais l'adresse IP : c'est une empreinte salée
-- (secret EASTER_EGG_IP_SALT), utilisée uniquement pour le garde-fou anti-spam.
-- Elle n'apparaît dans aucun e-mail.

create table if not exists public.easter_egg_findings (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash text not null,
  sent_at timestamptz
);

alter table public.easter_egg_findings enable row level security;
revoke all on public.easter_egg_findings from anon, authenticated;
grant select, insert, update, delete on public.easter_egg_findings to service_role;

create index if not exists easter_egg_findings_ip_recent_idx
  on public.easter_egg_findings (ip_hash, created_at desc);

create index if not exists easter_egg_findings_created_at_idx
  on public.easter_egg_findings (created_at desc);
