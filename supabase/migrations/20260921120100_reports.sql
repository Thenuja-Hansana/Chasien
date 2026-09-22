-- Phase 9, slice 3: reporting, and the app admin who reviews reports.
--
-- `reports` has existed since Phase 1 (20260813051229_trust_and_safety.sql),
-- and since the 2026-09-16 lockdown a client can insert only
-- (reporter_id, target_type, target_id, reason) — never a status, a reviewer
-- or a snapshot. Nothing used it. This adds what makes it a working system:
--
--   * app admins — the developer, above every Room. Reports go to them, not
--     to a Room's mods, because the Room's owner may be the one reported.
--     Apple 1.2 asks the *developer* to act on reports.
--   * a server-side content_snapshot, captured the moment a report is
--     filed, so the evidence survives the content being edited or removed.
--   * a push to every app admin per report (via the existing notifications
--     pipeline), with the reporter kept out of it.
--   * review: dismiss, or act — remove the content (the slice-2 removal
--     functions, which app admins can now use anywhere) or suspend the
--     account (the `moderate` Edge Function, since that needs Supabase
--     Auth's admin API).

-- ── App admins ────────────────────────────────────────────────────────────
-- Written only with the service role (SQL / Studio): there's deliberately
-- no way to become an admin from the app. RLS on with no policies, and no
-- privileges at all for clients, so the table can't even be read.
create table app_admins (
  user_id uuid primary key references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table app_admins enable row level security;
revoke all on app_admins from anon, authenticated;

-- Internal: answers for any user, so it isn't callable over the API.
create function is_app_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = p_user_id);
$$;

revoke execute on function is_app_admin(uuid) from public, anon, authenticated;

-- What RLS policies and the client use: only ever about the caller.
create function current_user_is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_app_admin(auth.uid());
$$;

revoke execute on function current_user_is_app_admin() from public, anon;
grant execute on function current_user_is_app_admin() to authenticated;

-- ── Suspensions ───────────────────────────────────────────────────────────
-- Who is suspended, readable by app admins only. Not a column on profiles:
-- profiles are readable by every signed-in user, so a column there would
-- let anyone list who has been suspended. Written only by the `moderate`
-- Edge Function (service role), which also bans the account in Supabase
-- Auth — that ban is what actually stops sign-in and token refresh.
create table account_suspensions (
  user_id uuid primary key references profiles (id) on delete cascade,
  suspended_by uuid references profiles (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

alter table account_suspensions enable row level security;
revoke all on account_suspensions from anon, authenticated;
grant select on account_suspensions to authenticated;

create policy "app admins can see suspensions"
on account_suspensions for select
using (current_user_is_app_admin());

-- ── Reports: reasons and details ──────────────────────────────────────────
-- A fixed set of reasons, so the review queue can be sorted and counted,
-- plus optional free-text details. The one existing row (seed data, a
-- free-text reason) is moved onto 'other' with its text kept as details;
-- seed.sql is updated to match.
alter table reports add column details text;
alter table reports add constraint reports_details_length check (char_length(details) <= 1000);

update reports
set details = coalesce(details, reason), reason = 'other'
where reason not in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'illegal', 'other');

alter table reports add constraint reports_reason_known check (
  reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'illegal', 'other')
);

grant insert (details) on reports to authenticated;

-- Reports can't be retracted or tidied away by the reporter; there was
-- already no DELETE policy, this removes the leftover table privilege too.
revoke delete on reports from anon, authenticated;

-- One open report per person per thing. Once it's been reviewed they can
-- report it again (say, if it comes back).
create unique index reports_one_open_per_reporter on reports (reporter_id, target_type, target_id) where status = 'open';

-- ── Reports: rooms can be reported, and are validated like everything else
-- SECURITY INVOKER on purpose (unchanged): it runs as the reporter, so a
-- target they can't see under RLS — another Room's post, an invite-only
-- Room they're not in, a blocked person's story — "does not exist".
create or replace function validate_polymorphic_content_target()
returns trigger
language plpgsql
as $$
declare
  target_exists boolean;
begin
  if new.target_type is null then
    return new;
  end if;

  case new.target_type
    when 'post' then
      select exists (select 1 from posts where id = new.target_id) into target_exists;
    when 'comment' then
      select exists (select 1 from comments where id = new.target_id) into target_exists;
    when 'message' then
      select exists (select 1 from messages where id = new.target_id) into target_exists;
    when 'user' then
      select exists (select 1 from profiles where id = new.target_id) into target_exists;
    when 'story' then
      select exists (select 1 from stories where id = new.target_id) into target_exists;
    when 'room' then
      select exists (select 1 from rooms where id = new.target_id) into target_exists;
  end case;

  if not target_exists then
    raise exception 'target % of type % does not exist', new.target_id, new.target_type;
  end if;

  return new;
end;
$$;

-- ── Reports: the snapshot is the server's, not the client's ───────────────
-- SECURITY DEFINER so it reads the target whatever RLS would show. Triggers
-- fire in name order, so this runs *before* validate_report_target (the
-- invoker check above). That's safe only because nothing here raises on
-- the target's contents: when the reporter can't see the target, the
-- validation that follows aborts the insert and this snapshot is thrown
-- away. Keep it that way — an error raised here about the target would
-- tell the reporter something about content they can't see.
-- Every snapshot carries `author_id` (the account responsible —
-- for a Room, its current owner; for a user, themselves) and its handle,
-- and `room_id` / `room_name` where there is one, so the review screen can
-- act on any report the same way. Names are copied in rather than looked
-- up later: an admin usually isn't a member, so can't read an invite-only
-- Room's name, and an author may delete their account before review.
-- Media is recorded by storage path (the `moderate` Edge Function signs
-- it for the reviewing admin).
create function capture_report_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The column grants already refuse these from clients; set them here too
  -- so a future grant mistake can't file a pre-reviewed report.
  new.status := 'open';
  new.reviewed_by := null;
  new.reviewed_at := null;

  if new.target_type = 'user' and new.target_id = new.reporter_id then
    raise exception 'You can''t report yourself.';
  end if;

  new.content_snapshot := case new.target_type
    when 'post' then (
      select jsonb_build_object(
        'text', p.text, 'tag', p.tag, 'author_id', p.author_id, 'room_id', p.room_id, 'created_at', p.created_at,
        'media', coalesce((select jsonb_agg(m.url order by m.position) from post_media m where m.post_id = p.id), '[]'::jsonb),
        'author_handle', (select handle from profiles where id = p.author_id),
        'room_name', (select name from rooms where id = p.room_id))
      from posts p where p.id = new.target_id)
    when 'comment' then (
      select jsonb_build_object(
        'text', c.text, 'author_id', c.author_id, 'post_id', c.post_id, 'room_id', p.room_id, 'created_at', c.created_at,
        'author_handle', (select handle from profiles where id = c.author_id),
        'room_name', (select name from rooms where id = p.room_id))
      from comments c join posts p on p.id = c.post_id where c.id = new.target_id)
    when 'message' then (
      select jsonb_build_object(
        'text', m.text, 'image_url', m.image_url, 'voice_url', m.voice_url, 'author_id', m.author_id,
        'conversation_id', m.conversation_id, 'room_id', c.room_id, 'created_at', m.created_at,
        'author_handle', (select handle from profiles where id = m.author_id),
        'room_name', (select name from rooms where id = c.room_id))
      from messages m join conversations c on c.id = m.conversation_id where m.id = new.target_id)
    when 'story' then (
      select jsonb_build_object(
        'caption', s.caption, 'media_url', s.media_url, 'author_id', s.author_id, 'room_id', s.room_id, 'created_at', s.created_at,
        'author_handle', (select handle from profiles where id = s.author_id),
        'room_name', (select name from rooms where id = s.room_id))
      from stories s where s.id = new.target_id)
    when 'user' then (
      select jsonb_build_object('handle', pr.handle, 'name', pr.name, 'bio', pr.bio, 'author_id', pr.id, 'author_handle', pr.handle)
      from profiles pr where pr.id = new.target_id)
    when 'room' then (
      select jsonb_build_object(
        'name', r.name, 'slug', r.slug, 'description', r.description, 'visibility', r.visibility, 'room_id', r.id,
        'room_name', r.name,
        'author_id', (select rm.user_id from room_memberships rm where rm.room_id = r.id and rm.role = 'owner' limit 1),
        'author_handle', (select pr.handle from room_memberships rm join profiles pr on pr.id = rm.user_id
                          where rm.room_id = r.id and rm.role = 'owner' limit 1))
      from rooms r where r.id = new.target_id)
  end;

  return new;
end;
$$;

create trigger capture_report_snapshot
before insert on reports
for each row execute function capture_report_snapshot();

-- ── Reports reach the app admins ──────────────────────────────────────────
-- Through the existing notifications → Database Webhook → notify-activity
-- → Expo Push pipeline. actor_id stays null: the reporter isn't named in a
-- push, and a null actor also means the block-suppression trigger
-- (20260921100000) can't swallow a report because the admin happens to
-- have blocked the reporter. `data` is copied into the push payload, so it
-- carries only ids and the reason — never the reported content.
create function notify_app_admins_of_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, type, actor_id, room_id, data)
  select a.user_id, 'report_filed', null, (new.content_snapshot ->> 'room_id')::uuid,
         jsonb_build_object('reportId', new.id, 'targetType', new.target_type, 'reason', new.reason)
  from app_admins a
  where a.user_id is distinct from new.reporter_id;
  return new;
