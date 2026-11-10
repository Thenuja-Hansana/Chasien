-- Phase 11 slice 1: the background jobs find their Edge Functions through
-- Vault, so the same migrations work on the local stack and on a hosted
-- project.
--
-- Four jobs call Edge Functions from inside the database:
--   - the notify_new_message trigger (20260815002723)  -> notify-new-message
--   - the notify_activity trigger (20260902100200)     -> notify-activity
--   - cleanup-expired-stories-hourly (20260901190100)  -> cleanup-expired-stories
--   - cleanup-unused-media-daily (20261002140300)      -> cleanup-unused-media
-- Each had the local stack's address written into it
-- (http://edge_runtime:8081, the edge runtime container on Docker's
-- network) and its fixed demo key. Pushed to a hosted project unchanged,
-- they would have called nothing: no push notifications, no cleanup, and
-- no error anywhere a person would see.
--
-- Now they all go through call_edge_function(), which reads two Vault
-- secrets set once per project, never in a migration:
--   edge_functions_url  local: http://edge_runtime:8081 (seed.sql)
--                       hosted: https://<project-ref>.supabase.co/functions/v1
--   edge_functions_key  the project's anon key
-- The anon key is enough, and it's public anyway (every build carries it):
-- the push functions take only a row id and claim the row before sending
-- (20260923100000), and the cleanups take no input. Setting them is a step
-- in docs/hosting.md.
--
-- The push triggers send only the row's id. The functions read nothing
-- else (slice 1 of Phase 10), so there's no reason for a message's text to
-- sit in pg_net's request queue.

-- ---------------------------------------------------------------------
-- The one place that knows where the functions are.
-- ---------------------------------------------------------------------

-- SECURITY DEFINER: Vault is readable only by its owner, and the push
-- triggers run as whoever inserted the row. Not an API endpoint: functions
-- are closed by default (20261002100000) and this gets no grant.
create or replace function public.call_edge_function(
  p_name text,
  p_body jsonb default '{}'::jsonb,
  p_timeout_ms integer default 5000
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'edge_functions_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'edge_functions_key';
  if v_url is null or v_key is null then
    -- A project nobody has configured yet. Say so in the logs, and don't
    -- fail whatever insert fired this.
    raise warning 'call_edge_function(%): set the vault secrets edge_functions_url and edge_functions_key (docs/hosting.md)', p_name;
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/' || p_name,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;

revoke execute on function public.call_edge_function(text, jsonb, integer) from public, anon, authenticated;

-- An AFTER INSERT trigger that tells an Edge Function a row arrived. The
-- function's name is the trigger's argument. The body keeps the shape
-- Database Webhooks used (type, table, schema, record), with only the id
-- in the record. A failure is logged, never raised: a push that can't be
-- queued must not stop the message or notification being written.
create or replace function public.push_row_to_edge_function()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.call_edge_function(
    tg_argv[0],
    jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', jsonb_build_object('id', new.id)
    )
  );
  return new;
exception when others then
  raise warning 'push_row_to_edge_function(%): %', tg_argv[0], sqlerrm;
  return new;
end;
$$;

revoke execute on function public.push_row_to_edge_function() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- The two push webhooks.
-- ---------------------------------------------------------------------

drop trigger if exists notify_new_message on public.messages;
create trigger notify_new_message
after insert on public.messages
for each row execute function public.push_row_to_edge_function('notify-new-message');

drop trigger if exists notify_activity on public.notifications;
create trigger notify_activity
after insert on public.notifications
for each row execute function public.push_row_to_edge_function('notify-activity');

-- ---------------------------------------------------------------------
-- The two cleanup jobs. Same schedules as before; only how they reach
-- their function changes. 30 seconds, not pg_net's default 5: nothing
-- waits on these, and a hosted function can start cold.
-- ---------------------------------------------------------------------

select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-expired-stories-hourly';
select cron.schedule(
  'cleanup-expired-stories-hourly',
  '0 * * * *',
  $$select public.call_edge_function('cleanup-expired-stories', '{}'::jsonb, 30000)$$
);

select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-unused-media-daily';
select cron.schedule(
  'cleanup-unused-media-daily',
  '0 4 * * *',
  $$select public.call_edge_function('cleanup-unused-media', '{}'::jsonb, 30000)$$
);
