# Phase 8 — Notifications

> Study-book style: what exists, why each call was made, how the code
> works, and what went wrong along the way. Like Stories, this phase
> finished a table Phase 1 had already designed. `notifications`, its RLS
> and its type enum were all there, and nothing had ever written a row.
> The work was the fan-out: database triggers that decide who to tell,
> and the same webhook-to-push pipeline Phase 6 built for chat. Four
> problems only showed up on a real phone that same day, and one of them
> was a whole missing category of notification.

**Goal:** users know when something happened without polling.
**Exit condition (from `docs/roadmap.md`):** every event type in the
mock's `NOTIFICATIONS` array has a real trigger and a real push
notification.
**Status:** done, 2026-09-02. Replies, @mentions (in posts and comments),
aggregated likes, join requests and pinned posts each have a trigger and a
push. Two types the mock never had came in the same day, after
real-device testing: "posted in your Room" and "added a story". Mention
isolation was checked live. Later phases changed the delivery details:
see [§5.1](#51-what-was-not-covered-and-what-changed-later).

---

## 1. What this phase produced

```
supabase/migrations/
├── 20260902100000_notification_preferences_and_pin.sql   room_memberships.notifications_muted; toggle_post_pin()
├── 20260902100100_notification_triggers.sql              five SECURITY DEFINER trigger functions
├── 20260902100200_notify_activity_webhook.sql            notifications INSERT -> notify-activity Edge Function
├── 20260902110000_add_post_and_story_notification_types.sql   enum values, in their own transaction
├── 20260902110100_notify_on_new_content.sql              new_post / new_story fan-out to a Room's members
└── 20260902120000_register_push_token_rpc.sql            a device's token moves to whoever signs in on it

supabase/functions/
└── notify-activity/index.ts          one row in, one push per device token out, via Expo

mobile/src/
├── lib/notifications.ts              fetch, mark read, unread counts, realtime subscription
├── lib/push.ts                       registration now goes through register_push_token()
├── app/notifications.tsx             the Activity feed: Today / This week / Older
├── app/index.tsx                     a bell with an unread count in Home's header
├── app/c/[communityId]/settings.tsx  "Mute notifications from this Room"
└── app/c/[communityId]/post/[postId].tsx   Pin / Unpin for owners and mods
```

---

## 2. Decisions, and the reasoning behind each

### 2.1 Only the database writes notifications

`notifications` has no client INSERT policy, by design. If clients could
insert, anyone could put "@mara liked your post" into anyone's feed.
Every notification is written by a `SECURITY DEFINER` trigger on the
table where the event happened (`comments`, `posts`, `post_likes`,
`room_memberships`), the same pattern `add_owner_membership_on_room_created()`
set in Phase 1.

### 2.2 One mute rule, checked by every trigger

`room_memberships.notifications_muted` is one boolean per person per Room.
Every trigger checks it before inserting, rather than trusting each future
notification type to remember. So muting a Room silences replies,
mentions, likes, join requests and pins from that Room in one place.

### 2.3 A mention only reaches a member of that Room

`notify_mentions()` finds `@handles` in the text, then skips anyone who
isn't an approved member of the Room where the mention happened:

```sql
for v_handle in
  select distinct lower(m[1])
  from regexp_matches(p_text, '@([a-zA-Z0-9_]+)', 'g') as m
loop
  select id into v_user_id from profiles where lower(handle) = v_handle;
  if v_user_id is null or v_user_id = p_actor_id then
    continue;
  end if;
  if not is_room_member(p_room_id, v_user_id) then
    continue;
  end if;
  ...
```

Anything looser would tell a non-member that a Room exists, and show them
a line of its content, just because someone typed their handle. That's the
cross-Room leak the core invariant exists to prevent. Verified live with a
made-up handle and with a real user who isn't in the Room: both were
skipped.

### 2.4 Likes aggregate into one notification per post

"nadia and 4 others liked your post", not five separate rows. The like
trigger looks for an *unread* like notification for that post. If there
is one, it adds the liker to a `likerIds` array and bumps the time;
otherwise it inserts a new row:

```sql
select id, data->'likerIds' into v_existing_id, v_liker_ids
from notifications
where user_id = v_author_id and type = 'like' and read_at is null
  and data->>'postId' = new.post_id::text
order by created_at desc
limit 1;

if v_existing_id is not null then
  if not (v_liker_ids ? new.user_id::text) then
    v_liker_ids := v_liker_ids || to_jsonb(new.user_id::text);
  end if;
  update notifications
  set actor_id = new.user_id, created_at = now(), data = jsonb_set(data, '{likerIds}', v_liker_ids)
  where id = v_existing_id;
```

Once the author has read it, the next like starts a fresh row, so a new
wave of likes gets noticed. The push title uses the array's length ("…and
4 others").

### 2.5 Pinning is a narrow RPC, not a wider policy

Mods needed to pin posts. The obvious route, an UPDATE policy on `posts`
for mods, would also have let them write every other column, including the
soft-delete fields, before Phase 9 had any process around removal. So
`toggle_post_pin()` is a `SECURITY DEFINER` function that checks
`is_room_moderator()` and changes exactly one column.

### 2.6 Push reuses Phase 6's pipeline exactly

```sql
create trigger notify_activity
after insert on notifications
for each row execute function supabase_functions.http_request(
  'http://edge_runtime:8081/notify-activity', 'POST', ...
```

Every notification row fires a Database Webhook into the `notify-activity`
Edge Function. The function looks up the actor's name, the Room's name and
the recipient's push tokens, builds a title per type, and sends one Expo
push per device. Chat messages keep their own pipeline
(`notify-new-message`, Phase 6); everything else goes through this one.

### 2.7 A third bucket in the feed

The mock grouped the Activity feed into "Today" and "This week". A real
feed accumulates forever, so there's a third bucket:

```ts
function groupFor(iso: string): Group {
  const created = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (created >= startOfToday) return 'Today';
  const weekAgo = new Date(startOfToday);
  weekAgo.setDate(weekAgo.getDate() - 7);
  return created >= weekAgo ? 'This week' : 'Older';
}
```

Calendar days, not elapsed hours: something from 11pm yesterday is
"This week" the moment midnight passes.

---

## 3. Bugs found on the real phone, the same day

### 3.1 A Room's own members were never told about new posts

Tobi posted in Grit Club, and Eve, an approved member, got nothing. The
mock's list only had notifications *about you* (your comment, your post,
your Room). Nothing covered "someone posted in a Room you're in", which
looks broken as soon as a Room has two active people.

