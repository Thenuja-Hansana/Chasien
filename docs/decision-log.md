# Chasien — Decision log

Append-only journal. Newest entry on top. Each entry: what we decided, the
context at the time, why, what we considered instead, and what would make us
revisit it. This is the "why" behind `architecture.md` — that file says what
we're doing now, this file says how we got there.

---

## 2026-08-13 — Two real bugs found by actually running Phase 1's migrations

**Decision:** added `supabase/migrations/20260813073524_grants.sql`
(table-level `GRANT`s to `authenticated`, missing entirely before this)
and replaced a self-referential `EXISTS` subquery on
`conversation_participants` with a `security definer` helper function
(`is_conversation_participant`), matching the pattern already used for
every room-membership check.

**Context:** `docs/roadmap.md`'s Phase 1 exit condition says "verify this
by hand, don't assume the policy is correct because it compiles." Taken
literally: after `supabase start` finally applied all 8 migrations
cleanly, every RLS-simulated query (`SET ROLE authenticated; SET
request.jwt.claims ...`) failed immediately with `permission denied for
table X` — not an RLS rejection, a plain missing `GRANT`. Postgres checks
ordinary table privileges *before* RLS policies are ever evaluated; a
table can have flawless policies and still deny everyone, because nothing
granted the `authenticated` role permission to touch the table at all.
Separately, `conversation_participants`'s "see other participants in my
conversations" policy — the one place a self-referential `EXISTS` against
its own table got used instead of a helper function — failed with
`infinite recursion detected in policy`: RLS on the inner subquery's scan
of the same table re-triggers the same policy, which scans the table
again, and Postgres detects the cycle rather than looping forever.

**Why this matters beyond the immediate fix:** every other membership/
moderator check in the schema already went through a `security definer`
SQL function (`is_room_member`, `is_room_moderator`, `is_room_owner`) —
not because recursion was anticipated there, but because it was the
natural way to avoid repeating the same subquery a dozen times. That
habit happened to also be the fix for a bug that only showed up in the
one place a check was written inline instead. Consistency turned out to
double as a defense.

**Revisit when:** never, ideally — but if a future table's RLS policy
needs to reference rows in its own table, use a `security definer` helper
from the start rather than an inline self-join, now that the failure mode
is known rather than theoretical.

---

## 2026-08-13 — Correction: partial unique indexes can't be deferrable constraints

**Decision:** `one_owner_per_room` (identity_and_rooms migration) is a
plain partial unique index, not a deferrable constraint. Ownership
transfer must demote the old owner before promoting the new one, in that
order, within the transaction.

