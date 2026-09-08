-- Search's "People" results. A plain client-side ilike via postgrest-js's
-- .or() would need the caller's raw query text spliced into that filter
-- string, which needs care against changing the filter's own structure
-- (a comma or parenthesis in what someone typed) — an RPC with q bound as
-- a real SQL parameter sidesteps that class of problem entirely. profiles
-- already has an "any authenticated user can read" policy (Phase 1), so
-- security invoker is enough, same reasoning start_dm() already used.
create function search_profiles(q text)
returns table (id uuid, handle text, name text)
language sql
security invoker
stable
set search_path = public
as $$
  select id, handle, name
  from profiles
  where id <> auth.uid()
    and (handle ilike '%' || q || '%' or name ilike '%' || q || '%')
  order by name
  limit 20;
$$;

grant execute on function search_profiles(text) to authenticated;