The fix is two more triggers, `notify_on_new_post` and
`notify_on_new_story`, fanning out to every approved, unmuted member
except the author. Their enum values (`new_post`, `new_story`) had to go
in a migration of their own first. Postgres rejects using an enum value
added earlier in the same transaction, and each migration file is one
transaction, so the split was required, not stylistic. The same rule came
up again in Phase 9.

### 3.2 The Activity feed failed to load: an ambiguous join

`notifications` has two foreign keys to `profiles`: `user_id` (the
recipient) and `actor_id` (who did it). The feed's query embedded
`profiles(handle, name)` without saying which, and PostgREST refused the
whole query with `PGRST201`. It's the same class of bug `posts` hit in
Phase 4. The fix names the constraint:
`profiles!notifications_actor_id_fkey`. Typecheck and lint can't see
this; only opening the screen does.

### 3.3 Switching accounts on one phone broke push

An Expo push token belongs to the device and app install, not to the
account. When a second account signed in on the same phone, registration
tried to update a `push_tokens` row the first account owned. RLS
(`user_id = auth.uid()`) correctly refused, and the error was swallowed,
so the new account silently got no pushes. The fix is a narrow RPC that
moves the token to whoever is signed in now:

```sql
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
```

It uses `auth.uid()`, never a user id from the client, so you can only
ever claim a token for yourself.

