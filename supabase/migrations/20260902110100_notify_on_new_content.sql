-- Phase 8 follow-up: the original trigger set (20260902100100) only ever
-- notified the person a comment/like/mention/pin was *about* — plain
-- "someone posted in a Room you're in" had no trigger at all, which
-- looked like a bug the moment a Room had more than one active member
-- (an approved member seeing zero notifications for a Room-mate's new
-- post/story). Same fan-out shape as notify_on_join_request/
-- notify_on_post_pinned: every approved member except the author,
-- skipping anyone who's muted this Room.

create function notify_on_new_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, type, actor_id, room_id, data)
  select rm.user_id, 'new_post', new.author_id, new.room_id,
    jsonb_build_object('postId', new.id, 'preview', left(coalesce(new.text, ''), 140))
  from room_memberships rm
  where rm.room_id = new.room_id
    and rm.join_state = 'approved'
    and rm.user_id <> new.author_id
    and not rm.notifications_muted;

  return new;
end;
$$;

create trigger notify_on_new_post
after insert on posts
for each row execute function notify_on_new_post();

create function notify_on_new_story()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, type, actor_id, room_id, data)
  select rm.user_id, 'new_story', new.author_id, new.room_id,
    jsonb_build_object('storyId', new.id)
  from room_memberships rm
  where rm.room_id = new.room_id
    and rm.join_state = 'approved'
    and rm.user_id <> new.author_id
    and not rm.notifications_muted;

  return new;
end;
$$;

create trigger notify_on_new_story
after insert on stories
for each row execute function notify_on_new_story();