**Context:** the earlier same-day entry below ("Phase 1 schema") describes
this as `DEFERRABLE INITIALLY DEFERRED` — that was wrong, and only found
out by actually running the migration against a real local Postgres
instance rather than trusting that it compiled: Postgres rejects
converting a *partial* unique index into a deferrable table constraint
(`SQLSTATE 42809` — deferrability is a table-constraint property, and a
constraint by definition can't be partial). Left uncorrected below, since
this file is a log of what was decided when, not a document to rewrite —
this entry is the correction.

**Why this still works:** a non-deferred partial unique index only checks
uniqueness at the end of each individual statement, not each row. Two
sequential `UPDATE`s in one transaction — demote, then promote — never
has both rows claiming `role = 'owner'` at the same checked instant, so
the plain index is sufficient. The failure mode this leaves open is
ordering: promoting the new owner *before* demoting the old one would
transiently violate the index and get rejected. Worth a code comment at
the call site when the Phase 4 Edge Function is written, not just here.

---

## 2026-08-13 — Phase 1 schema: unified chat sync, hardened polymorphic trust & safety tables

**Decision:** `conversation_participants` is the *only* table any RLS
policy checks for chat read access, for both Room channels and DMs — no
policy branches on `conversations.kind`. For Room channels, rows in it are
never written by clients; three triggers keep it in sync with
`room_memberships` automatically (on approval, on new channel creation, on
leave/removal). `reports` and `moderation_actions` keep their polymorphic
`target_type`/`target_id` design rather than splitting into one table per
reportable type, hardened with UUID PKs everywhere, a `content_snapshot
jsonb` captured at write time, and an insert-time trigger that rejects a
target that doesn't exist.

**Context:** first-pass schema proposal was reviewed line by line before
any SQL was written. The two flagged risks: (1) conversation_participants
meaning "the membership" for DMs but only "preferences layered on
Room-membership" for channels is an asymmetry that would force every
chat RLS policy to branch on kind — exactly the kind of conditional check
that's easy to get subtly wrong on the one table where a bug is a real
privacy leak, not a UI glitch. (2) a polymorphic target on a trust & safety
table has no real foreign key, so a bad insert can create a dangling
reference, and reported content deleted after the fact leaves a reviewer
with nothing to look at.

**Why this resolution over the alternatives:** for (1), splitting DMs and
Room channels into two separate systems would have avoided the asymmetry
but broken the single unified inbox the mock's `Chats.jsx` depends on.
Instead, the asymmetry was resolved rather than avoided: triggers make
Room-channel participation *always* materialize as real
`conversation_participants` rows, so by the time any RLS policy runs,
there is no asymmetry left to branch on — one check, no kind conditional,
anywhere in the chat schema. For (2), four separate typed report tables
would have real foreign keys but turn "show me all open reports" into a
permanent four-way UNION, and grow by one table every time a new
reportable thing is added. UUID PKs make a wrong-table collision
essentially impossible (fails as "not found," never as "resolves to the
wrong content"); the snapshot means a reviewer's job never depends on the
original row still existing, which is a stronger guarantee than a foreign
key gives you anyway, since a moderator legitimately deleting the reported
content shouldn't also delete the evidence of what was removed.

**Also decided, same session, each previously left implicit:** delete
behavior is explicit per relationship (user deletion anonymizes their past
content via `SET NULL` rather than leaving holes in other people's
threads; deleting a Room cascades its contents, since the product frames a
Room as self-contained); moderation removal is a soft delete
(`deleted_at`/`removed_by`/`removal_reason`), never a SQL `DELETE`, so
there's always a row for the audit trail to point at; exactly one owner
per Room is a database constraint (`UNIQUE ... WHERE role = 'owner'`,
deferrable for ownership-transfer transactions), not an assumption; Room
channel names and DM pairs both have real uniqueness constraints; comment
nesting is capped at one level by a trigger, not just app-code discipline;
and a `pending` join request gets zero content access, identical to a
non-member, until approved — the more conservative of the two readings,
deliberately, since loosening a restriction later is safe and tightening
one after the fact is not.

**One more write path locked down beyond what was originally asked:**
`room_memberships` — the single table everything else's access derives
from — has RLS read policies but *no* write policies for regular users at
all. Every write (joining, approving, inviting, changing roles) goes
through an Edge Function using the service role, not a client-side insert
gated by an RLS `WITH CHECK` expression. A complex write policy on this
specific table was judged higher-risk than pushing that logic into
application code, where it's testable and where "an owner can't leave
without transferring first" is an easy sentence to write, but an
awkward one to express as a boolean.

**Revisit when:** Phase 4, when the Edge Functions that actually perform
these room_memberships writes get built — this decision predicts their
shape (join, approve, invite, change-role, leave) but doesn't build them.

---

## 2026-08-13 — Phase 0 scaffold: Expo Router, single dark theme, no demo screens

**Decision:** `mobile/` was created via `create-expo-app`'s default template
(Expo Router + TypeScript, SDK 57). Kept Expo Router rather than switching
to plain React Navigation. Ported `app_reference/src/styles/tokens.css`
into `mobile/src/constants/theme.ts` as a single flat palette — no
`Colors.light`/`Colors.dark` split. The template's demo screens (Welcome/
Explore tabs, `ThemedText`, `Collapsible`, etc.) were moved to
`mobile/example/` (reference only, excluded from lint/typecheck) rather
than patched, since they'd be deleted in Phase 3 anyway.

**Why Expo Router:** it's file-based routing, and the mock's routes
(`/c/:communityId`, `/chats/:chatId`, `/u/:userId`, ...) already read like
file paths — `app/c/[communityId].tsx` etc. map on almost directly. Also
Expo's own current default, so it's the well-trodden path, not a niche
choice a solo dev has to fight the tooling for.

**Why single dark theme, not light/dark:** `tokens.css` only ever defined
one palette (the "Organic" system) with no `prefers-color-scheme`
alternative — the mock was never designed with a light mode. Following the
template's default light/dark split would mean inventing a light palette
that doesn't exist anywhere in the source of truth. `_layout.tsx`'s
navigation chrome is tinted from these tokens directly rather than
switching with the OS scheme.

**Why move demo screens instead of updating them:** they only exist to
show off the template, reference colors/spacing in the old light/dark
shape, and get replaced wholesale in Phase 3 by real Chasien screens.
Patching them to compile against tokens they'll never really use would be
throwaway work.

**Revisit when:** Phase 3 (App shell & navigation) — that's where the real
route tree, the reusable components, and actual font loading
(`@expo-google-fonts/caprasimo` + `@expo-google-fonts/figtree`, referenced
but not yet installed) get built.

---

## 2026-08-13 — Moderation (report/block) and account deletion promoted to day-1 requirements

**Decision:** `Report`, `Block`, and a moderation action log join the core
data model backlog alongside Room membership, not as later polish. In-app
account deletion and Sign in with Apple parity (if Google/Facebook login is
offered on iOS) are treated as required flows, not launch-week paperwork.

**Context:** Repo was pushed to GitHub
(`https://github.com/Thenuja-Hansana/Chasien`); prompted a question about
whether app structure/flow could get the app rejected from the App Store /
Play Store.

**Why:** Store review doesn't see repo/folder structure at all — that part
of the concern doesn't apply. But Chasien is a UGC app (posts, comments,
chat, Rooms), and both Apple (Guideline 1.2, 5.1.1(v), 4.8) and Google
(Play UGC policy, User Data policy) have hard requirements for report/block
mechanisms and in-app account deletion. These touch the data model
directly, so designing them alongside Room membership is far cheaper than
retrofitting after the schema is settled. Full detail in
`store-compliance.md`.

