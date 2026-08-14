# Chasien — Decision log

Append-only journal. Newest entry on top. Each entry: what we decided, the
context at the time, why, what we considered instead, and what would make us
revisit it. This is the "why" behind `architecture.md` — that file says what
we're doing now, this file says how we got there.

---

## 2026-08-14 — Media runs on Supabase Storage until Phase 11, behind a one-file seam

**Decision:** Phase 5's post images upload to a private **Supabase
Storage** bucket, not Cloudflare R2. All of it sits behind
`mobile/src/lib/media.ts`, whose only exported surface is
`uploadPostImage()` / `signMediaUrls()`, so the eventual R2 swap is a
change to that file rather than to every screen.

**Context:** `architecture.md` picks R2 for media and the reasoning
holds — zero egress fees are the biggest cost lever as image volume
grows. But R2 has no local emulator and requires real credentials on a
real Cloudflare account. Adopting it now would have made Phase 5 the
first phase that could not be verified against the live local stack,
which is the standard every phase since Phase 1 has been held to.

**Why not just defer images entirely:** the phase's exit condition is
"a post with an image and a poll round-trips," so cutting images would
have gutted it. Supabase Storage already ships in the local stack, so
the whole path — pick, compress, upload, sign, render — is genuinely
verifiable today.

**What we considered instead:** provisioning R2 immediately (rejected:
needs credentials from the user, and the upload path could not be
verified locally) and text-only posts (rejected: doesn't meet the exit
condition). Phase 11's checklist already read "Cloudflare R2 bucket
provisioned for real, if Phase 5 hadn't already needed one," so
deferring was anticipated rather than improvised.

**Revisit when:** Phase 11 stands up the hosted backend. The seam keeps
that work confined to `lib/media.ts` plus a signed-upload endpoint.

**One thing deliberately not deferred:** the bucket is **private**, read
through short-lived signed URLs, rather than public. Public would have
been simpler but would quietly undo the guarantee Phases 1 and 4 spent
real effort proving — that a non-member cannot see a Room's content —
for exactly the content most likely to get forwarded around. Verified as
a negative test: a non-member can neither sign, download, nor publicly
fetch another Room's image.

---

## 2026-08-14 — Approved Room members can now see each other; the MOD badge was dead UI

**Decision:** added a third SELECT policy on `room_memberships`
(`20260814073649_members_can_see_each_other.sql`): an approved member of
a Room can read the other **approved** membership rows in that Room.

**Context:** the mock puts a MOD badge on posts, and Phase 5 ported it.
Doing so exposed that Phase 1 made `room_memberships` readable exactly
two ways — your own row, or every row if you're a moderator. So the only
people who could see who the moderators were *were* the moderators. The
badge rendered for practically nobody.

**Why widen it rather than drop the badge:** knowing who runs a Room
you're already in is ordinary, expected behaviour for a community app,
and the same visibility is needed for member lists and for Phase 6's
chat participant display. Dropping the badge would have fixed the
symptom and left the gap for the next phase to rediscover.

**Scope, deliberately narrow.** `pending` rows stay mod-only, so who
asked to join and was declined is not Room-wide gossip; `invited` rows
stay hidden, so an unaccepted invite isn't advertised; and non-members
gain nothing, since `is_room_member()` is false for them — Phase 4's
isolation guarantee is untouched. All of those were checked as explicit
negative tests, not inferred from reading the policy.

**Revisit when:** a Room ever needs a genuinely anonymous membership
mode, which nothing in the product currently calls for.

---

## 2026-08-14 — Three real bugs found verifying Phase 4, all in the parts static analysis can't see

**Decision:** three fixes, all shipped together after live verification with two
real accounts found them:

1. `service_role` had zero table grants (new migration
   `20260814044514_service_role_grants.sql`, mirroring the `authenticated`
   grant already in `20260813073524_grants.sql`).
2. `rooms`' SELECT policy now also admits a room's own creator
   unconditionally (new migration
   `20260814044612_room_creator_can_always_see_own_room.sql`), not just
   public/request visibility or an existing `room_memberships` row.
3. `fetchRoomMembers()` (`mobile/src/lib/rooms.ts`) now embeds
   `profiles!room_memberships_user_id_fkey(handle, name)` instead of a bare
   `profiles(handle, name)`.