end;
$$;

create trigger notify_app_admins_of_report
after insert on reports
for each row execute function notify_app_admins_of_report();

-- ── Reviewing ─────────────────────────────────────────────────────────────
create policy "app admins can read every report"
on reports for select
using (current_user_is_app_admin());

-- Marks a report reviewed. The action itself (removing content,
-- suspending) is a separate call; this only records the outcome.
create function resolve_report(p_report_id uuid, p_status report_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_app_admin(auth.uid()) then
    raise exception 'Only an app admin can review reports.';
  end if;
  if p_status = 'open' then
    raise exception 'A report can''t be reopened.';
  end if;

  update reports
  set status = p_status, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_report_id;

  if not found then
    raise exception 'report not found';
  end if;
end;
$$;

revoke execute on function resolve_report(uuid, report_status) from public, anon;
grant execute on function resolve_report(uuid, report_status) to authenticated;

-- ── App admins can remove reported content anywhere ───────────────────────
-- The slice-2 rule, plus one clause: an app admin may remove any content,
-- in any Room, whatever their role there (usually none). Everything else
-- about can_remove_content() — and every removal function built on it — is
-- unchanged, and the removal is still logged with the Room's id, so the
-- Room's own mods see it in their moderation log.
create or replace function can_remove_content(p_room_id uuid, p_actor uuid, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_actor = p_author, false)
    or (is_room_moderator(p_room_id, p_actor) and room_rank(p_room_id, p_actor) > room_rank(p_room_id, p_author))
    or is_app_admin(p_actor);
$$;

-- remove_message() refused anyone but the author inside a DM ("a DM has no
-- moderators"). A reported DM is exactly what an app admin must be able to
-- remove, so they're the one exception.
create or replace function remove_message(p_message_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_kind conversation_kind;
  v_author_id uuid;
  v_snapshot jsonb;
  v_found boolean := false;
begin
  select true, c.room_id, c.kind, m.author_id,
         jsonb_build_object('text', m.text, 'image_url', m.image_url, 'voice_url', m.voice_url,
                            'conversation_id', m.conversation_id, 'created_at', m.created_at)
  into v_found, v_room_id, v_kind, v_author_id, v_snapshot
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.id = p_message_id and m.deleted_at is null;

  if not coalesce(v_found, false) then
    raise exception 'message not found';
  end if;

  if auth.uid() is distinct from v_author_id and not is_app_admin(auth.uid()) then
    if v_kind <> 'room_channel' then
      raise exception 'You can only remove your own messages in a direct message.';
    end if;
    if not can_remove_content(v_room_id, auth.uid(), v_author_id) then
      raise exception 'You can only remove messages by members below your role.';
    end if;
  end if;

  update messages
  set deleted_at = now(), removed_by = auth.uid(), removal_reason = p_reason
  where id = p_message_id;

  if auth.uid() is distinct from v_author_id then
    insert into moderation_actions (room_id, actor_id, action_type, target_user_id, target_type, target_id, content_snapshot, reason)
    values (v_room_id, auth.uid(), 'remove_message', v_author_id, 'message', p_message_id, v_snapshot, p_reason);
  end if;
end;
$$;
