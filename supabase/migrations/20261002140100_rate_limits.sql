-- Phase 10, slice 6 (2 of 4): how often one person can do something.
--
-- Nothing limited frequency. The size limits in 20261002140000 cap one
-- row; they don't cap the total. One account sending 4,000-character
-- messages as fast as it could would write on the order of 170 MB a day,
-- and the free tier's database is 500 MB. Other actions cost more than
-- their own row: a post or a story fans out a notification (and a push) to
-- every member of the Room, a like or a friend request notifies someone.
--
-- The numbers, agreed with Thenuja on 2026-10-02, per person:
--
--   chat messages     30 a minute, 2,000 a day
--   comments          10 a minute,   500 a day
--   likes             60 a minute
--   reactions         60 a minute
--   posts and events  10 an hour,     30 a day
--   stories           10 an hour,     30 a day
--   reports           10 an hour
--   friend requests   20 an hour
--   Rooms created      5 a day
--   uploads           50 a day                (20261002140200)
--   verification emails  1 a minute per Room, 5 an hour in all
--                                             (request-room-verification)
--
-- With the daily caps, the most text one account can write in a day is
-- about 8 MB (2,000 messages of 4,000 characters), not 170.
--
-- How it works:
--
-- * rate_limit_counters holds one row per person, action and time window
--   (the minute, hour or day it falls in). hit_rate_limit() adds one to
--   the row for the current window and raises if that goes over the limit.
--   One indexed upsert, whatever the size of the table being written to;
--   counting recent rows in `messages` instead would need an index it
--   doesn't have and would get slower as the table grew.
--
-- * enforce_rate_limit() is a BEFORE INSERT trigger on each limited table.
--   It limits auth.uid(), the person making the request, and does nothing
--   when there isn't one: the service role (Edge Functions), cron jobs and
--   seeds aren't limited. A post made by create_post() counts against its
--   caller, since auth.uid() is still them inside the function.
--
-- * A refused insert leaves no trace: the increment is part of the same
--   statement and rolls back with it. So hammering a limit doesn't extend
--   it, and the counter never exceeds the limit.
--
-- * Windows are fixed (date_trunc), not sliding. Someone can do a
--   minute's worth at 10:00:59 and another at 10:01:00. A sliding window
--   needs a row per action; this is a ceiling against abuse and runaway
--   clients, not a meter.
--
-- * The message is one sentence for every limit, raised without a custom
--   errcode so the app shows it (errorMessage(), lib/errors.ts).
--
-- * The table is not readable or writable by clients: RLS on, no policy,
--   no grant. hit_rate_limit() is internal (the service role can call it,
--   which is how the email limit is applied from the Edge Function).
--
-- Also here, because they are the other half of "don't run out of space":
-- two cleanup jobs. Counters older than two days are deleted hourly.
-- Notifications older than 90 days are deleted daily; nothing removed them
-- before, and a post in a 100-member Room writes 100 of them.

create table rate_limit_counters (
  user_id uuid not null references profiles (id) on delete cascade,
  action text not null,
  bucket text not null check (bucket in ('minute', 'hour', 'day')),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, action, bucket, window_start)
);

alter table rate_limit_counters enable row level security;

-- Supabase's default privileges hand a new table in `public` to anon and
-- authenticated. With RLS on and no policy they could read or write no
-- row, but the grants should say what's true.
revoke all on rate_limit_counters from anon, authenticated;

-- For the hourly cleanup, which deletes by age.
create index rate_limit_counters_window_start_idx on rate_limit_counters (window_start);

create function hit_rate_limit(p_user_id uuid, p_action text, p_bucket text, p_max integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into rate_limit_counters as c (user_id, action, bucket, window_start, count)
  values (p_user_id, p_action, p_bucket, date_trunc(p_bucket, now()), 1)
  on conflict (user_id, action, bucket, window_start)
  do update set count = c.count + 1
  returning c.count into v_count;

  if v_count > p_max then
    raise exception 'You''re doing that too often. Wait a moment and try again.';
  end if;
end;
$$;

revoke execute on function hit_rate_limit(uuid, text, text, integer) from public, anon, authenticated;

-- Trigger arguments: the action, then (bucket, max) pairs.
--   execute function enforce_rate_limit('message', 'minute', '30', 'day', '2000')
create function enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  i integer := 1;
begin
  if v_user_id is null then
    return new;
  end if;

  while i < tg_nargs loop
    perform hit_rate_limit(v_user_id, tg_argv[0], tg_argv[i], tg_argv[i + 1]::integer);
    i := i + 2;
  end loop;

  return new;
end;
$$;

revoke execute on function enforce_rate_limit() from public, anon, authenticated;

create trigger rate_limit before insert on messages
  for each row execute function enforce_rate_limit('message', 'minute', '30', 'day', '2000');

create trigger rate_limit before insert on comments
  for each row execute function enforce_rate_limit('comment', 'minute', '10', 'day', '500');

create trigger rate_limit before insert on post_likes
  for each row execute function enforce_rate_limit('like', 'minute', '60');

create trigger rate_limit before insert on message_reactions
  for each row execute function enforce_rate_limit('reaction', 'minute', '60');

-- Both create_post() and create_event_post() insert here.
create trigger rate_limit before insert on posts
  for each row execute function enforce_rate_limit('post', 'hour', '10', 'day', '30');

create trigger rate_limit before insert on stories
  for each row execute function enforce_rate_limit('story', 'hour', '10', 'day', '30');

create trigger rate_limit before insert on reports
  for each row execute function enforce_rate_limit('report', 'hour', '10');

create trigger rate_limit before insert on friendships
  for each row execute function enforce_rate_limit('friend_request', 'hour', '20');

create trigger rate_limit before insert on rooms
  for each row execute function enforce_rate_limit('room', 'day', '5');

-- ---------------------------------------------------------------------
-- Cleanup.
-- ---------------------------------------------------------------------

create function purge_old_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from notifications where created_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function purge_old_notifications() from public, anon, authenticated;

-- Plain SQL jobs, run by pg_cron as the database owner: nothing here needs
-- an Edge Function, so unlike the story cleanup (20260901190100) there is
-- no URL or key to replace when the backend is hosted.
select cron.schedule(
  'purge-rate-limit-counters-hourly',
  '45 * * * *',
  $$delete from public.rate_limit_counters where window_start < now() - interval '2 days'$$
);

select cron.schedule(
  'purge-old-notifications-daily',
  '30 3 * * *',
  $$select public.purge_old_notifications()$$
);