**Context:** the `room-membership` Edge Function (join/approve/invite/
role-change) and the Room Settings member list both typechecked and linted
clean, then failed on nearly every live action when actually exercised
end to end with two accounts — 5 of 7 test scenarios failed on the first
verification pass.

**Bug 1 — service_role has BYPASSRLS, not automatic table grants.** Every
`room-membership` action uses a service-role client specifically because
`room_memberships` has zero client write policies by design (Phase 1) —
but BYPASSRLS only skips *row-level security policy* checks, a completely
separate Postgres layer from ordinary table-level GRANTs, which are still
enforced regardless. `service_role` was never granted anything on
`public` — the same exact bug `20260813073524_grants.sql` fixed for
`authenticated` during Phase 1, just undiscovered for a different role
until an Edge Function actually ran against a live database. Surfaced as
misleading 404s ("Room not found") on join/approve/invite/role-change,
since the handlers treat any query failure as "not found" rather than
distinguishing a privilege error.

**Bug 2 — INSERT...RETURNING re-checks the SELECT policy in the same
statement a trigger populates.** Creating an invite-only Room failed with
`42501` every time, only for `invite` visibility. The owner's
`room_memberships` row (which the original SELECT policy needed to admit
the room to its own creator) is created by an AFTER INSERT trigger
(`add_owner_membership_on_room_created`, Phase 1) — but
`.insert(...).select().single()` (`createRoom()`,
`mobile/src/lib/rooms.ts`) asks Postgres to also evaluate the SELECT
policy on the newly-inserted row as part of the same statement, and that
recheck didn't see the trigger's own insert. Public/request rooms never
hit this, since their SELECT policy already admits any authenticated
user unconditionally. Fixed at the policy level, not by restructuring the
client into two round trips — a room's creator being unable to see their
own room even transiently was the actual bug, and "always visible to your
own creator" is a correct policy on its own merits, independent of this
specific timing quirk.

**Bug 3 — `room_memberships` has two foreign keys to `profiles`.**
`user_id` and `invited_by` both reference `profiles(id)`, so PostgREST's
implicit embedding (`profiles(handle, name)`) can't tell which
relationship to follow and rejects the query outright (`PGRST201`) for
every room, regardless of data — this made Room Settings' "Requests to
join" and "Roles" sections permanently unable to load. Naming the
specific foreign key constraint in the embed
(`profiles!room_memberships_user_id_fkey(...)`) resolves the ambiguity.

**Why this is worth restating precisely:** none of the three would have
been caught by `tsc --noEmit` or `expo lint`, both of which passed clean
immediately before and after. All three are the same category of thing —
correct-looking code whose failure mode only exists at the boundary
between two systems (Postgres privileges vs. RLS; a trigger vs. the
statement that fired it; a foreign key vs. PostgREST's embedding
inference) — which is exactly what this project's phase-by-phase
verification standard (docs/roadmap.md) exists to catch.

---

## 2026-08-14 — Added an explicit "Production backend & real email" phase

**Decision:** inserted a new Phase 11 in `docs/roadmap.md` — create a
hosted (free-tier) Supabase project, run every migration against it,
wire up a real SMTP provider for Auth emails, and re-verify the full
auth flow against that hosted project specifically. The former Phase
11 (Store submission prep) and Phase 12 (Beta & post-launch) shifted to
12 and 13.

**Context:** asked directly what phase real accounts with real email
delivery and Room creation would actually work by. Room creation has a
clear answer (Phase 4). Real email didn't: every phase through 10 only
ever gets verified against `supabase start` — a local Docker stack on
one machine, with confirmation emails intercepted by a local fake inbox
(Mailpit) instead of delivered anywhere. Nothing in the roadmap said
when that changes, even though later phases quietly assume it already
has — Phase 12 (old 11)'s "TestFlight / Internal testing track with a
small real beta group" cannot work against a backend only this laptop
can reach.

**Why its own phase instead of folding into Store submission prep:**
the two are genuinely different kinds of work — this one is "the
backend works for a stranger" (free, no store involvement), the other
is "the packaging and store accounts are ready" (the first phase that
spends real money). Keeping them separate means a hosted backend with
real email doesn't have to wait on a $99 developer account decision to
get started, and store prep doesn't silently inherit an unverified
backend as a hidden dependency.

---

## 2026-08-13 — Dropped the web-specific `Fonts` CSS-var indirection; it never matched the loaded font names

