-- Autorise uniquement les superadmins à supprimer définitivement une proposition.
create or replace function public.delete_family_link_request(p_request_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_request_id bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.superadmins s where s.user_id = auth.uid()
  ) then
    raise exception 'Accès réservé au superadmin.' using errcode = '42501';
  end if;

  delete from public.family_link_requests r
    where r.id = p_request_id
    returning r.id into deleted_request_id;

  if not found then
    raise exception 'Cette demande n’existe plus.' using errcode = 'P0002';
  end if;

  return deleted_request_id;
end;
$$;

revoke all on function public.delete_family_link_request(bigint) from public;
revoke all on function public.delete_family_link_request(bigint) from anon;
grant execute on function public.delete_family_link_request(bigint) to authenticated;
