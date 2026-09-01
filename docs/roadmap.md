# Chasien — Roadmap

Solo-dev task list, ordered by dependency, not by "nice to have first."
Each phase has a goal and an exit condition — don't start the next phase
until the current one's exit condition is true, or you end up with ten
half-built phases and nothing shippable.

**How to use this file:** check items off as you go. When a phase forces an
architectural choice, record it in `decision-log.md`, not just here — this
file tracks *progress*, that one tracks *why*. Re-order tasks within a
phase freely; don't reorder phases without a reason, they're dependency
-ordered on purpose.

**Current focus:** Phases 0-6 are done. Chat is real end to end — a
unified inbox mixing Room group channels and DMs, realtime message
delivery, typing indicators, read receipts, reactions, and image/voice
attachments, all verified with two (and, for the isolation guarantee,
three) real accounts against the live local stack. Chat media follows
Phase 5's media pattern exactly (private bucket, signed URLs), scoped by
conversation instead of Room, sharing its compress/upload/sign code via
a new `lib/mediaUtils.ts`. Push notifications are wired server-side
(Database Webhook → Edge Function → Expo Push) and verified on the send
side. The EAS project is now set up (`eas.projectId` in `app.json`), and
a hard blocker discovered along the way — `expo-notifications` can't even
be imported in Expo Go as of SDK 53, not just used — is fixed by moving
every import in `lib/push.ts` to dynamic imports and switching to
`expo-dev-client` builds (`expo run:android`/`expo run:ios`) instead of
Expo Go; see decision-log, 2026-08-31.

**2026-09-01: first real Android device verification**, on a physical
Galaxy A14 via USB + `adb reverse` (not the emulator — this machine's
8GB RAM can't comfortably run Docker, an emulator, and a Gradle build at
once; see `docs/running-locally.md`). Voice message recording confirmed
working end to end. Two real bugs surfaced only under real-device use —
a Room-list duplicate-key/wrong-membership-data bug, and the Chats list
never having had a live subscription — both fixed; see decision-log,
2026-09-01. That entry also corrects an assumption from 2026-08-15:
Android push needs Firebase/FCM configured (`google-services.json`) even
for a dev-client build, not just standalone. Push notifications are now
**confirmed fully working end to end** — token registration, an FCM V1
service account key uploaded to the correct EAS credentials slot (not
the visually similar but unrelated "EAS Submit" one — see decision-log),
and a real notification banner arriving on a backgrounded/locked phone.
The native image picker specifically is the one piece still pending
direct confirmation on Android; iOS remains entirely untested on real
hardware. See `docs/phase/phase06.md`. Next: Phase 7 — Stories.

Previously: the feed is real end to end — posts with text, images, and
polls; likes; one-level threaded comments — all verified with two real
accounts against the live local stack, with post images held in a
private, membership-gated bucket behind short-lived signed URLs. Media
currently runs on Supabase Storage rather than Cloudflare R2, behind a
one-file seam, because R2 can't be provisioned or verified locally; the
swap is scheduled in Phase 11 where the bucket was already listed. See
`docs/phase/phase05.md`.

Earlier still: Rooms are real — Discover browses
actual public/request Rooms, Create Room writes a real row, and all three
join flows (public/request/invite) work end to end through a new
`room-membership` Edge Function, verified with two real accounts —
including the core privacy guarantee, that an invite-only Room is
completely invisible (empty Discover, "Room not found", zero rows from a
raw REST query) to someone who isn't a member or invitee. Community
Settings has a real visibility picker, members-can-post toggle, and
owner-only role management. See `docs/phase/phase04.md` for the full
write-up, including three real bugs live verification caught that
typecheck/lint didn't. (Phase 3's app shell — see `docs/phase/phase03.md`
— is still verified on web and a real Android emulator only, not iOS or a
physical device.)

---

## Phase 0 — Foundation & tooling

Goal: an empty-but-real project skeleton, not another mockup.

- [x] Create `mobile/` — React Native app via Expo, TypeScript
- [x] Create `supabase/` — Supabase CLI init (`migrations/`, `functions/`
      created on demand, e.g. via `supabase migration new`)