**Revisit when:** close to actual store submission — re-verify against
current guidelines, since store policies do change.

---

## 2026-08-13 — Zero-budget stack finalized

**Decision:** Supabase (Auth + Postgres + Realtime) + Supabase Edge Functions
for authorization logic + Cloudflare R2 for media + Expo/EAS + GitHub
Actions. All free-tier.

**Context:** No funding, solo/indie, pre-launch. Need a stack that's
genuinely $0/month through development and early beta, without boxing us
into an architecture we'll have to tear up at the first real user.

**Why this over alternatives:**
- A dedicated always-on Node API server (the original plan, see entry
  below) isn't actually free — something has to keep it awake, and free
  hosts either sleep on idle (cold starts) or cap hours. Serverless (Edge
  Functions) has no idle cost and no cold-start-sleep problem.
- Cloudflare R2 over S3/Supabase Storage specifically for its **zero
  egress fee** — bandwidth, not storage size, is what actually costs money
  for a media-heavy app, so this one choice buys the most runway.
- Kept Supabase (rather than switching to pure Firebase) because Postgres +
  RLS + Edge Functions gives more precise control over the Room
  membership/permission model than Firestore's document model would.

**Revisit when:** realtime concurrent connections approach the ~200 free
cap, DB approaches 500MB, or R2 storage approaches 10GB — i.e. when there's
an actual user base, which is also when there'd be a case for monetization
to fund the next tier.

---

## 2026-08-13 — Backend approach: managed primitives + own authorization layer

**Decision:** Don't let clients talk to the database directly. All
permission checks (Room membership, role, visibility) live in server-side
code we control, not client-enforced database rules alone.

**Context:** Chasien's core promise is that Rooms are properly isolated —
no accidental cross-Room data exposure. Considered three options: pure BaaS
(client → DB directly, permissions as DB rules only), a fully custom
backend from scratch, or managed primitives with a thin authorization layer
on top.

**Why:** Pure BaaS puts the entire "no data leak" guarantee on database
security rules, which is exactly the kind of thin, easy-to-misconfigure
layer that causes cross-tenant leaks in stateful, role-heavy apps. A fully
custom backend gives full control but means hand-rolling auth/session
security alone as a solo dev — the other common indie-app breach vector.
Managed primitives (DB, auth, realtime, storage) plus our own authorization
code gets the safety of "we wrote and can test the permission logic"
without owning ops for all of it.

**Superseded by:** the zero-budget entry above, which changed *where* that
authorization code runs (Edge Functions instead of an always-on server) but
not the underlying principle.

---

## 2026-08-13 — Product concept & data model hints extracted from UI mock

**Decision:** Treat `app_reference/` (the React/Vite mock) as the source of
truth for product scope, not just visual style.

**Context:** The mock already encodes real product decisions: Rooms with
three visibility modes (public / request-to-join / invite-only), roles
(owner/mod/member), reverse-chron-only feed (no algorithm, by design), posts
with images/polls/comments, ephemeral per-user stories, a unified chat inbox
mixing Room group-chat and 1:1 DMs, and a notifications feed mixing several
event types (replies, likes, join requests, mentions).

**Why it matters:** This means the data model isn't a blank-slate design
exercise — it should be derived from what the mock already implies, then
hardened (permissions, indices, retention rules) rather than reinvented.

**Next:** Full schema design — starting with Room membership, since every
other entity's access control depends on it.
