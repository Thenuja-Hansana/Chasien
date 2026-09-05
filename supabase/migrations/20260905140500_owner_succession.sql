-- Owner succession (5.4): when the owner's room_memberships row is
-- deleted — either they called `leave`, or their account was deleted
-- and the row cascaded away with it — there's nobody left in either
-- path to make a manual choice, so this is automatic: promote the
-- next-ranked approved member (Admin first, then Mod, then Member;
-- earliest-joined breaks a tie). One trigger covers both departure
-- paths, since both just end in the same DELETE on this table.
--
-- If nobody else is left, the Room is left ownerless — the `leave`
-- Edge Function action refuses this for a sole owner (mirroring
-- change_role's existing "can't demote the only owner" guard), so this
-- only happens via account-deletion of a Room's only member, a known,
-- accepted edge case for now.
create function promote_next_owner_on_owner_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_user_id uuid;
begin
  if old.role != 'owner' then
    return old;
  end if;

  select user_id into v_next_user_id
  from room_memberships
  where room_id = old.room_id and join_state = 'approved'
  order by
    case role when 'admin' then 1 when 'mod' then 2 when 'member' then 3 else 4 end,
    created_at asc
  limit 1;

  if v_next_user_id is not null then
    update room_memberships set role = 'owner'
    where room_id = old.room_id and user_id = v_next_user_id;
  end if;

  return old;
end;
$$;

create trigger promote_next_owner_on_owner_departure
after delete on room_memberships
for each row execute function promote_next_owner_on_owner_departure();
