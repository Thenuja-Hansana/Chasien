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

**Current focus:** Phases 0, 1, 2, and 3 are done. All 13 of
`app_reference`'s routes exist as real Expo Router screens (empty-state,
no mock data), sharing ported Avatar/Icon/TabBar components and real
Caprasimo/Figtree fonts. Verified end to end — signup, email confirmation,
login, navigating every screen, a page reload while logged in, and logout
— against the live local stack, in a browser (`expo start --web`); not yet
verified on an iOS/Android simulator or physical device, since none was
available in this environment. Next: Phase 4 — Rooms core (Discover, join
flows, Create Room, Community Settings, real Room feed).

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
      unchanged this phase. **Actual build deferred to Phase 11**, see
      decision-log 2026-08-13 — OAuth needs a registered provider app,
      which needs the paid Apple Developer Program membership that Phase
      11 is the first point we spend money on.

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

**Exit condition — met, on web only:** navigated the entire app end to end
in a browser against the live local stack — sign up, confirm by email,
log in, every screen reachable from the UI, a page reload while logged
in, direct navigation to every dynamic route, log out — zero console
errors. Not yet run on an iOS/Android simulator or physical device (none
available in this environment); do that before treating the "real
device/simulator" half of this exit condition as fully met. Caught and
fixed three real bugs this way that typecheck/lint didn't: `LargeSecureStore`
crashed outright on web (`expo-secure-store` has no web implementation),
that fix's own web fallback collided with AsyncStorage's storage key and
corrupted the encryption key on every login, and the font mismatch above
— see decision-log for all three.

---

## Phase 4 — Rooms core

Goal: Discover, join, and own a Room for real.

- [ ] Discover screen: browse public Rooms
- [ ] Join flows: public (instant), request-to-join (pending → approved),
      invite-only
- [ ] Create Room flow, creator becomes `owner`
- [ ] Community Settings: visibility toggle, members-can-post toggle, role
      management (owner/mod)
- [ ] Room feed: reverse-chron, paginated, empty state

**Exit condition:** two real accounts, one creates a private Room, the
other cannot see it until invited/approved.

---

## Phase 5 — Posts & engagement

Goal: the feed actually does something.

- [ ] Create post: text + image
- [ ] Media upload → Cloudflare R2 via signed URL, client-side
      compress/resize before upload (protects the free tier — see
      `architecture.md`)
- [ ] Post detail + threaded comments
- [ ] Likes
- [ ] Polls: create, vote, live results

**Exit condition:** a post with an image and a poll round-trips through
the real backend and renders identically to the mock's version.

---

## Phase 6 — Chat & realtime

Goal: the messaging half of "Telegram-like."

- [ ] Unified inbox: Room group chat + DMs in one list
- [ ] Realtime delivery via Supabase Realtime, gated by the same
      membership check as everything else
- [ ] Typing indicators, read receipts, reactions
- [ ] Image + voice message attachments (through R2, same pipeline as
      Phase 5)
- [ ] Push notifications for new messages (Expo Push)

**Exit condition:** two devices, real-time message delivery, and a
non-member cannot subscribe to a Room's chat channel even by guessing the
channel id.

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

## Phase 11 — Store submission prep

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

## Phase 12 — Beta & post-launch

- [ ] Recruit a small real beta group (a couple of actual Rooms, not just
      test accounts)
- [ ] Watch free-tier usage against the ceilings in `architecture.md`
      (DB size, realtime connections, R2 storage) — know before you hit
      them, not after
- [ ] Feedback loop back into this roadmap
