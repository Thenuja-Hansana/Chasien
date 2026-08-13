# Phase 1 — Core Data Model & Backend

> Study-book style: explains what exists, why each non-obvious call was
> made, how the code actually works, and — because this phase produced
> real ones — the bugs that only showed up when it was actually run
> against a live database. If Phase 0 was "here's the skeleton," this one
> is "here's the thing everything else's safety depends on."

**Goal:** the schema and permission rules that everything else depends on.
**Exit condition (from `docs/roadmap.md`):** every table has RLS on, a
second test user genuinely cannot read a Room they're not a member of —
verified by hand, not assumed because it compiled.
**Status:** done, and actually verified against a live local Postgres
instance — see [§5](#5-verification-what-was-actually-tested).

---

## 1. What this phase produced

```
supabase/
├── migrations/
│   ├── 20260813051157_extensions_and_enums.sql
│   ├── 20260813051204_identity_and_rooms.sql       profiles, rooms, room_memberships
│   ├── 20260813051209_chat.sql                     conversations, participants, messages
│   ├── 20260813051214_feed.sql                      posts, comments, likes, polls
│   ├── 20260813051219_stories.sql
│   ├── 20260813051224_notifications.sql
│   ├── 20260813051229_trust_and_safety.sql          reports, blocks, moderation_actions
│   ├── 20260813051235_row_level_security.sql        every RLS policy, in one place
│   └── 20260813073524_grants.sql                    table-level GRANTs (found missing — §4.1)
└── seed.sql                                         local dev data, ported from app_reference
```

19 tables, 3 `security definer` helper functions, 8 triggers, one
1,000+-line RLS migration. All of it runs locally via `supabase start`
(needs Docker Desktop running — see Phase 0's concepts section for why).

## 2. The core invariant, restated

Every table's access control ultimately answers one question: *is this
user an approved member of the Room this content belongs to?* That
question is asked so often it's a reusable function
(`is_room_member(room_id, user_id)`), not a hand-copied subquery — see
§3.1. Getting this one function right, and using it consistently instead
of re-deriving the check inline everywhere, is most of what makes the
rest of the schema trustworthy.

## 3. Decisions, and the reasoning behind each

The compressed versions live in `docs/decision-log.md` (three 2026-08-13
entries: "Phase 1 schema," a same-day correction, and "Two real bugs
found by actually running Phase 1's migrations"). Fuller reasoning here.

### 3.1 Unified chat, synced by trigger instead of branching in RLS

The mock's `Chats.jsx` shows one inbox mixing Room group-channels and 1:1
DMs. A single `conversations` table (`kind`: `room_channel` | `dm`)
matches that — but naively, "who can read this conversation" would mean
two different things depending on `kind`: for a DM, a row in
`conversation_participants` *is* the membership; for a Room channel,
membership is really `room_memberships`, and `conversation_participants`
would just be per-user preferences (muted/pinned/`last_read_at`) layered
on top.

That asymmetry is the actual risk — not the unified table itself. An RLS
policy that has to branch on `kind` to decide which table to trust is
exactly the kind of conditional logic that's easy to get subtly wrong on
the one class of table (chat) where wrong means real people read real
private messages.

**The fix:** three triggers (in `chat.sql`) keep `conversation_participants`
*always* correct for Room channels, so by the time any RLS policy runs,
there's no asymmetry left to branch on:

- `sync_channel_participants_on_membership_change` — fires on
  `room_memberships` insert/update/delete. When a membership's
  `join_state` becomes `approved`, it inserts a `conversation_participants`
  row for that user into every `room_channel` conversation in that Room.
  When it stops being `approved` (or the membership row is deleted), it
  removes those rows.
- `seed_participants_on_conversation_created` — fires on `conversations`
  insert. For a new `room_channel`, backfills every currently-approved
  member (covers "new channel, existing members," the case the trigger
  above doesn't). For a new `dm`, seeds both participants directly, since
  a DM has no `room_memberships` to derive from.

Every RLS policy on `messages`, `conversation_participants`, and
`conversations` then asks exactly one question, with no `kind` branch
anywhere: *does a `conversation_participants` row exist for
`(conversation_id, auth.uid())`?*

### 3.2 Polymorphic `reports`/`moderation_actions`, hardened instead of split

`target_type`/`target_id` on `reports` (and the equivalent on
`moderation_actions`) can point at a post, a comment, a message, or a
user — a polymorphic association, which normally means no real foreign
key. The alternative (one table per reportable type) was rejected because
it turns "show me every open report" — the entire point of a moderation
queue — into a permanent N-way `UNION`, and grows by a table every time a
new reportable thing is added.

Instead, hardened three ways:

1. **Every table uses a UUID primary key**, no exceptions. A wrong
   `target_type` can now only fail as "not found" — it's practically
   impossible for it to accidentally resolve to some *other* real row in
   the wrong table.
2. **`content_snapshot jsonb`**, captured at write time. A report or audit
   entry stays fully reviewable even if the original row is later
   soft-deleted, hard-deleted, or its text scrubbed — the review doesn't
   depend on the source still existing.
3. **An insert-time trigger** (`validate_polymorphic_content_target`,
   shared by both tables since they have identically-named
   `target_type`/`target_id` columns) that rejects an insert if the
   referenced row doesn't actually exist — the direct fix for "a bad
   insert silently creates a dangling reference."

### 3.3 Moderation removal is a soft delete

`posts`, `comments`, and `messages` all carry `deleted_at` / `removed_by`
/ `removal_reason` instead of ever being hard-deleted by a moderation
action. Two reasons: it gives `reports`/`moderation_actions` something to
point at even after removal (a second safety net beyond the snapshot),
and it means an author can see that their own content was removed (RLS
lets the author and room moderators see a soft-deleted row; everyone else
gets nothing — see the `posts`/`messages` SELECT policies).

### 3.4 `room_memberships` — reads via RLS, writes via nothing (yet)

This table has SELECT policies but *zero* INSERT/UPDATE/DELETE policies
for the `authenticated` role. Every write — joining a Room, approving a
join request, inviting someone, changing a role, leaving — is planned to
go through an Edge Function using the service role (Phase 2/4 work, not
built yet). The one exception is the owner's initial row, created
atomically by a trigger the moment a Room is created
(`add_owner_membership_on_room_created`), not by a client insert.

This was a deliberate escalation beyond what was strictly asked: writes
to this specific table were judged high-risk enough that a bug in
application code (testable, readable) was preferred over a bug in a
complex RLS `WITH CHECK` expression (harder to eyeball, and the one place
a mistake is a real privacy/permissions leak, not a UI glitch).

### 3.5 Everything else decided explicitly, not left implicit

- **Delete behavior per relationship:** a deleted user's past content
  (`posts.author_id`, `messages.author_id`, etc.) is `SET NULL`, not
  cascaded — their posts stay in other people's feeds/threads, rendered
  as "Deleted user," rather than leaving holes. Deleting a **Room**, by
  contrast, cascades its posts/channels/messages/stories — the product
  frames a Room as self-contained, so its contents going with it is the
  intended behavior.
- **Exactly one owner per Room** — a partial unique index on
  `room_memberships (room_id) WHERE role = 'owner'`. See §4.2 for why
  this is *not* a deferrable constraint, despite an earlier draft saying
  it was.
- **Room channel names** are unique per Room; **DM pairs** are unique too
  — `conversations` stores `dm_user_a`/`dm_user_b` in canonical sorted
  order (`dm_user_a < dm_user_b`, `CHECK`-enforced) specifically so
  "does a DM already exist between these two people" is one indexed
  lookup, not a set-intersection query.
- **Comment nesting is capped at one level by a trigger**
  (`enforce_single_level_comment_replies`), not just an app-code
  assumption — a reply-to-a-reply is rejected at insert time.
- **A `pending` join request gets zero content access** — identical to a
  non-member — until approved. The more conservative of two readings,
  chosen deliberately: loosening this into a preview later is safe,
  tightening it after the fact is not.

## 4. Two real bugs, found by actually running it

The roadmap's exit condition specifically says "verify by hand, don't
assume the policy is correct because it compiles." Taken literally, this
caught two things that a syntax check never would have.

### 4.1 Missing GRANTs — RLS is not the only permission layer

The first attempt to simulate a user (`SET ROLE authenticated; SET
request.jwt.claims ...`) and run a query failed instantly:

```
ERROR:  permission denied for table posts
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.posts TO authenticated;
```

This is easy to misread as an RLS rejection. It isn't — it's a plain
Postgres privilege error, checked *before* RLS policies are even
consulted. A freshly created table grants nothing to anyone but its
owner; RLS policies only matter once a role already has base
table-level permission to attempt the operation at all. The fix
(`grants.sql`) grants `SELECT, INSERT, UPDATE, DELETE` on every table to
`authenticated` broadly, and leans on RLS for 100% of the actual
row-level restriction — which is safe precisely because RLS is
deny-by-default: granting `UPDATE` on `room_memberships` does nothing on
its own, since that table has no `UPDATE` policy for `authenticated` at
all (§3.4). Nothing is granted to `anon` — every table here requires a
signed-in user.

### 4.2 Two Postgres subtleties, both only discoverable by running the SQL

**A partial unique index can't be a deferrable constraint.** The original
`one_owner_per_room` migration tried:

```sql
alter table room_memberships
  add constraint one_owner_per_room
  unique using index one_owner_per_room
  deferrable initially deferred;
```

Postgres rejected it: `SQLSTATE 42809`, "cannot create a primary key or
unique constraint using such an index" — because deferrability is a
table-constraint property, and a table constraint, by definition, can't
be partial (`WHERE role = 'owner'`). The fix: drop the constraint
conversion, keep the plain partial unique **index**. It's not deferred,
which means an ownership-transfer transaction must demote the old owner
*before* promoting the new one, in that statement order — promoting
first would transiently create two owner rows and get rejected. A plain,
non-deferred index is still sufficient for this because it only checks
uniqueness at the end of each statement, not each row; done in the right
order, there's never an instant with two owners for it to catch.

**A self-referential RLS policy recurses.** The `conversation_participants`
"see other participants in my conversations" policy originally queried
`conversation_participants` from inside its own policy:

```sql
using (
  user_id = auth.uid()
  or exists (
    select 1 from conversation_participants self
    where self.conversation_id = conversation_participants.conversation_id
      and self.user_id = auth.uid()
  )
);
```

This looked safe on paper — the inner row matching `self.user_id =
auth.uid()` should satisfy the policy via its first branch without
recursing further. In practice, Postgres raised `infinite recursion
detected in policy for relation "conversation_participants"`: the inner
subquery's scan of the same table has RLS applied to *it* too, which
means evaluating the same policy again, which scans the table again.
Postgres detects the cycle rather than looping forever, but it detects it
as an error, not a graceful fallback.

The fix was the same pattern already used everywhere else in this
schema, just applied consistently: a `security definer` helper function
(`is_conversation_participant`). Its internal query runs as the
function's owner, bypassing RLS on that inner lookup entirely, which
breaks the cycle. `is_room_member`, `is_room_moderator`, and
`is_room_owner` all already worked this way — not because recursion was
anticipated for those, but because it was the natural way to avoid
repeating the same subquery a dozen times across the RLS file. The habit
of centralizing repeated checks into `security definer` functions turned
out to double as the fix for a bug that only showed up in the one place
that habit wasn't followed.

## 5. Verification: what was actually tested

Via `docker exec supabase_db_chasien psql`, simulating specific users
with `SET ROLE authenticated; SET request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}'`
— the same mechanism PostgREST uses to enforce RLS per-request, run
directly so the results are the real policy evaluation, not a guess
about it.

| Check | Result |
|---|---|
| `outsider` (member of nothing) reads grit-club's posts (2 real rows exist) | **0** |
| `outsider` reads grit-club's `room_memberships` roster | **0** |
| `outsider` reads ilford-nights' darkroom messages (3 real rows exist) | **0** |
| `outsider` reads grit-club's stories (2 real rows exist) | **0** |
| `outsider` reads the Room *listing* (slug + visibility, all 3 Rooms) | **all 3** — listing ≠ content access, as designed |
| `mara` (real grit-club member) reads grit-club's posts | both real posts, correct text |
| `mara` (not a sourdough-sunday member) reads its membership roster | **0** |
| `eve` (sourdough-sunday's actual owner) reads its membership roster | **1** (herself) |
| `mara` (real ilford-nights member) reads the darkroom messages | all 3, correctly attributed |
| `outsider` attempts to `INSERT` a post into grit-club directly | **rejected** — `new row violates row-level security policy` |

The seed data's row counts also independently confirmed the sync
triggers from §3.1 work: `conversation_participants` landed at exactly 8
rows with zero manual inserts for Room channels — 4 in grit-club's
`general` (its 4 approved members), 2 in ilford-nights' `darkroom`, and 2
in the seeded DM — exactly what the trigger logic predicts, not just what
it was designed to do.

### 5.1 Second pass: every custom constraint and trigger, positive and negative

The table above proves Room isolation, the specific thing the roadmap's
exit condition names. It doesn't touch the rest of the custom logic —
the constraints and triggers that only exist because of the design
choices in §3. A second round, deliberately hitting both the "this
should work" and "this should be rejected" side of each one:

| Check | Expected | Result |
|---|---|---|
| `nadia` (hasn't voted) casts a poll vote | succeeds | ✅ |
| `nadia` votes again in the *same poll*, different option | rejected | ✅ `poll_votes_pkey` — one vote per poll, not per option (§ feed migration) |
| `kwame` replies to a reply | rejected | ✅ custom trigger message, "comments are only one level deep" |
| second channel named `general` in grit-club | rejected | ✅ `room_channel_name_unique` |
| second DM between mara and tobi (one exists) | rejected | ✅ `dm_pair_unique` |
| a *different* user made a second owner of grit-club | rejected | ✅ `one_owner_per_room` — see note below |
| a report targeting a post id that doesn't exist | rejected | ✅ custom trigger message, `validate_polymorphic_content_target` |
| `members_can_post = false`, a non-mod member posts | rejected | ✅ RLS |
| `members_can_post = false`, the owner posts anyway | succeeds | ✅ "mods always can" clause in the INSERT policy |
| a member joins grit-club | auto-added to `#general` | ✅ sync trigger, checked live via a fresh row count |
| that member leaves grit-club | auto-removed from `#general` | ✅ sync trigger |
| an expired story, room member reads the Room's stories | not counted | ✅ 2 active shown, the expired one excluded |
| `mara` blocks `kwame` | `kwame` can't see he's blocked | ✅ 0 rows visible to the blocked party |

**One test needed a redo, worth keeping as a lesson rather than editing
away:** the first attempt at "can't have two owners" used `nadia` as the
second owner — but `nadia` is already a grit-club *member*, so the insert
collided with the `room_memberships` primary key `(room_id, user_id)`
before it ever reached the `one_owner_per_room` check. That's a real
result (you can't insert a duplicate membership row either), just not
the one the test claimed to prove. Re-run with `outsider` — a user with
*no* existing grit-club row — it hit `one_owner_per_room` specifically,
as intended. A negative test needs to fail for the *reason under test*,
not just fail for some reason.

## 6. Concepts worth knowing before Phase 2

- **GRANT and RLS are two separate gates, both required.** GRANT is
  coarse — "can this role attempt a `SELECT` on this table at all."
  RLS is fine-grained — "which specific rows." A table needs both a
  GRANT and a permissive policy to be readable; missing either one
  denies everything, but they fail with different error messages
  (`permission denied` vs. simply zero rows / a rejected write).
- **`security definer` functions run as their owner, not as the caller.**
  That's what lets a helper function's internal query bypass RLS
  deliberately — useful for exactly two things in this schema: computing
  a yes/no membership check without re-triggering the calling policy, and
  letting a trigger (like the chat sync triggers) write to a table the
  triggering user has no direct write access to.
- **A partial index (`WHERE ...`) is not the same kind of object as a
  table constraint**, even though `UNIQUE` partial indexes and `UNIQUE`
  constraints look similar in a `\d` listing. Constraints can be
  deferrable; indexes alone can't be, and a partial index can't be
  converted into one.
- **RLS policies are combined with `OR` within the same command type.**
  `room_memberships` has two separate `SELECT` policies ("own row" and
  "moderator sees every row in their room") — a request is allowed
  through if *either* matches, not both.

## What's next

**Phase 2 — Auth.** Real Supabase Auth (email/password), secure session
storage in the RN app, and the Login/Sign Up screens ported from the
mock. This is also where the `room_memberships` write path predicted in
§3.4 (join/approve/invite/role-change Edge Functions) starts getting
built — see `docs/roadmap.md` Phase 2 and Phase 4.