Applying it with `supabase migration up`, rather than a full reset, then
failed with `PGRST202`: PostgREST hadn't reloaded its schema cache. A
full reset does that as a side effect, but `migration up` doesn't.
`NOTIFY pgrst, 'reload schema';` fixed it.

### 3.4 A realtime channel name collided under React's double-run

In development React runs an effect twice on mount. The notifications
subscription reused its channel name, and Supabase rejects adding a
listener to a channel that has already subscribed. The fix
(`6c1d403`) gives each subscription a unique name, the same fix the chat
channels got the day before (decision-log, 2026-09-01, "fixed for the
whole class at once"). The notifications module was new, so it hadn't
been covered.

### 3.5 Worth knowing: `db reset` also resets data

A reset needed for one of these migrations wiped Eve's Grit Club
membership. She had joined during testing, and it was never in
`seed.sql`, so she stopped getting notifications she'd been getting
minutes earlier. That isn't a bug, but anyone mid-test needs telling when
it happens. Later phases apply migrations with `migration up` for exactly
this reason.

---

## 4. Seed data cleaned up

`seed.sql` had two hand-written notification rows from Phase 1 whose
shape didn't match what the triggers produce: `post_id` instead of
`postId`, and a join request with no pending membership behind it. Both
were removed. A real pending membership was added instead: Rui requesting
to join Sourdough Sunday. That Room is `request`-visibility; in the
seed's `public` Rooms, joining approves instantly, so a pending row can't
exist.

---

## 5. Verification: what was actually tested

- **The exit condition** was recorded as met: every type in the mock
  (reply, mention in a post, mention in a comment, like, join request,
  pin) has a trigger and a push (decision-log, 2026-09-02). The log
  doesn't list a separate on-device push check for each type.
- **Recorded as checked live:**
  - mention isolation: a made-up handle and a real non-member were both
    skipped
  - a post by Tobi produced a `new_post` notification for every other
    approved member
  - the ambiguous-join fix, checked against PostgREST directly with the
    service key before trusting the app's version
- **The account-switch fix** is recorded as found through real use on the
  phone. The log describes the fix and the schema-cache reload it needed,
  not a separate re-check afterwards.

### 5.1 What was not covered, and what changed later

- **Unliking** doesn't shrink or remove the aggregated like notification.
  Nothing in the app needed it when this was built.
- **Pushes were sent at normal priority** until 2026-09-22. Android's
  Doze held them while the phone was locked, so they came late. Both push
  functions now send `priority: 'high'`, verified in forced deep idle.
- **The push functions trust any caller** holding the public anon key
  (found 2026-09-22). The webhook's `Authorization` header is the anon
  key, and the functions take the notification from the request body. It's
  a Phase 10 item, due before the backend is hosted.
- **Phase 9 added:**
  - `report_filed`, which sends reports to app admins with no actor, so
    the reporter is never named
  - a trigger that drops any notification between two people who have
    blocked each other, which stops the push too
- **The pin action later moved** from the post screen into the post's ⋯
  menu (Bones Phase), when feed posts stopped opening a page.

---

## 6. Concepts worth knowing

- **Who may write a table** is part of its security, not just who may
  read it. A feed anyone can insert into is a spoofing tool.
- **Put a rule in one place.** Muting is checked by every trigger, and
  mention isolation lives in one function, so a new notification type
  can't forget them.
- **Name the foreign key when a table has two paths to the same one.**
  `profiles!notifications_actor_id_fkey`, not `profiles`.
- **Enum values need their own migration** before anything uses them.
- **Device tokens aren't per account.** Anything keyed on a device has to
  handle a second person signing in on it.

---

## What's next

The Bones Phase: a polish and performance pass over everything Phases
0–8 built, before Trust & Safety adds more screens. See
[`bones.md`](bones.md).
