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

**Current focus:** Phase 1 — data model. Nothing in Phase 2+ can be built
against real data until Room membership, roles, and the moderation tables
exist.

---

## Phase 0 — Foundation & tooling

Goal: an empty-but-real project skeleton, not another mockup.

- [ ] Create `mobile/` — React Native app via Expo, TypeScript
- [ ] Create `supabase/` — Supabase CLI init (`migrations/`, `functions/`)
- [ ] Decide env/secrets handling (`.env.local`, never committed — add to
      `.gitignore` now)
- [ ] Add `.claude/` (or whatever's untracked) to `.gitignore` — cleanup
      from repo push
- [ ] GitHub Actions: lint + typecheck on push (keep it cheap — no build
      step yet, nothing to build)
- [ ] Port design tokens from `app_reference/src/styles/tokens.css` into
      the RN app's theme — don't redesign, translate

**Exit condition:** `expo start` runs an empty app, `supabase start` runs
locally, CI is green on an empty diff.

---

## Phase 1 — Core data model & backend

Goal: the schema and permission rules that everything else depends on.

- [ ] Schema: `users`, `rooms`, `room_memberships` (role: owner/mod/member,
      join_state: approved/pending/invited)
- [ ] Schema: `posts`, `comments`, `polls`, `poll_votes`
- [ ] Schema: `stories` (with expiry timestamp)
- [ ] Schema: `chats`/`channels`, `messages`
- [ ] Schema: `notifications`
- [ ] Schema: `reports`, `blocks`, `moderation_actions` — see
      `store-compliance.md`, these are day-1, not deferred
- [ ] Row Level Security: deny-by-default, membership-scoped reads, on
      every table above
- [ ] Edge Functions for anything RLS can't safely express: join-request
      approval, role changes, report handling
- [ ] Local seed script (reuse `app_reference/src/data/mock.js` as the
      source data — don't invent new fixtures)

**Exit condition:** every table has RLS on, a second test user genuinely
cannot read a Room they're not a member of — verify this by hand, don't
assume the policy is correct because it compiles.

---

## Phase 2 — Auth

Goal: real accounts, sessions that don't leak, matching the mock's flow.

- [ ] Supabase Auth: email/password
- [ ] Session storage in RN app (secure storage, not AsyncStorage in
      plaintext)
- [ ] Login / Sign up screens — port flow from `Login.jsx` / `SignUp.jsx`
- [ ] Plan (don't build yet) Sign in with Apple — required before iOS
      submission if any social login is added later, cheaper to design the
      auth screen for 3 providers now than retrofit

**Exit condition:** can sign up, log out, log back in, session survives
app restart, and a stolen/expired token is rejected server-side.

---

## Phase 3 — App shell & navigation

Goal: every screen from the mock exists as a real (data-empty) RN screen.

- [ ] React Navigation structure mirroring `App.jsx`'s routes
- [ ] Shared components: Avatar, Icon, TabBar — ported, not redesigned
- [ ] Screens wired to Phase 1 backend but can render "empty state" —
      no mock data left in the real app

**Exit condition:** you can navigate the entire app end to end on a real
device/simulator with a real (empty) account — no dead-end screens.

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
