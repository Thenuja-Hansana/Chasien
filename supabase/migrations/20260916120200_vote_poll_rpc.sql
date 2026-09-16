-- vote_poll(): the single write path for poll_votes now that "one active
-- vote per poll" is conditional on polls.allow_multiple rather than a flat
-- primary key (see 20260916120000_poll_allow_multiple.sql) — a rule like
-- that can't be expressed as a plain RLS check, and doing it as three
-- sequential client calls (read the poll, maybe delete, insert) would
-- leave a race window between them. One statement in, atomic either way:
--
-- - Tapping an option the caller already picked retracts that vote.
-- - Otherwise, for a single-choice poll, their previous pick (if any) is
--   replaced; for a multi-select poll, the new pick is added alongside
--   whatever else they already picked.
--
-- SECURITY INVOKER (the default, same reasoning as create_post.sql): it
-- runs under the caller's own role, so the existing RLS policies on
-- poll_votes ("room members can vote as themselves" / "users can retract
-- their own vote") still gate every insert and delete this function does.

create function vote_poll(p_poll_id uuid, p_option_id uuid)
returns void
language plpgsql
as $$
declare
  v_allow_multiple boolean;
  v_deleted int;
begin
  select allow_multiple into v_allow_multiple from polls where id = p_poll_id;
  if v_allow_multiple is null then
    raise exception 'poll not found';
  end if;

  delete from poll_votes
  where poll_id = p_poll_id and poll_option_id = p_option_id and user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    return;
  end if;

  if not v_allow_multiple then
    delete from poll_votes where poll_id = p_poll_id and user_id = auth.uid();
  end if;

  insert into poll_votes (poll_id, poll_option_id, user_id)
  values (p_poll_id, p_option_id, auth.uid());
end;
$$;

revoke execute on function vote_poll(uuid, uuid) from public;
grant execute on function vote_poll(uuid, uuid) to authenticated;
