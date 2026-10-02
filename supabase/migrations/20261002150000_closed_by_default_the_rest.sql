-- Phase 10, slice 7: what the full security re-check found.
--
-- The re-check is supabase/tests/security_invariants.js, the rules this
-- schema is meant to keep, read back from the catalogs. Run before this
-- migration it failed eight of them, and looking at one of those turned up
-- something worse than the rule it broke.
--
-- 1. THE VERIFICATION TOKEN WAS READABLE. A domain-verified Room admits
--    someone once they open a link emailed to an address at the Room's
--    domain; the token in that link is the proof they received the email.
--    The token lives in room_email_verifications, and "a user can see their
--    own verification requests" let a signed-in person read every column
--    of their own row, token included. So: ask for a link to be sent to
--    any address at the domain (the dean's will do), read the token over
--    the API, open the link. Reproduced on the local stack as a seed
--    account, over the real API: "You're verified!", an approved
--    membership, the email never seen. The 2026-09-16 audit closed
--    *writing* your own row; reading the secret out of it was still open.
--
--    The app reads email, verified_at and expires_at from that table, to
--    say "we sent a link to x". SELECT is now granted on every column but
--    the token. Same shape as profiles in slice 5: RLS picks rows, the
--    grant picks columns.
--
-- 2. A NEW TABLE WAS OPEN BY DEFAULT. Supabase's default privileges give a
--    table created by a migration to anon (read) and authenticated (read
--    and write, every column). RLS still decides rows, but this default is
--    where the all-columns grants slices 3 and 4 closed came from, and
--    slice 6's own new table had to revoke them by hand. Withdrawn, for
--    tables and sequences, as 20261002100000 did for functions. A new
--    table now needs explicit grants, which is what CLAUDE.md has said all
--    along.
--
-- 3. GRANTS THAT WEREN'T TRUE. anon held SELECT (and REFERENCES, TRIGGER)
--    on 24 tables and the inbox view, with no policy that ever let it read
--    a row. authenticated held TRUNCATE, REFERENCES or TRIGGER 50 times
--    over, none usable. All revoked.
--
-- 4. TWO POLICIES FOR "EVERYONE". The app-admin SELECT policies on reports
--    and account_suspensions named no role, so they applied to signed-out
--    callers too (who then failed on the function inside them). They are
--    for authenticated now.
--
-- 5. THREE POLICIES WITH NO GRANT. "authors can edit their own" on posts,
--    comments and messages date from before column grants; nothing can
--    update those tables today (architecture.md: no client edits yet). A
--    policy with no grant under it does nothing, but one stray grant would
--    turn it into silent editing, with no edited_at. Dropped. When editing
--    ships it brings its policy, its column grant and its trigger together.
--
-- 6. TWO INSERTS WITH NO RATE LIMIT. Hiding a post and voting in a poll.
--    60 a minute each, like likes and reactions.
--
-- 7. TEXT WITH NO LENGTH. Slice 6 limited what people type. Fifteen more
--    text columns take a value that starts with a client: a removal
--    reason (delete_post and friends take one as a parameter), a
--    moderation reason, the path of an uploaded file, a Room's accent
--    colour, the address a verification email goes to. Each gets a
--    ceiling. A file path is a path: 300 characters is several times the
--    longest the app produces (110). An accent colour is a six-digit hex
--    colour, which is all the app has ever sent.
--
-- No app change.

-- ---------------------------------------------------------------------
-- 1. The verification token is not for reading.
-- ---------------------------------------------------------------------

revoke select on room_email_verifications from authenticated;
grant select (id, room_id, user_id, email, verified_at, created_at, expires_at)
  on room_email_verifications to authenticated;

-- ---------------------------------------------------------------------
-- 2. New tables and sequences start closed.
-- ---------------------------------------------------------------------

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Grants that weren't true. (`tables` covers the my_inbox view too.)
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------
-- 4. Policies name their role.
-- ---------------------------------------------------------------------

alter policy "app admins can read every report" on reports to authenticated;
alter policy "app admins can see suspensions" on account_suspensions to authenticated;

-- ---------------------------------------------------------------------
-- 5. No policy without a grant.
-- ---------------------------------------------------------------------

drop policy "authors can edit their own, not-yet-removed posts" on posts;
drop policy "authors can edit their own, not-yet-removed comments" on comments;
drop policy "authors can edit their own, not-yet-removed messages" on messages;

-- ---------------------------------------------------------------------
-- 6. The two inserts slice 6 left unlimited.
-- ---------------------------------------------------------------------

create trigger rate_limit before insert on hidden_posts
  for each row execute function enforce_rate_limit('hide', 'minute', '60');

create trigger rate_limit before insert on poll_votes
  for each row execute function enforce_rate_limit('vote', 'minute', '60');

-- ---------------------------------------------------------------------
-- 7. The remaining text columns.
-- ---------------------------------------------------------------------

alter table posts
  add constraint posts_removal_reason_length check (removal_reason is null or char_length(removal_reason) <= 500);

alter table comments
  add constraint comments_removal_reason_length check (removal_reason is null or char_length(removal_reason) <= 500);

alter table messages
  add constraint messages_removal_reason_length check (removal_reason is null or char_length(removal_reason) <= 500),
  add constraint messages_image_url_length check (image_url is null or char_length(image_url) <= 300),
  add constraint messages_voice_url_length check (voice_url is null or char_length(voice_url) <= 300);

alter table moderation_actions
  add constraint moderation_actions_reason_length check (reason is null or char_length(reason) <= 500);

alter table account_suspensions
  add constraint account_suspensions_reason_length check (reason is null or char_length(reason) <= 500);

alter table post_media
  add constraint post_media_url_length check (char_length(url) <= 300);

alter table stories
  add constraint stories_media_url_length check (char_length(media_url) <= 300);

alter table profiles
  add constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 300),
  add constraint profiles_banner_url_length check (banner_url is null or char_length(banner_url) <= 300);

alter table rooms
  add constraint rooms_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 300),
  add constraint rooms_banner_url_length check (banner_url is null or char_length(banner_url) <= 300),
  add constraint rooms_accent_color_format check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$');

alter table room_email_verifications
  add constraint room_email_verifications_email_length check (char_length(email) <= 320);
