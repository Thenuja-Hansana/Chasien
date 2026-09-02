-- Real-device bug found during Phase 8 testing: an Expo push token
-- belongs to a physical device + app install, not an account. When a
-- second account logs into a device that already registered a token
-- for a first account, upserting on `token` tries to UPDATE a row this
-- new caller doesn't own -- `push_tokens`'s RLS policy
-- (user_id = auth.uid()) correctly blocks that as a plain client write,
-- which is the right call for RLS but wrong for this specific case: the
-- token really should move to whoever's now logged in on that device,
-- the same way it would on any phone with more than one account.
-- security definer bypasses RLS for exactly that reassignment, and uses
-- auth.uid() itself rather than trusting a client-supplied user id, so
-- a caller can only ever claim a token for their own account.
create function register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into push_tokens (user_id, token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

grant execute on function register_push_token(text, text) to authenticated;