- [x] Decide env/secrets handling (`.env.local`, never committed — added to
      `.gitignore`)
- [x] Add `.claude/` (or whatever's untracked) to `.gitignore` — cleanup
      from repo push
- [x] GitHub Actions: lint + typecheck on push, path-filtered to `mobile/`
- [x] Port design tokens from `app_reference/src/styles/tokens.css` into
      the RN app's theme (`mobile/src/constants/theme.ts`) — don't
      redesign, translate

**Exit condition:** `expo start` runs an empty app, `supabase start` runs
locally, CI is green on an empty diff.

---

## Phase 1 — Core data model & backend

Goal: the schema and permission rules that everything else depends on.

- [x] Schema: `profiles`, `rooms`, `room_memberships` (role: owner/mod/member,
      join_state: approved/pending/invited)
- [x] Schema: `posts`, `post_media`, `comments`, `post_likes`, `polls`,
      `poll_options`, `poll_votes`
- [x] Schema: `stories` (with expiry timestamp)
- [x] Schema: `conversations` (room channels + DMs, unified),
      `conversation_participants`, `messages`, `message_reactions`
- [x] Schema: `notifications`
- [x] Schema: `reports`, `blocks`, `moderation_actions` — see
      `store-compliance.md`, these are day-1, not deferred
- [x] Row Level Security: deny-by-default, membership-scoped reads, on
      every table above
- [x] `room_memberships` writes closed to direct clients entirely (reads
      only) — join/approve/invite/role-change routes through Edge
      Functions (Phase 2/4), not RLS write policies, since a bug in a
      write policy on the one table everything else's access derives
      from is a worse failure mode than a bug in application code
- [x] Local seed script (`supabase/seed.sql`, ported from
      `app_reference/src/data/mock.js`)
- [x] Table-level `GRANT`s to `authenticated` (`grants.sql`) — RLS
      policies alone aren't sufficient; found this by hitting "permission
      denied" on every query until it existed
- [x] Verified live: a non-member sees 0 rows across posts/messages/
      stories/memberships in a Room with real seeded content, a real
      member sees all of it, and a direct INSERT attempt from a
      non-member is rejected by RLS — not assumed, run against a live
      local Postgres via `supabase start`

**Exit condition — met:** every table has RLS on, a second test user
genuinely cannot read a Room they're not a member of. Verified by hand
(see `docs/phase/phase01.md`), which caught two real bugs (missing
grants, an RLS recursion bug) that "it compiles" would have missed.

---

## Phase 2 — Auth

Goal: real accounts, sessions that don't leak, matching the mock's flow.

- [x] Supabase Auth: email/password, `enable_confirmations = true`
- [x] Session storage in RN app — `LargeSecureStore` (AES-256 blob in
      AsyncStorage, key in `expo-secure-store`), Supabase's own documented
      Expo pattern, not AsyncStorage in plaintext
- [x] Login / Sign up screens — single-screen signup covering the mock's
      fields (email, handle, display name, password, agree-to-guidelines);
      Apple/Google buttons and password reset deliberately left out, no
      backend for either yet — see decision-log
- [ ] Plan (don't build yet) Sign in with Apple — required before iOS
      submission if any social login is added later, cheaper to design the
      auth screen for 3 providers now than retrofit — still just a plan,
      unchanged this phase. **Actual build deferred to Phase 12**, see
      decision-log 2026-08-13 — OAuth needs a registered provider app,
      which needs the paid Apple Developer Program membership that Phase
      12 is the first point we spend money on.

**Exit condition — met:** can sign up, get gated on email confirmation,
confirm, log in, session round-trips through encrypted storage, refresh
token works, log out revokes it server-side, and a tampered or malformed
token is rejected (401) by PostgREST. Verified against the live local
stack via a 14-check script, not assumed — see `docs/phase/phase02.md`,
which also documents two false failures the verification script itself
produced before being fixed.

---

## Phase 3 — App shell & navigation

Goal: every screen from the mock exists as a real (data-empty) RN screen.

- [x] Expo Router file-based routes mirroring `App.jsx`'s routes (e.g.
      `/c/:communityId` → `app/c/[communityId]/index.tsx`) — see
      decision-log, 2026-08-13 "Phase 0 scaffold". `TabBar` stayed a plain
      shared component rendered per-screen (like the mock), not an Expo
      Router `Tabs` layout — its destinations (current Room, current user)
      aren't a fixed route set
- [x] Load `Caprasimo`/`Figtree` via `@expo-google-fonts/*` + `useFonts()`,
      coordinated with the splash screen — `constants/theme.ts` already
      references the expected font names. Found and fixed a pre-existing
      web font-name mismatch along the way (`Fonts` had dropped a
      web-specific CSS-var indirection left over from before real fonts
      existed) — see decision-log
- [x] Shared components: Avatar, Icon, TabBar — ported, not redesigned
      (`react-native-svg` for Icon, `expo-linear-gradient` for Avatar)
- [x] Screens wired to Phase 1 backend but can render "empty state" —
      no mock data left in the real app. Scoped as shells: navigation,
      chrome, and empty states are real; Room/post/chat data-fetching and
      mutations (join, post, message) stay deferred to Phases 4-6 per
      those phases' own goals

**Exit condition — met:** navigated the entire app end to end, twice
over. First in a browser (three rounds) against the live local stack —
sign up, confirm by email, log in, every screen reachable from the UI,
a page reload while logged in, direct navigation to every dynamic
route, log out — zero console errors. Then for real on a local Android
emulator (SDK 57's Expo Go build sideloaded directly, since both app
stores were still lagging behind the new SDK) — real signup, real
email confirmation, real login, screens rendering with the correct
fonts and theme. Not yet run on iOS or a physical device (neither
available in this environment) — do that before treating this exit
condition as fully closed. Caught and fixed three real bugs this way
that typecheck/lint didn't: `LargeSecureStore` crashed outright on web
(`expo-secure-store` has no web implementation), that fix's own web
fallback collided with AsyncStorage's storage key and corrupted the
encryption key on every login, and the font mismatch above. Full
write-up: `docs/phase/phase03.md`.

---

## Phase 4 — Rooms core

Goal: Discover, join, and own a Room for real.

- [x] Discover screen: browse public Rooms — real query against `rooms`,
      RLS-filtered (public/request listed to everyone, invite hidden
      unless already a member)
- [x] Join flows: public (instant), request-to-join (pending → approved),
      invite-only — all three via the `room-membership` Edge Function
      (`supabase/functions/room-membership`), since `room_memberships` has
      zero client write policies by design (Phase 1)
- [x] Create Room flow, creator becomes `owner` — direct client insert
      into `rooms` (RLS + an existing Phase-1 trigger handle owner
      assignment atomically), not an Edge Function
- [x] Community Settings: visibility picker, members-can-post toggle, role
      management (owner/mod) — promote/demote between member/mod;
      ownership transfer exists in the Edge Function but isn't exposed in
      this phase's UI (not asked for in this checklist)
- [x] Room feed: membership-gated empty state (pending/invited/member
      states all real) — reverse-chron/pagination is moot until Phase 5
      puts actual posts in a Room to order

**Exit condition — met:** verified with two real accounts against the
live local stack (signup, email confirmation, real login for both) — A
creates a public, a request, and an invite-only Room; B can instantly
join the public one, has to wait on A's approval for the request one, and
cannot see the invite-only one exists at all (empty Discover result, "Room
not found" on direct navigation, zero rows back from a raw REST query)
until A invites B by handle and B accepts. Role management (promote B to
mod) verified too. Full write-up, including three real bugs live
verification caught that typecheck/lint didn't: `docs/phase/phase04.md`.

---

## Phase 5 — Posts & engagement

Goal: the feed actually does something.

- [x] Create post: text + image — one atomic `create_post()` RPC, since
      post + media + poll is four dependent inserts and authors have no
      DELETE policy to roll a half-built post back with
- [x] Media upload via signed URL, client-side compress/resize before
      upload (protects the free tier — see `architecture.md`).
      **Running on Supabase Storage, not R2 yet** — R2 has no local
      emulator and needs real credentials, which would have made this
      the first phase unverifiable against the live local stack. Written
      behind a one-file seam (`lib/media.ts`); the swap is Phase 11's,
      where the bucket was already listed. Private bucket + signed URLs,
      not public — a public bucket would quietly undo the Room-isolation
      guarantee Phases 1 and 4 established
- [x] Post detail + threaded comments (one level deep, per feed.sql's
      trigger — the reply itself offers no further Reply)
- [x] Likes
- [x] Polls: create, vote, live results — a vote can also be *changed*,
      which the mock disallowed; the schema always permitted retracting,
      and permanently stranding a mis-tap isn't acceptable in a real app

**Exit condition — met:** verified across three independent layers, not
just the UI. 8/8 SQL checks on the `create_post` RPC (guards, atomicity,
one-vote-per-poll), 9/9 storage-policy checks with real user sessions
(including that a non-member can neither sign, download, nor publicly
fetch a Room's images), and 11/11 end-to-end UI scenarios with two real
accounts acting simultaneously — a post carrying both an image and a
poll round-trips through the real backend, the image rendering from a
genuine signed URL in both feed and detail. Zero console errors, and
every count in the UI cross-checked against direct SQL. Full write-up,
including four bugs that neither TypeScript nor a browser could have
caught: `docs/phase/phase05.md`.

---

## Phase 6 — Chat & realtime

Goal: the messaging half of "Telegram-like."

- [x] Unified inbox: Room group chat + DMs in one list — one
      `security_invoker` view (`my_inbox`), not a client-side merge of
      two queries
- [x] Realtime delivery via Supabase Realtime, gated by the same
      membership check as everything else — `postgres_changes` for
      messages/reactions/read-receipts (RLS-gated); Broadcast, not a
      table, for typing indicators (nothing there is worth persisting)
- [x] Typing indicators, read receipts, reactions
- [x] Image + voice message attachments. **Running on Supabase Storage,
      not R2 yet** — same reasoning and same one-file-seam pattern as
      Phase 5's post images (`lib/media.ts`/`lib/messageMedia.ts` now
      share their compress/upload/sign internals via
      `lib/mediaUtils.ts`); the R2 swap is still Phase 11's
- [x] Push notifications for new messages (Expo Push) — send side wired
      and verified (a Database Webhook → Edge Function → Expo Push API
      on every new message); actual device delivery still blocked on a
      one-time, free EAS project setup step the user hasn't completed
      yet (see `docs/phase/phase06.md` §2.7)

**Exit condition — met:** verified with two real accounts (and a third,
for the isolation check) against the live local stack — realtime message
delivery confirmed in both a Room channel and a DM without a reload, and
a non-member's inbox never lists the Room's channel and a raw REST query
against `my_inbox` for that channel's id returns zero rows even for a
known conversation id. 8/8 SQL-level checks and 10/10 end-to-end UI
scenarios; full write-up, including the same RETURNING/RLS-timing bug
class recurring a third time and a reply-to Pressable-nesting bug:
`docs/phase/phase06.md`.

---

## Phase 7 — Stories

Goal: ephemeral content that's actually ephemeral.

- [ ] Story creation: image/short video, per-Room
- [ ] Story viewer UI (port `StoryViewer.jsx` flow)
- [ ] Expiry: stories stop showing after 24h
- [ ] Storage lifecycle: expired story media actually gets deleted from
      R2, not just hidden — this is the free-tier storage cap protection

**Exit condition:** a story posted 25h ago is gone from both the UI and
the storage bucket, unattended.

---

## Phase 8 — Notifications

Goal: users know when something happened without polling.

- [ ] In-app notifications feed, grouped (Today / This week — port
      `Notifications.jsx`)
- [ ] Push notifications: likes, replies, mentions, join requests
- [ ] Notification preferences (mute a Room's notifications)

**Exit condition:** every event type in the mock's `NOTIFICATIONS` array
has a real trigger and a real push notification.

---

## Phase 9 — Trust & safety (store-required, not optional)

Goal: the things that get a UGC app rejected if missing. See
`store-compliance.md` for the policy citations.

- [ ] Report flow: post, comment, user — reaches a place you'll actually
      see it
- [ ] Block flow: blocked user's content hidden both directions
- [ ] Mod actions: remove post/comment, mute/remove member, from
      Community Settings
- [ ] Abuse contact published somewhere reachable (even just an email, at
      solo-dev scale)
- [ ] In-app account deletion — actual deletion, not deactivation

**Exit condition:** you could pass an App Store UGC review today, not just
"eventually."

---

## Phase 10 — Hardening

Goal: doesn't crash, doesn't leak, doesn't feel broken.

- [ ] Crash reporting (free tier — e.g. Sentry free tier)
- [ ] Offline behavior: what happens with no connection, for feed and chat
      — at minimum, don't crash or silently drop user actions
- [ ] Loading / empty / error states audited on every screen, not just the
      happy path
- [ ] List virtualization / image caching pass for feed performance
- [ ] Security pass: re-verify RLS + Edge Function checks from Phase 1
      still hold after all the features built on top; rate-limit auth
      endpoints

**Exit condition:** you'd hand this to a stranger without wincing.

---

## Phase 11 — Production backend & real email

Goal: the backend is real for anyone, not just reachable from this
machine. Everything through Phase 10 has been verified against
`supabase start` — a local Docker stack, local-only network, and a
fake Mailpit inbox instead of real email delivery. None of that is
usable by an actual other person yet, which the rest of this roadmap
(TestFlight/Internal testing in the next phase, a real beta group in
the one after that) quietly assumes has already changed by the time it
starts.

- [ ] Create a hosted Supabase project (supabase.com, free tier —
      still $0, this isn't the money-spending phase)
- [ ] Run every migration (and `grants.sql`, `seed.sql` if wanted for a
      staging project) against the hosted project, exactly as they ran
      locally — a hosted Postgres/Auth instance isn't guaranteed to
      behave identically to `supabase start` just because it passed
      locally
- [ ] Wire up a real SMTP provider for Auth emails (e.g. SendGrid free
      tier) via `supabase/config.toml`'s `[auth.email.smtp]` block —
      already sketched in a comment there since Phase 2, unused until now
- [ ] A real `mobile/.env` (not `.env.local`) pointing at the hosted
      project's URL + anon key, kept out of git the same way
      `.env.local` is
- [ ] Re-run Phase 2's full auth verification (signup → confirm → login
      → refresh → logout → tampered-token rejection) against the
      *hosted* project specifically, not assumed from the local result
- [ ] Cloudflare R2 bucket provisioned for real, if Phase 5 hadn't
      already needed one

**Exit condition:** someone not on your network — a real phone, a real
email address you don't control, no `127.0.0.1` or LAN IP anywhere —
can sign up, receive an actual confirmation email, and log in.

---

## Phase 12 — Store submission prep

Goal: ready to actually submit.

- [ ] Privacy Policy + Terms, hosted somewhere reachable (free — e.g.
      GitHub Pages)
- [ ] Apple "App Privacy" label / Google "Data safety" form — filled to
      match actual behavior, not boilerplate
- [ ] App icon, screenshots, store listing copy
- [ ] Apple Developer Program ($99/yr) — the first real money spent, and
      not before this point
- [ ] Build OAuth (Sign in with Apple, mandatory once any social login
      exists; Google, optional) and the password-reset flow — both cut
      from Phase 2 for exactly this reason (see decision-log 2026-08-13),
      now unblocked by the Apple Developer Program membership above; update
      the login/signup screens to match once built
- [ ] Google Play Console ($25 one-time)
- [ ] TestFlight / Internal testing track with a small real beta group

**Exit condition:** submitted to both stores.

---

## Phase 13 — Beta & post-launch

- [ ] Recruit a small real beta group (a couple of actual Rooms, not just
      test accounts)
- [ ] Watch free-tier usage against the ceilings in `architecture.md`
      (DB size, realtime connections, R2 storage) — know before you hit
      them, not after
- [ ] Feedback loop back into this roadmap
