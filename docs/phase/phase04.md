# Phase 4 — Rooms Core

> Study-book style: what exists, why each call was made, how the code
> works, and — because live verification with two real accounts found
> three genuinely instructive ones — the bugs that only showed up when
> the whole system actually ran together, not when any one part of it
> was read in isolation.

**Goal:** Discover, join, and own a Room for real.
**Exit condition (from `docs/roadmap.md`):** two real accounts, one
creates a private Room, the other cannot see it until invited/approved.
**Status:** done — verified end to end against the live local stack with
two real accounts, across all three join flows, role management, and the
privacy guarantee the exit condition is actually about. See
[§5](#5-verification-what-was-actually-tested).

---

## 1. What this phase produced

```
supabase/
├── functions/room-membership/index.ts    every room_memberships mutation
└── migrations/
    ├── 20260814044514_service_role_grants.sql
    └── 20260814044612_room_creator_can_always_see_own_room.sql

mobile/src/
├── lib/rooms.ts                          all Room data access + mutations
└── app/
    ├── index.tsx                         Home: real "my Rooms" list
    ├── discover.tsx                      real Discover, real join/request
    ├── create-community.tsx              real Create Room
    └── c/[communityId]/
        ├── index.tsx                     real membership-gated Room feed
        └── settings.tsx                  real settings + role management
```

One Edge Function, two migrations, one new client-side data module, five
screens rewired from Phase 3's empty-state shells to real reads and
writes.

## 2. Decisions, and the reasoning behind each

Compressed versions in `docs/decision-log.md` (2026-08-14 entries).
Fuller reasoning here.

### 2.1 Most of Rooms core needed no Edge Function at all

Phase 1's schema (`docs/phase/phase01.md`) already did the hard part:
`rooms`' RLS policies allow any authenticated user to `insert` a room
they own, and let owners/mods `update` it directly — both plain
client-side calls, no custom backend code needed. An `AFTER INSERT`
trigger (`add_owner_membership_on_room_created`, Phase 1) atomically
gives the creator an `owner` row the moment the room exists. So:
**Discover, Create Room, and Community Settings' visibility/description/
members-can-post fields are all direct Supabase client calls** —
`rooms.select()`, `rooms.insert()`, `rooms.update()` — with RLS doing
100% of the access control, exactly the pattern Phase 1 set up. Only
`room_memberships` writes (join, approve, invite, accept, role change)
needed an Edge Function, because that table was deliberately built with
*zero* client write policies (Phase 1, "the most sensitive table in the
schema"). This split — some mutations are plain RLS-gated client calls,
others go through a function — isn't inconsistent; it's exactly what
Phase 1 designed for, followed through rather than routing everything
through a function "to be safe."

### 2.2 One Edge Function, action-routed, not five

`join`, `respond_to_request`, `invite`, `respond_to_invite`, and
`change_role` all live in one function
(`supabase/functions/room-membership/index.ts`), dispatched on an
`action` field in the request body, rather than five separate deployed
functions. They share the same two concerns on every call — identify the
caller from their own JWT (never trust an identity claimed in the
request body), then use a service-role client to bypass RLS entirely and
apply the actual business rules in code. Splitting into five functions
would mean five copies of that shared setup for a solo-dev project with
no deployment-granularity reason to prefer it.

### 2.3 Routes stay keyed by slug, not the Room's UUID

`rooms.id` is a UUID; `rooms.slug` is the human-readable identifier
(`chasien.app/dawn-patrol`, matching the mock's `CreateCommunity.jsx`
preview). Phase 3's routes already used `:communityId` as a plain string
param with no assumption about its shape — this phase settles that it
holds the *slug*, resolved to the room's UUID via one query
(`fetchRoomBySlug`) whenever a screen needs the id for a mutation. Clean
URLs over raw UUIDs in the address bar, and no route files needed
renaming to land on this.

### 2.4 Room-scoped screens don't redesign the mock, but do simplify it

`CreateCommunity.jsx`'s "Who can join" three-option list (public/
request/invite, with icon + description each) ported almost verbatim —
it already matches `rooms.visibility`'s three real values exactly.
`CommunitySettings.jsx`'s boolean "Public community" toggle, though,
doesn't fit a three-valued enum without losing information, so Settings
uses the same three-option picker as Create Room instead of porting a
lossy toggle — a more correct translation of the mock's intent (there
*is* a real "who can join" control) rather than a redesign of it. The
mock's live theme-color picker and banner editor in Settings aren't
built this phase; visibility, description, members-can-post, and role
management are what the roadmap's checklist actually asks for.

### 2.5 What's deliberately not built this phase

- **Kicking/muting a member** — explicitly Phase 9's "Mod actions:
  remove post/comment, mute/remove member," not this phase's.