**Decision:** `constants/theme.ts`'s `Fonts` export is no longer
`Platform.select`-split. It's one plain object (`Caprasimo_400Regular`,
`Figtree_400Regular`, etc.) used on every platform, and
`global.css`/`--font-heading`/`--font-body` are deleted.

**Context:** found in the same live-verification pass as the entries
above — on web, the brand heading rendered in the fallback serif, not
Caprasimo. `Fonts.heading` on web resolved to `var(--font-heading)`,
defined in `global.css` (written in Phase 0, before any real font-loading
existed) as `'Caprasimo', ui-serif, Georgia, serif`. But `useFonts()` in
`app/_layout.tsx` (added this phase) registers the loaded webfont under
the exact object key passed to it — `'Caprasimo_400Regular'` — on every
platform, web included. `'Caprasimo'` was never a font that existed
anywhere, so the CSS var fell through its own fallback chain every time.
`global.css`'s vars had no other consumer, so there was nothing to
preserve by keeping the indirection instead of just removing it.

---

## 2026-08-13 — Correction: the web SecureStore fallback collided with AsyncStorage's own key

**Decision:** the web branch of `LargeSecureStore` now stores its AES key
under `` `${key}-secure-store-key` `` in `localStorage`, not `key` itself.

**Context:** re-verifying the entry below (same session) by actually
logging in on web again surfaced a second, self-inflicted bug: writing the
encryption key to `localStorage.setItem(key, ...)` used the *same* key
`AsyncStorage.setItem(key, encrypted)` writes to two lines later —
`@react-native-async-storage/async-storage`'s web backend is a thin
wrapper directly over `localStorage` with no prefix of its own. The second
write silently clobbered the first, destroying the encryption key the
instant it was used. Any later reload tried to decrypt the session using
the leftover ciphertext as if it were the key, throwing `invalid key size`
from `aes-js` and blanking the whole app behind Expo's uncaught-error
overlay — worse than the original crash, since it now happened on almost
every reload instead of only on web login.

**Why this is left in this file rather than just fixed silently:** this
phase's own standard is "verify by hand, don't assume it compiles" — the
first fix passed typecheck and lint clean and still shipped a crash: a
useful reminder that a same-tick key collision like this needs an actual
runtime run to catch, not static analysis.

---

## 2026-08-13 — LargeSecureStore crashed on web; given a web fallback rather than left broken

**Decision:** `LargeSecureStore` (mobile/src/lib/supabase.ts) now branches on
`Platform.OS === 'web'`, storing its AES encryption key in `localStorage`
instead of calling `expo-secure-store` there. Everything else — the
AsyncStorage-held ciphertext, the encryption itself — is unchanged.

**Context:** found while verifying Phase 3's new navigation by actually
driving the app in a browser (`expo start --web`) — the same "run it, don't
assume it compiles" standard every phase so far has used. Login crashed
immediately with `ExpoSecureStore.default.setValueWithKeyAsync is not a
function`: `expo-secure-store` has no web implementation at all (there's no
Keychain/Keystore equivalent in a browser), and `LargeSecureStore` had no
web branch, so every call there threw. This blocked verifying every
authenticated screen — not just the ones Phase 3 added.

**Why fix it here instead of just noting it as a known gap:** Chasien ships
mobile-only (see "Zero-budget stack finalized" below), so this was never a
production security concern — but `web.output` is deliberately kept
buildable for local dev (see the "Phase 2 web output" entry below), and a
dev target that can't even log in isn't useful. `localStorage` is no more
or less secure than the plaintext AsyncStorage-on-web this pattern was
built to avoid on *native* — web was never the protected target, so this
doesn't weaken anything the original design was actually defending.

---

## 2026-08-13 — Three real bugs found verifying Phase 2, none of them where expected

**Decision:** switched `mobile/app.json`'s `web.output` from `static` to
`single`; fixed two assertions in the auth verification script itself
(not the app) that were producing false failures.

**Context:** `expo export --platform web` failed outright —
`ReferenceError: window is not defined` — inside the new auth code.
Separately, a first pass at verifying auth server-side produced 5 "FAIL"
results out of 14 checks.

**Bug 1 — real, in app config:** Expo Router's default web output
(`static`) pre-renders every route to HTML using Node.js at build time,
which has no `window`/DOM. `LargeSecureStore` (and `AsyncStorage`'s web
implementation under it) assumes a browser. Chasien is a mobile app
first — there's nothing behind a login gate worth statically
pre-rendering for SEO anyway — so `single` (plain SPA, everything
rendered client-side, no Node-side pass) is the correct mode, not a
workaround.