- **Leaving a Room** — not in this phase's checklist either; the
  `room-membership` function doesn't have a `leave` action yet. Worth
  noting as a real gap (there's currently no way out of a Room you've
  joined) rather than silently deferring it without saying so.
- **Ownership transfer UI** — `change_role`'s handler already implements
  it correctly (demote-then-promote, respecting the partial unique index
  — see §3.3), but no screen exposes a "make owner" button. The
  checklist asked for "role management (owner/mod)," which promote/
  demote between member and mod satisfies; transfer stays available for
  whenever a screen actually needs it.

## 3. Code walkthrough

### 3.1 `lib/rooms.ts` — data reads vs. Edge-Function mutations, kept visibly separate

```ts
export async function fetchDiscoverRooms() {
  const { data, error } = await supabase.from('rooms').select(/* ... */);
  // ...
}

async function callRoomMembership(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('room-membership', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  return data;
}
```

`supabase.functions.invoke()`'s error handling is easy to get wrong: on
a non-2xx response, `data` comes back `null` and the actual error body
has to be read asynchronously off `error.context` (a `Response` object),
not off `data` — confirmed against the current SDK docs before writing
this, not assumed from a remembered older pattern, since this is exactly
the kind of API surface that changes across versions.

### 3.2 `functions/room-membership/index.ts` — identity from the JWT, privilege from a second client

```ts
const callerClient = createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
});
const { data: { user } } = await callerClient.auth.getUser();
if (!user) return json({ error: 'Not authenticated.' }, 401);

const admin = createClient(supabaseUrl, serviceRoleKey);
```

Two clients, two purposes, never confused: `callerClient` answers "who
is this, really" by validating the caller's own JWT — a request can't
claim to act as anyone else by putting a different user id in the body.
`admin` bypasses RLS entirely for the actual writes, which is safe here
specifically *because* every handler enforces the real business rule in
code first (caller must be a mod, target must have a pending row, etc.)
— see `requireModerator()` and each `handle*` function.

### 3.3 Ownership transfer's two-statement ordering

```ts
// one_owner_per_room is a partial unique index, not a deferrable
// constraint (see the migration's comment) — the old owner MUST be
// demoted in its own statement before the new owner is promoted, or
// the promote step violates the index while both rows are 'owner'.
await admin.from('room_memberships').update({ role: 'member' }).eq('room_id', roomId).eq('user_id', callerId);
await admin.from('room_memberships').update({ role: 'owner' }).eq('room_id', roomId).eq('user_id', targetUserId);
```

Directly implements the ordering constraint Phase 1's schema migration
called out by name as "Phase 4 work" — `one_owner_per_room` rejects a
moment with two `owner` rows for the same Room, so the demote has to
fully complete before the promote runs, not just be issued first in the
same batch.

### 3.4 Room Settings closes over a re-narrowed `const`, not the union-typed state

```ts
if (!room || !isModerator) { return (/* ... */); }

// A fresh binding with its own narrowed type — `room` itself stays a
// `Room | 'loading'` union as far as TS is concerned inside a closure,
// even though the guards above already ruled out anything but `Room`.
const currentRoom: Room = room;

async function handleSave() {
  await updateRoomSettings(currentRoom.id, /* ... */);
}
```

TypeScript's control-flow narrowing doesn't survive into a nested
closure for a union-typed variable, even a `const` one — `handleSave`
referencing `room.id` directly still typechecks as `Room | 'loading'`
even though the guard above already ran. Assigning the narrowed value to
a *new* binding gives that binding its own concrete type, which a
closure can safely reference. Worth remembering any time a guard clause
narrows state that async handlers defined later in the same component
need to use.

## 4. Three real bugs, found by verifying with two real accounts

All three passed `tsc --noEmit` and `expo lint` clean, both immediately
before and after. None would have been caught by either. Full technical
detail in `docs/decision-log.md`'s "Three real bugs found verifying
Phase 4" entry — summarized here with the verification angle that
actually surfaced each one.

**`service_role` had no table grants.** BYPASSRLS (which `service_role`
has) skips row-level security *policies* — a separate Postgres layer
from ordinary table GRANTs, which are still enforced regardless. Nobody
had granted `service_role` anything on `public`, the same exact bug
`20260813073524_grants.sql` fixed for `authenticated` back in Phase 1,
just for a different role, undiscovered until an Edge Function actually
ran a query against a live database. Surfaced as misleading 404s
("Room not found") on join/approve/invite/role-change — every single
`room_memberships` mutation, since they all go through the same
service-role client.

**Creating an invite-only Room failed every time.** `42501`, specifically
and only for `visibility = 'invite'`. `INSERT ... RETURNING` re-checks
the table's SELECT policy on the row being returned, in the same
statement — and the owner's `room_memberships` row (which the original
policy needed, to let a creator see their own invite-only room) is
created by an `AFTER INSERT` trigger whose insert that recheck didn't
see. Public/request rooms never hit this, since their SELECT policy
already admits any authenticated user unconditionally. Fixed at the
policy level (a creator can always see their own room, full stop) rather
than restructuring the client into two round trips — the timing quirk
was a symptom, "a creator can't see their own newly-created room" was
the actual bug.