**Bug 2 — not a bug, a wrong assertion:** the verification script
asserted a freshly created account's profile query returned exactly one
row. It returned eight — every profile in the seed data, because
`profiles` is readable by any authenticated user by design (Phase 1,
deliberately: handles need to be visible for Discover/Search/authorship
to work at all). The trigger had, in fact, worked correctly; the test
asked the wrong question. Fixed by filtering the query to the specific
handle under test instead of counting all rows.

**Bug 3 — not a bug, a flawed tampering method:** a "tampered token"
test flipped the last character of a JWT signature's base64url encoding
and got back a 200 (looked, briefly, like signature verification wasn't
being checked at all — which would be a severe, well-known-by-now
Supabase vulnerability, and so an extremely unlikely explanation on its
own). The actual cause: the last character of a base64url segment can
encode partly-unused padding bits depending on the encoded length modulo
3, so flipping it doesn't always change the decoded bytes. Fixed by
flipping a character in the *middle* of the payload and, separately, the
middle of the signature — both correctly rejected with 401 once the test
was actually testing what it claimed to.

**Why this is worth recording, not just fixing quietly:** two of these
three "bugs" were in the verification code, not the system — worth
naming precisely which, since silently patching a test until it passes
is how false confidence happens. The instinct that mattered here wasn't
"trust the first result," it was "an alarming result needs a more
alarming explanation to actually be believed" — a 200 where a 401 was
expected demands checking the test before writing up a vulnerability
that, on reflection, was implausible.

---

## 2026-08-13 — Phase 2: session storage, email confirmation, and scope cuts

**Decision:** sessions are stored via a `LargeSecureStore` (AES-256-CTR
encrypted blob in AsyncStorage, key in `expo-secure-store`/Keychain-
Keystore) — Supabase's own documented pattern for Expo, reproduced from
their docs rather than improvised. Email confirmation is required before
login (`enable_confirmations = true`, was `false` by default). Apple/
Google sign-in buttons and the "Forgot password?" link from the mock are
left out of the real screens — neither has a backend yet, and a button
that does nothing on tap is worse than not showing it.

**Context:** Phase 2's stated goal is "real accounts, sessions that don't
leak" — explicitly named by the user as the most security-sensitive
phase so far, since it's the first one handling real user credentials
rather than just data shape.

**Why `LargeSecureStore` specifically:** plain `expo-secure-store` caps
individual values around 2048 bytes, which a full Supabase session
(access token + refresh token + user object, one JSON blob) can exceed.
Plain `AsyncStorage` has no such cap but stores plaintext — exactly what
"not AsyncStorage in plaintext" (docs/roadmap.md Phase 2) rules out. The
hybrid — a fresh AES key per write, held in SecureStore; the ciphertext,
unreadable without that key, held in AsyncStorage — gets both: no size
ceiling, and nothing sensitive sitting in plaintext even if the device's
storage were read directly. Verified this actually round-trips (and that
tampering/wrong-key attempts don't recover the original) with a
standalone Node script exercising the exact same AES logic — see
docs/phase/phase02.md §4.

**Why email confirmation on:** prevents signing up with an email address
you don't control — a real account-security property, not just UX
polish, and directly in scope given the "involves user data" framing.
Locally, confirmation links land in Mailpit
(`http://127.0.0.1:54324`), not a real inbox — reachable without SMTP.

**Scope deliberately cut, not silently dropped:** the mock's Login
screen shows Apple/Google buttons and a password-reset link; SignUp
shows a "2 of 3" step indicator implying a 3-step wizard whose other two
steps don't exist anywhere in the mock. None of this is built yet:
OAuth needs a registered provider app (real cost/setup, out of scope for
zero-budget Phase 2); password reset needs a deep-link-handling screen;
the exact 3-step wizard has nothing to port for two of its three steps.
A single functional screen (email, handle, display name, password,
agree-to-guidelines) covers the same fields the mock actually specifies,
without shipping UI that does nothing when tapped.

**Revisit when:** Phase 3 (App shell), if the multi-step wizard specifically
is wanted for polish; whenever OAuth or password reset actually get
planned, matching the roadmap's own "plan Sign in with Apple, don't build
yet" note.

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