**Room Settings' member list never loaded, for any Room.**
`room_memberships` has two foreign keys to `profiles` (`user_id` and
`invited_by`) — PostgREST's implicit embedding
(`select('...profiles(handle, name)')`) can't tell which one to follow
and rejects the query outright (`PGRST201`), unconditionally, regardless
of data. This silently broke "Requests to join" and "Roles" for every
Room from the moment the code was written — passing typecheck, passing
lint, failing the instant a real Settings screen tried to render real
members. Naming the constraint
(`profiles!room_memberships_user_id_fkey(...)`) resolves it.

**Why this is worth restating precisely, again:** all three live at the
boundary between two systems — Postgres privileges vs. RLS policies; a
trigger vs. the statement that fired it; a foreign key vs. PostgREST's
embedding inference. That's exactly the category of bug where "it
typechecks and the logic reads correctly" provides no signal at all,
and only running the real system end to end does.

## 5. Verification: what was actually tested

Two full rounds against the live local stack, using two real accounts
(unique signups, confirmed via Mailpit's API, logged in through the
actual `/login` screen — not API shortcuts) in two isolated browser
contexts simultaneously, since most of these flows need both sides
interacting.

**Round 1** (before the fixes in §4): 2 of 7 scenarios passed (public and
request-to-join room *creation* only). Every membership-mutating action
failed — this is what surfaced all three bugs.

**Round 2** (after the fixes, against a freshly-reset database): all 7
passed clean.

| # | Scenario | Result |
|---|---|---|
| 1 | Create Room, public visibility → lands in the real feed | ✅ |
| 2 | B joins the public Room instantly (no approval step) | ✅ |
| 3 | Create Room, request-to-join visibility | ✅ |
| 4 | B requests → sees "pending approval," not the feed. A approves via Settings' "Requests to join." B gets real access. | ✅ |
| 5 | Create Room, invite-only visibility → creation itself succeeds (the §4 RLS bug). B's Discover excludes it entirely; direct navigation to its URL shows "Room not found"; a raw REST query for it returns zero rows | ✅ |
| 6 | A invites B by handle via the Edge Function directly (no UI button this phase — see §2.5) → real `200`, not the old 404. B sees an "invited" prompt, accepts, gets real access | ✅ |
| 7 | A promotes B from Member to Mod in Settings' Roles list; the change persists | ✅ |

Console output across both browser contexts for the full Round 2 run:
zero errors, zero uncaught page errors.

The exit condition's actual claim — "the other [account] cannot see
[the private Room] until invited/approved" — was checked at three
levels for the invite-only case specifically, not just "the button
didn't work": absent from B's Discover list, a generic not-found (not a
permission-denied, which would itself leak that the room exists) on
direct navigation, and a raw `GET /rest/v1/rooms?slug=eq....` returning
`[]` — RLS denying the row entirely, not the client just choosing not to
display it.

## 6. Concepts worth knowing before Phase 5

- **BYPASSRLS and table GRANTs are independent layers.** A role that
  bypasses every RLS policy can still be denied outright by an ordinary
  missing `GRANT` — Postgres checks privileges first, RLS second, and
  skipping the second check does nothing about the first.
- **`INSERT ... RETURNING` re-evaluates the SELECT policy, in the same
  statement.** A row that an `AFTER INSERT` trigger makes visible (by
  inserting into a *different* table a policy checks) can still fail
  that check if the recheck runs before the trigger's effects are
  considered — don't assume "the trigger already ran" is sufficient
  reasoning without testing the exact statement shape that will actually
  be used.
- **A table with two foreign keys to the same target needs a named
  embed.** `postgres_table(cols)` in a PostgREST `select()` is only
  unambiguous when exactly one relationship exists between the two
  tables; two FKs (even to the same column) requires
  `target!constraint_name(cols)`.
- **TypeScript narrowing doesn't survive into closures for union types,
  even `const` ones.** Re-bind the narrowed value to a new `const`
  before a nested function (event handler, async callback) needs to use
  it without the union creeping back in.
- **"It typechecks and the logic reads correctly" is not evidence for
  code at a system boundary.** All three of this phase's bugs lived
  exactly there — this is the second phase in a row (see
  `docs/phase/phase03.md` §4) where live, real-account verification
  found what static analysis structurally cannot.

## What's next

**Phase 5 — Posts & engagement.** Real post creation (text + image,
uploaded to Cloudflare R2 via a signed URL, compressed client-side
first), post detail with threaded comments, likes, and polls (create,
vote, live results) — the Room feed this phase left permanently showing
"No posts yet" starts actually having something to show.
