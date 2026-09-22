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

**Current focus:** Phases 0-8 are done. Chat is real end to end — a
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
The native image picker is confirmed too (exercised for real picking
both photos and videos for Phase 7's story creation, below). iOS remains
entirely untested on real hardware. See `docs/phase/phase06.md`.

**2026-09-02: Phase 7 — Stories, done and verified on the same real
device.** Per-Room ephemeral photo/video stories, a story-ring row, a
full-screen viewer, 24h expiry enforced by RLS itself, and an hourly
`pg_cron` job that deletes expired media from storage for real —
verified directly by backdating a test story and confirming the actual
storage object came back `404` afterward, not just that the row was
gone. Two things the mock's UI didn't actually model correctly only
surfaced once real accounts had real stories at the same time: the
viewer paged through every Room member's stories as one interleaved
sequence at first (fixed to group per-author, real-Instagram-style), and
its progress bars were purely decorative until an auto-advance timer was
added (image: fixed duration; video: tracks actual playback and advances
on end, not a fixed timer). See decision-log, 2026-09-02.

**2026-09-02: Phase 8 — Notifications, done.** Every event type in the
mock's `NOTIFICATIONS` array now has a real trigger and a real push
notification: replies, @mentions (posts and comments), aggregated post
likes ("nadia and 4 others liked your post"), join requests, and pinned
posts — five `security definer` trigger functions feeding a Database
Webhook → Edge Function → Expo Push pipeline that mirrors Phase 6's chat
push exactly. The `notifications` table itself dates back to Phase 1;
this phase is entirely the fan-out. A grouped Activity feed
(`app/notifications.tsx`, Today/This week/Older), a per-Room mute
toggle, an unread badge on the feed's bell icon, and a mods-only pin
action in post detail round out the client side. See decision-log,
2026-09-02.

**2026-09-02: starting the Bones Phase** — a UI/UX polish and mobile
performance pass across every screen built in Phases 0-8, inserted ahead
of Phase 9 (Trust & Safety) since real-device testing keeps surfacing UX
issues late and the surface area only grows from here. Verified on the
Galaxy A14, the same physical device used since Phase 6. Next after this:
Phase 9 — Trust & Safety.

**2026-09-21: Bones Phase closed; the path to a real release is now
planned end to end.** Nine of Bones' ten items are done, and the tenth
(right-sized image variants) is blocked on a paid Supabase feature. The
React Compiler work that followed it now compiles every component, and CI
enforces that. The goal from here is **a downloadable Android APK first,
then the Play Store, then the App Store**, so the roadmap gained an **APK
Beta Phase** between Phases 11 and 12. It's inserted by name rather than
renumbered, the same way Bones was, so existing Phase 9-13 references stay
valid. Phases 9, 11 and 12 were also re-audited against the stores'
current requirements and what's actually built: Phase 9 gained items it
was missing, password reset moved from Phase 12 to Phase 11 because it
never depended on Apple, and the privacy policy moved ahead of the first
public download. See decision-log, 2026-09-21. Next: Phase 9.

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

## Phase 7 — Stories ✅ done (2026-09-02)

Goal: ephemeral content that's actually ephemeral.

- [x] Story creation: image/short video, per-Room
- [x] Story viewer UI (port `StoryViewer.jsx` flow) — reworked to group
      by author rather than the mock's flat sequence, and to
      auto-advance once a segment fills, both found wrong only once
      actually used on a real device; see decision-log, 2026-09-02
- [x] Expiry: stories stop showing after 24h — enforced by RLS itself,
      not just a client-side filter
- [x] Storage lifecycle: expired story media actually gets deleted from
      storage, not just hidden — free-tier storage cap protection.
      Storage runs on Supabase Storage for now, same as Phase 5's
      post-media (Cloudflare R2 can't be provisioned/verified locally;
      swap lands in Phase 11 alongside the rest of that seam)

**Exit condition:** a story posted 25h ago is gone from both the UI and
the storage bucket, unattended. Verified directly — inserted a story
backdated 25h, invoked the cleanup function, confirmed both the row and
the actual storage object were gone (a raw `GET` against the storage API
returned `404 NoSuchKey`), not just that the UI stopped showing it. See
decision-log, 2026-09-02.

---

## Phase 8 — Notifications ✅ done (2026-09-02)

Goal: users know when something happened without polling.

- [x] In-app notifications feed, grouped (Today / This week — port
      `Notifications.jsx`) — added a third "Older" bucket, since a real
      feed accumulates indefinitely unlike the mock's static seed data
- [x] Push notifications: likes, replies, mentions, join requests — plus
      pinned posts, which the mock's static array didn't model but the
      real pin action (below) needed
- [x] Notification preferences (mute a Room's notifications)

**Exit condition:** every event type in the mock's `NOTIFICATIONS` array
has a real trigger and a real push notification. ✅ See decision-log,
2026-09-02.

---

## Bones Phase — UI/UX polish & mobile performance

Goal: the app should feel good and run smoothly on the real hardware
available, not just be feature-complete. Inserted here, ahead of Trust &
Safety, on purpose — every phase so far has been "make the feature real,"
verified mostly on a single physical device (the Galaxy A14) plus a
browser, and real-device testing has already surfaced UX problems late
(Phase 7's story sequencing/progress bars, Phase 8's bucket grouping).
Better to do one systematic pass across every existing screen now, while
the surface area is still Phases 0-8's worth and not Phases 0-13's. Two
items below are pulled forward from Phase 10 (list virtualization/image
caching, loading/empty/error-state audit) rather than duplicated there —
Phase 10 keeps a re-verification pass instead, see its note below.

**Status: complete as of 2026-09-15** — nine of the ten items below are
checked. The tenth, the image-loading item, is done except for
right-sized variants, which need Supabase's paid image transformations
(see that item). *(This line said "all nine" until 2026-09-21. The
composer item was added after the count was written.)*
The exit condition's "feels smooth, no dropped-frame scrolling" is a
good-faith read from manual on-device testing (scrolling stayed
responsive throughout the memory-profiling swipes, no visible jank
noticed across every screen walked this phase), not a frame-timing
profiler measurement — this project doesn't have GPU profiling tooling
set up, so that's as far as "smooth" was verified. Two real bugs were
found and fixed by real-device testing specifically, not just code
review, in this phase's final sessions (Discover's white status-bar
strip; a multiline text field that hid its own first lines at a larger
font scale) — the kind of thing this phase existed to catch before they
reached Phase 9 and beyond.

**2026-09-10:** this checklist sat untouched through several real commits
that actually did Bones Phase-shaped work (the black/white/gray theme
system, the enlarged tab bar, filled tab icons, skeleton loaders, unified
empty states, haptics), so it stopped reflecting reality. Audited against
the actual code rather than assumed — one item is genuinely done, two are
real but narrow, one is partial, and four haven't been started at all. See
decision-log, 2026-09-10, for the full evidence behind each line below.

- [x] UI consistency audit — done, but as a redesign rather than the
      drift-fix originally scoped: `constants/theme.ts` replaced
      `app_reference/`'s single "Organic" dark palette outright with a new
      black/white/gray system in Light and Dark modes, and every screen
      now reads spacing/type/color from that one shared token file via
      `useTheme()` instead of per-screen values — consistency by
      construction, not a manual per-screen patch pass. **2026-09-11
      follow-up:** actually walked the code for color drift (not assumed
      from the token system existing) and found real leftovers — a
      pre-Bones-Phase cream hardcoded in 5 places under two slightly
      different hex values, a destructive-action button not using the
      dedicated `error` token, and a real bug (an invisible toggle thumb
      in Light mode, caught by hand on the device) — all fixed; see
      decision-log, 2026-09-11. **Same-day follow-up:** corner radius and
      type scale audited too — fixed Create Room/Room Settings' mismatched
      avatar-preview radius, and introduced a real `Typography.label`
      token for the small uppercase field/section label, which 9 of 11
      screens had silently paired with the *regular*-weight font file
      instead of the bold one, so it likely never rendered bold at all;
      see decision-log, 2026-09-11. Spacing itself was checked too — the
      common `paddingHorizontal` values (16, 20) already agree with each
      other everywhere, just aren't sourced from a named token, so nothing
      needed fixing there. Every sub-audit above (color, radius,
      type-scale, spacing) is now genuinely done
- [x] Small-screen audit: verify every screen on a small form factor
      (compact Android width, e.g. an iPhone-SE-class 375px-equivalent)
      — check for truncation, overflow, tab bar / keyboard collisions.
      **2026-09-15:** driven live at a 375px viewport (Expo web + a
      headless browser, not just code review) across login/signup, Home,
      Discover, Search, Chats, Notifications, a Room feed, a chat thread
      with the composer filled, Room Settings, Create Room, create-post,
      and Profile — each checked both at initial scroll position and
      scrolled to the true bottom, since a floating tab bar/FAB always
      overlaps whatever's currently at the bottom of an *unscrolled* list,
      which isn't itself a bug. Found and fixed one real one: a Room feed
      with few posts (shorter than the viewport) let the floating
      `PostFab` "+" button permanently cover the last post's like/comment
      row with no amount of scrolling able to clear it, because the
      feed's bottom padding only reserved space for the tab bar
      (`useTabBarClearance()`), not the FAB's own 54px on top of that.
      Fixed in `app/c/[communityId]/index.tsx` by reserving
      `clearance + FAB_SIZE + Spacing[3]` at the feed's bottom instead of
      just `clearance`, whenever `canPost` (i.e. whenever the FAB actually
      renders) — `FAB_SIZE` now exported from `PostFab.tsx` rather than
      re-guessed. Everything else checked (category pill wrapping, member
      rows, poll inputs, chat composer growing to multiple lines, name/
      title truncation) held up cleanly — no other overflow, truncation,
      or collision found. See decision-log, 2026-09-15, for the full walk
      and what was and wasn't covered (native keyboard behavior on a real
      device is out of scope for a web-driven check — bug-fix.md #7
      already covers that separately)
- [x] List virtualization pass: tune `FlatList` (or migrate hot lists to
      `FlashList`) — `windowSize`, `removeClippedSubviews`,
      `getItemLayout` where row height is knowable — for the feed, chat
      message lists, notifications feed, and the story-ring row.
      **2026-09-15:** all four named lists done, `FlatList` throughout
      (no `FlashList` needed). Room feed and chat thread already used
      `FlatList` — added `removeClippedSubviews`/`windowSize`/
      `maxToRenderPerBatch`/`initialNumToRender` to both (no
      `getItemLayout` on either — post/message height varies with
      text/media/polls, so it isn't knowable). The notifications feed
      (grouped Today/This week/Older) was a `ScrollView` with three
      nested `.map()`s — rebuilt as a `SectionList`, the correct
      virtualized primitive for grouped data, with the same tuning props.
      The story-ring row was a horizontal `ScrollView` + `.map()` —
      converted to a horizontal `FlatList` (skipped `getItemLayout` here
      specifically: item width is fixed, but the list also has a
      `ListHeaderComponent` ("Your story"), and hand-computing offsets
      around a header adds a fragile magic-number risk for a list that's
      normally only a handful of items — not worth it for this one).
      Deliberately **not** touched: Home's Room list and the Chats
      inbox list are the same untuned `ScrollView` + `.map()` pattern
      but weren't named in this checklist item's own scope (the feed/
      chat/notifications/story-row four) — flagged as a follow-up
      candidate, not silently folded in. Chat message pagination (the
      thread currently loads a whole conversation's history at once, no
      `onEndReached`) is a separate, larger concern than this item's
      literal scope (windowing an existing list) and wasn't touched
      either. See decision-log, 2026-09-15
- [ ] Image loading/caching pass: `expo-image` cache policy, placeholders
      (blurhash or solid-color), and right-sized variants for thumbnails
      vs. full-screen views instead of always loading the full asset.
      **Partial — 2026-09-15:** cache policy and placeholders done;
      right-sized variants blocked, not implemented (see below).
      `cachePolicy="memory-disk"` added to every remote-image call site
      app-wide (Avatar, post images, chat images,
      Discover cards, profile banner/post-grid, Chats inbox thumbnails,
      story viewer, post detail) — local file-picker previews (create-
      Room, create-post, create-story) deliberately skipped, caching is
      meaningless for a `file://` URI that's about to be uploaded and
      discarded. Solid-color placeholders added everywhere a real gap
      existed: `Avatar.tsx`'s photo case rendered nothing at all while
      loading instead of its own gradient/color fallback (now the
      fallback renders as a base layer, the photo cross-fades on top,
      `transition={200}`) — same fix applied to Discover's Room-card logo
      and Profile's banner, which had the identical gap. Most other call
      sites already had a `backgroundColor` on the image's wrapper (a
      legitimate solid-color placeholder) from earlier work — left as-is.
      Also fixed in passing: `MessageBubble.tsx`'s two chat-image call
      sites were using React Native's core `Image`, not `expo-image` at
      all — no caching, no placeholder support, ever, regardless of this
      pass — switched to `expo-image`. **Right-sized thumbnail/full-size
      variants: not implemented, and not currently implementable.**
      Supabase Storage's image-transformation API (`storage.image_
      transformation` in `supabase/config.toml`) is Pro-plan only and
      deliberately left disabled — this project has stayed on the free
      tier throughout (see `mediaUtils.ts`'s own comments on protecting
      free-tier storage/egress), so there's no dynamic per-request resize
      endpoint to request a smaller variant from. The existing mitigation
      is upload-time, not request-time: `compressImageForUpload()`
      already caps every asset to 1080px on its longest edge (or a
      cropped 1080px-class preset for feed/story uploads) before it ever
      reaches storage, and `expo-image` downsamples during decode to
      roughly its rendered `style` size regardless. Generating and
      uploading a second, genuinely smaller thumbnail variant per image
      would work, but touches the upload pipeline (extra encode, extra
      upload, extra storage object per image) — a real feature, not a
      client-side polish tweak, and out of scope for this pass. See
      decision-log, 2026-09-15
- [x] Loading / empty / error states audited on every screen, not just
      the happy path. **2026-09-15:** every remaining screen this
      checklist item named — Room feed, Chats inbox, chat thread, post
      detail, story viewer, profile, friends, the "View All Rooms" list,
      Room Settings, and a Room's own chat/sub-group list — now uses
      `Skeleton`-shaped loading states (a new `PostCardSkeleton`,
      reused across the Room feed and post detail, plus per-screen row/
      field skeletons matching each screen's real layout) and `EmptyState`
      instead of a bare `ActivityIndicator` or ad hoc text. Auth screens
      (`login.tsx`/`signup.tsx`) turned out to need nothing — their only
      `ActivityIndicator` was already the correct thing, a submit-button
      spinner, not a content gate; same for `_layout.tsx`'s one-time
      session-check spinner, a true app-boot gate with no list shape to
      skeleton. Two real bugs found and fixed along the way, not just
      polish: the chat thread's `messages` state used `[]` for both
      "still loading" and "genuinely empty," so a conversation with real
      history could flash "No messages yet" for a moment before its
      messages arrived — now `null` means loading, distinct from a real
      empty array, threaded through every `setMessages` call site. And
      the story viewer (`story.tsx`) had several text/icon colors reading
      from the app's Light/Dark theme despite sitting on a screen that's
      always dark by design — invisible-on-light-background territory,
      never caught because nothing here had been checked against Light
      mode on a real device before; fixed to the fixed cream palette the
      rest of that screen already uses. See decision-log, 2026-09-15
- [x] Animation and transition polish (`react-native-reanimated`) —
      screen transitions, tab switches, modal/sheet presentations.
      **2026-09-15:** tab switches were already done (`animation: 'none'`
      on the four tab destinations, from the earlier bug-fix pass).
      Modal/sheet presentations: the four screens shaped like a compose
      sheet — Cancel/X, centered title, primary action on the right, full-
      screen form (`create-community`, `create-post`, `create-story`,
      sub-group `chat/create`) — animated with the same slide-from-right
      push as "going deeper" into a Room or a post, despite reading as
      "back out to where I was" when dismissed. Now
      `presentation: 'modal'` in `_layout.tsx`. The story viewer (full-
      bleed media, X to close) got `animation: 'fade'` instead — a modal
      sheet's peek-of-the-screen-behind look is wrong for a full-bleed
      viewer; a cross-fade is the same beat Instagram/Snapchat's own story
      viewers use. Screen transitions elsewhere deliberately left on React
      Navigation's default slide — already a considered decision (bug-fix
      #4), not an oversight; revisiting it isn't part of this pass.
      `react-native-reanimated` itself: was a dependency with zero real
      call sites anywhere in the app (Skeleton's shimmer and the story
      progress bars, both misattributed to it in an earlier decision-log
      entry, actually use React Native's own core `Animated` API) — added
      two real, tasteful micro-interactions: a heart-pop bounce on
      `PostCard`'s like button, and a press-squish on `PostFab`. Hit one
      real compatibility snag: this project's React Compiler flags
      Reanimated's idiomatic `sharedValue.value = ...` mutation as
      "cannot be modified" (`react-hooks/immutability`) — the compiler's
      static analysis has no way to know a shared value's `.value` is
      deliberately mutable, the same class of false positive
      `Skeleton.tsx`'s `Animated.Value` ref already needed a suppression
      comment for. Suppressed the same way, not worked around.
      **Superseded, 2026-09-17/20:** those suppressions turned out to be
      expensive — *any* react-hooks suppression makes the React Compiler
      skip the whole component silently, which is how 26 of 85 files ended
      up uncompiled while lint, typecheck and Metro all stayed green. Both
      are now written the compiler's way instead (`.get()`/`.set()` on
      shared values, `useState(() => new Animated.Value(0))` for the refs),
      every suppression is gone, all 102 components compile, and
      `npm run check:compiler` runs in CI so a new skip fails the build.
      See decision-log, 2026-09-17 and both 2026-09-20 entries. Further
      "polish" (more micro-interactions, custom screen transitions) has
      no natural finish line and isn't pursued further here — this item's
      three named things (screen transitions, tab switches, modal/sheet
      presentations) are each genuinely addressed. See decision-log,
      2026-09-15
- [x] Cold start time measured and reduced (font loading sequence, bundle
      size) — measured on the Galaxy A14 itself, not an emulator or a
      faster dev machine. **2026-09-15:** measured directly on the A14
      over `adb` (`am start -W` for native launch timing, `dumpsys
      meminfo`/screenshots for the rest). The number that matters —
      **production JS bundle size, 5.1MB** (Hermes bytecode, via `expo
      export --platform android`) — is a genuine, actionable figure
      regardless of dev vs. release. The *stopwatch* cold-start numbers
      (32s on an icy-cold Metro cache, ~35s even with a warm one) are
      **not representative of a real user's cold start** and are reported
      as such, not as this app's real startup time — a dev-client build
      fetches an unminified JS bundle over the network on every cold
      launch, which a real release build never does (the bundle is
      embedded). Native launch time alone (`am start -W`'s `TotalTime`,
      before JS even starts) was a consistent ~3.6–4.0s across runs.
      "Reduced" wasn't attempted — there was nothing font-loading-
      specific to fix; the time is dominated by dev-client/Metro
      mechanics this project's own architecture doesn't ship to real
      users. A genuinely comparable number needs a release build, a
      separate, bigger undertaking not attempted here. See decision-log,
      2026-09-15
- [x] Memory profiling pass on the Galaxy A14 — confirm no growth/leak
      scrolling a long feed or chat history, given this project's own
      8GB-RAM dev-machine constraints mean the target device can't be
      assumed to have headroom either. **2026-09-15:** profiled directly
      on the A14 via `adb shell dumpsys meminfo` before and after
      scrolling a Room feed — 55 scroll swipes across three batches.
      Views count stayed bit-for-bit identical (1237) throughout every
      measurement — the clearest possible signal the virtualized
      `FlatList` isn't leaking view instances. Total PSS crept up in the
      first batch (+34MB) then clearly decelerated in the next
      (+4.6MB) — consistent with one-time cache warm-up (`expo-image`'s
      decoded-bitmap cache filling to a steady state), not a per-scroll
      leak, which would show sustained linear growth instead. No chat-
      history scroll test was done (ran out of reliable on-device
      navigation time this session — see decision-log for why blind
      `adb shell input tap` navigation kept missing the Chats tab); the
      Room feed result is the meaningful one since it's the same
      `FlatList` virtualization pattern (tuned in the earlier list-
      virtualization pass) the chat thread also uses. See decision-log,
      2026-09-15
- [x] Touch target and accessibility pass: minimum tap sizes, and
      confirm layouts survive larger system font-scale settings without
      breaking. `accessibilityLabel` went from 4 usages to 56 across 27
      files, `accessibilityRole` and `accessibilityState` from 0 to 66 and
      22 — every icon-only button (back/close chevrons, camera/addPhoto
      photo-picker badges, search, bell, settings gear, send/attach,
      PostFab, avatar-preview taps that open a profile) now has a real
      label instead of announcing nothing, and every custom toggle/radio/
      checkbox this app hand-rolls instead of using RN's own primitives
      (Room visibility choices in 3 places, category chips in 2, the
      mute/members-can-post toggle pills, the sign-up age checkbox, poll
      options, tab bar tabs, filter chips, the sub-group expand chevron)
      now carries `accessibilityRole`/`accessibilityState` so a screen
      reader announces it as the control it actually is, not a bare
      `View`. Undersized (<44px, no `hitSlop`) targets got one: the chat
      composer's attach/send buttons, the post-detail composer's send
      button and two avatar-preview taps, and the theme-color swatch
      picker. **2026-09-15, on the Galaxy A14:** system font scale set to
      1.3× via `adb shell settings put system font_scale 1.3`, walked
      Home, Discover, a Room feed, and Room Settings. Found and fixed a
      real bug along the way, not just checked boxes: `c/[communityId]/
      settings.tsx`'s Description field (and `u/[userId]/edit.tsx`'s Bio
      field, identical pattern) showed several of its own lines —
      sometimes the whole first sentence — invisible above the box, with
      only the bottom lines' cap-heights peeking through cut off. Two
      plausible fixes (`height`→`minHeight`, an explicit `lineHeight`)
      each looked reasonable and neither changed anything on a real
      reload; the actual cause was Android's multiline `TextInput`
      scrolling to the cursor once a controlled `value` carries real
      text and defaulting that cursor to the *end* of the string —
      invisible at normal font scale (the text fits without wrapping) but
      glaring once wrapped-and-scrolled-off at 1.3×. Fixed by pinning
      `selection={{start: 0, end: 0}}` until the field is actually
      focused, confirmed resolved on a fresh reload. Other screens
      checked held up cleanly at 1.3× — header titles truncate correctly
      via existing `numberOfLines`, no other clipping/overlap found.
      **Scope note:** this walked a representative set of screens, not
      literally every one of the ~28 in the app — but the actual bug
      found was systemic (the same "pre-filled multiline field" pattern
      recurs), not a one-off, and both real instances of that pattern are
      now fixed. `allowFontScaling`/`maxFontSizeMultiplier` were never
      added anywhere — nothing found needed them; adding either
      preemptively without a located problem would be guessing. See
      decision-log, 2026-09-15
- [x] Post composer's review step becomes Instagram's New Post screen,
      in four stages, each verified on the Galaxy A14 before the next
      (all four done, 2026-09-16):
  - [x] **Stage 1 — the screen.** Media previewed at exactly the feed's
        size and crop, borderless caption, Post button pinned at the
        bottom, back arrow to the picker. Lint/typecheck clean; tested
        on the Galaxy A14 by the developer, 2026-09-16. See decision-log,
        2026-09-16
  - [x] **Stage 2 — photo editor.** Crop (pinch/drag inside a square,
        portrait or landscape frame), rotate, flip, reset; one shape per
        post; portrait is 3:4. Client-only, no new dependency. Lint/
        typecheck clean, crop math property-checked; tested on the Galaxy
        A14 by the developer, 2026-09-16. Follow-up fix the same day: the
        photo grid remembers what's already in the post (duplicate
        photos). See decision-log, 2026-09-16
  - [x] **Stage 3 — Add location.** Free-text place name (no paid places
        API): `posts.location` column, `create_post` parameter, shown on
        the post card. `20260916160000_post_location.sql`, `LocationSheet`,
        row on the review screen, post card + detail; lint/typecheck clean;
        backend verified against the local stack (11 location checks +
        30-check smoke + 38-check security suite); tested on the Galaxy A14
        by the developer, 2026-09-16, including a follow-up fix for the
        sheet hiding behind the keyboard. See decision-log, 2026-09-16
  - [x] **Stage 4 — Tag people.** Code in (`20260916170000`/`170100`,
        `TagPeopleSheet`, `PostTags` badge/line, "Remove tag" in the post
        menu, `tag` notification + push text); lint/typecheck clean;
        backend verified (15 SQL rule checks, 9 API checks, plus smoke,
        location, posts-grants and security suites). Built as planned below
        except writes go through a SECURITY DEFINER `tag_people_in_post()`
        with no client INSERT at all — a client insert checked by RLS would
        have revealed blocks through its errors. Tested on the Galaxy A14 by
        the developer, 2026-09-16, including the tag notification and push
        arriving on the phone from a second account.
        Original plan: `post_tags` table written only through
        `create_post`, which drops anyone who isn't an approved member of
        the Room or has a block either way; the people picker can read the
        Room's approved members directly (fellow members already can,
        since `20260814073649_members_can_see_each_other.sql` — no new
        search RPC needed, just filtering out blocks); a `tag`
        notification; tags shown on the post. Isolation checked
        explicitly: a non-member listing members, tagging a non-member,
        and reading another Room's tags must all come back empty

**Exit condition:** the app feels smooth (no dropped-frame scrolling on
feed/chat/notifications, no layout breakage) on the Galaxy A14 specifically,
and every screen visually matches `app_reference/`'s design language.
Verify on the same real device the rest of this project has been verified
on, not just in a browser or emulator.

---

## Phase 9 — Trust & safety (store-required, not optional)

Goal: the things that get a UGC app rejected if missing. See
`store-compliance.md` for the policy citations.

**Already in place (audited 2026-09-21).** This phase is mostly client
flows and enforcement, not schema design:
- `reports`, `blocks` and `moderation_actions` exist
  (`20260813051229_trust_and_safety.sql`) with RLS. `blocks` allows
  SELECT/INSERT/DELETE and `reports` allows SELECT/INSERT.
  `moderation_actions` is SELECT-only, so moderation writes go through
  Edge Functions or RPCs, like every other authority-bearing write.
- The only thing that uses any of it today is the tag picker:
  `fetchTaggableMembers` leaves out people you've blocked.
- A Room owner can already delete any post (`delete_post`) and remove a
  member (`removeFromRoom`).
- Chat mute and ban are enforced when a message is inserted into a
  sub-group (`20260905140400`).
- Signup already has an "I'm 16 or older and accept the community
  guidelines" checkbox, but there are no guidelines for it to point to.

**Everything below is enforced server-side, not just hidden in the UI.**
The anon key ships inside every build, so anyone can call the API
directly.

The original five items were "report post/comment/user", "block both
directions", "mod actions", "abuse contact" and "account deletion". They
are expanded below to match what the stores actually check (see
`store-compliance.md`):

- [x] Report flow for posts, comments, chat messages, stories, users, and
      whole Rooms (a Room can itself be the problem). The server captures
      `content_snapshot` itself, because the reported content may be
      deleted before anyone reviews it. The client can't supply the
      snapshot. This was an open item from Phase 10's column audit
      **Done 2026-09-22** (`20260921120000`/`20260921120100`): one shared
      report sheet on all six; a fixed list of reasons plus optional
      details; the snapshot captured by a trigger; and nobody can report
      what they can't see. Verified with 42 direct-API checks, 22 on the
      `moderate` function and 34 UI checks. See decision-log, 2026-09-22
- [x] Reports reach **you**, not just the Room's mods, because the Room
      owner may be the person being reported. For example: Database
      Webhook → Edge Function → email to the abuse inbox, the same shape
      as the notification pipeline
      **Done 2026-09-22**, as push plus an in-app Reports screen rather
      than email (chosen with the user). Each report notifies every *app
      admin*, a role above every Room that only SQL can grant. Still to
      do: make your own account an app admin (locally now, hosted in
      Phase 11)
- [x] A fast way to act on a report: remove the content, and suspend the
      account across the whole app (a Supabase Auth ban, not just removal
      from one Room). Apple asks for "timely responses". Its reviewers
      have been known to spell that out as acting within 24 hours by
      removing the content and ejecting the user who posted it. At this
      scale, a written Studio/SQL procedure is acceptable if it really is
      fast
      **Done 2026-09-22**: Remove, Suspend and Dismiss on each report, in
      the app. Suspension is a Supabase Auth ban through the new `moderate`
      Edge Function, and a session already open lasts up to an hour. Left
      for later: suspending doesn't remove the person's other content, and
      a whole Room can't be taken down
- [x] Block flow, in both directions and on every surface: feed,
      comments, stories, chat, search, Discover, profiles, @mentions and
      tags, and notifications.
      - Chat: no new DM with someone who has blocked you, and no messages
        into an existing one. Phase 10's audit flagged this as unchecked.
      - Notifications: a blocked user's likes and comments don't notify
        you.
      - Settings get a blocked-users list with unblock
      **Done 2026-09-21** (`20260921100000_block_enforcement.sql`): enforced
      in RLS and triggers, with group chats collapsing on the blocker's
      device only. Verified with 47 direct-API checks, including a re-run of
      the Room isolation checks, and 21 UI checks in the real app. See
      decision-log, 2026-09-21. Left for later: presence and bio are still
      readable through the API between blocked people (Phase 10)
- [ ] Filter objectionable content before it's posted. Apple 1.2 asks for
      "a method for filtering objectionable material from being posted".
      At solo-dev scale, that means a server-side word list checked
      against post, comment and message text, Room names and bios, on top
      of report-and-remove
- [x] Mod actions in Room Settings, filling the gaps:
      - admins and mods can remove posts (today only the owner can)
      - mods can remove comments and chat messages
      - mods can mute and remove members from the UI
      - each action writes a `moderation_actions` row
      **Done 2026-09-21** (`20260921110000`/`20260921110100`): one rank
      rule for every removal; comments, messages and stories are removable
      by their authors too (they weren't before); mute is reachable from
      the app for the first time; there's a Moderation log in Room
      Settings. Verified with 41 direct-API checks, each refusal checked for
      its actual reason, and 28 UI checks. See decision-log, 2026-09-21.
      Left for later: a removed chat message stays on other viewers' screens
      until they reopen the chat
- [ ] Write the community guidelines, including an explicit
      zero-tolerance line for objectionable content and abusive users.
      Link them from the signup checkbox that already says people accept
      them, and from settings. Apple expects UGC apps to have users agree
      to terms like these
- [ ] Publish an abuse contact where people can find it: in the app's
      settings, and on the download page and store listing (even just an
      email, at solo-dev scale)
- [ ] In-app account deletion: actual deletion, not deactivation.
      - Decide per table what happens to the user's content: delete it,
        or keep it and show "Deleted user", which the client already
        renders as a fallback.
      - Remove their storage objects and push tokens.
      - Decide what happens to Rooms they **own**: hand each one to its
        longest-standing admin, or delete the Room.
      - Deleting the `auth.users` row needs the service role, so this is
        an Edge Function
- [ ] Account deletion can also be requested from the web, without
      installing the app. Google Play's Data safety form asks for that
      URL. A page with an email address or a form is enough

**Exit condition:** you could pass an App Store UGC review today, not
just "eventually". This is checked with three accounts at once (blocker,
blocked and bystander) and with direct API calls, not only through the
UI.

---

## Phase 10 — Hardening

Goal: doesn't crash, doesn't leak, doesn't feel broken.

- [ ] Crash reporting (free tier — e.g. Sentry free tier)
- [ ] Offline behavior: what happens with no connection, for feed and chat
      — at minimum, don't crash or silently drop user actions
- [ ] Re-verify loading/empty/error states and list virtualization/image
      caching still hold after Phase 9's new screens — the audit itself
      moved to Bones Phase, done ahead of Trust & Safety; this is a
      re-check, not the first pass
- [ ] Security pass: re-verify RLS + Edge Function checks from Phase 1
      still hold after all the features built on top; rate-limit auth
      endpoints.
  - [x] **Column-level writes, done early (2026-09-16).** RLS filters rows,
        not columns, and `grants.sql` had granted every column of every
        table. Audited all 24 tables; reproduced and closed: joining a
        domain-verified Room without a matching email, self-approving into
        private sub-groups, moving messages into a chat you're muted in,
        rewriting who a friendship is between, never-expiring stories,
        double votes on single-choice polls, pre-reviewed reports with
        fabricated evidence, future-dated/self-pinned posts, messages and
        comments, room counter/creator rewrites; and `anon` write/TRUNCATE
        privileges everywhere. Also fixed Room notification mute, which
        silently did nothing. 38-check suite + domain-verification flow +
        30-check backend test, all against the live local stack. See
        decision-log, 2026-09-16 (two entries) and migrations
        `20260916140000`/`20260916150000`
  - [ ] Still open from that audit: client-written timestamps on likes,
        reactions, hidden posts and push tokens (`blocks` closed
        2026-09-21: writes now go only through `block_user()`); direct inserts into
        `polls`/`poll_options`/`post_media`/`events` that skip
        `create_post`'s validation (`post_media` is now column-granted with
        no UPDATE, and its framing columns are CHECK-constrained — see
        `20260917100000` — but a direct INSERT is still possible); an `edited_at` trigger alongside any
        future edit feature. Not audited: business rules outside column
        writes (e.g. starting a DM with someone who blocked you). That
        case now belongs to Phase 9's block item. (`content_snapshot`
        closed 2026-09-22: a trigger captures it when a report is filed)
  - [ ] Rate-limit auth endpoints; re-verify RLS + Edge Function checks
        after Phase 9's features
  - [ ] Between blocked people, `profiles` is still fully readable through
        the API, including bio and `last_active_at` (presence). The screens
        hide them, but only column-level rules on `profiles` would stop a
        blocked person fetching them directly. Found in Phase 9's block
        slice (decision-log, 2026-09-21)
  - [ ] **The push webhooks' Edge Functions trust any caller. Must be
        fixed before the backend is hosted (Phase 11).**
        `notify-activity` and `notify-new-message` send whatever
        notification or message is in the request body, and the only
        gate is a valid JWT, which the app's public anon key is. So anyone
        could push made-up notifications to any user, and
        `notify-new-message` would send their own text to every member of
        a chat. The database webhooks need to send a secret the functions
        check (kept in Vault and the functions' secrets, never in a
        migration), or the functions should re-read the row by id instead
        of trusting the body. Confirmed locally with the anon key only
        (decision-log, 2026-09-22)

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
      locally. **Never run `seed.sql` on the project real users reach.**
      Every seeded account's password is `password123`, and the anon key
      that reaches those accounts ships inside the app
- [ ] Deploy every Edge Function in `supabase/functions/` (seven since
      Phase 9 added `moderate`) and set their secrets on the hosted
      project. Confirm the Database Webhooks (chat and activity push) and
      the `pg_cron` story-cleanup job exist there too, and recreate any
      that were configured outside the migrations. Then add your own
      account to `app_admins` there, or reports reach nobody
- [ ] Point Auth's site URL and redirect URLs at something real.
      Confirmation and password-reset links default to `localhost`,
      which on a stranger's phone goes nowhere. Use a deep link back into
      the app, or a small web page
- [ ] Wire up a real SMTP provider for Auth emails via
      `supabase/config.toml`'s `[auth.email.smtp]` block (already sketched
      in a comment there since Phase 2, unused until now). Supabase's
      built-in sender is rate-limited too hard for real signups.
      *(2026-09-21: this used to suggest SendGrid's free tier, which may
      no longer exist. Resend and Brevo both had free tiers at the time of
      writing. Check current limits before choosing.)*
- [ ] Password-reset flow: a "Forgot password?" link, the email, and a
      screen that the reset link deep-links into. *Moved here from Phase
      12 on 2026-09-21.* It was cut from Phase 2 because it needs a
      deep-link screen (decision-log 2026-08-13), not because it depends
      on Apple. Real users without it who forget their password are
      locked out for good
- [ ] Plan for the free tier's realities:
      - A free project **pauses after about a week without activity**,
        and the app stops working until it's unpaused.
      - Backups on the free tier are limited. Take your own periodic
        `supabase db dump` once real data exists.

      Check the current terms, since these limits change
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

## APK Beta Phase — downloadable Android build (inserted 2026-09-21)

Goal: a real Android app that anyone with the link can download, install
and use, **at $0**. It comes before the store phases because it's free,
it gets the app onto real phones without waiting on any review, and its
testers carry straight into Google Play's closed test in Phase 12. It
depends on Phase 11: a build for other people has to point at the hosted
backend. See decision-log, 2026-09-21.

**Two stages.** First, a **private** build shared only with testers you
know. It can ship as soon as Phase 11 is done. Then, a **public** download
link, which waits for Phase 9 and Phase 10's security pass, because
"public link" means strangers. The dev client installed on the A14 today
can't be shared: it contains no app code and loads everything from Metro
on this laptop.

- [ ] `mobile/eas.json` with an `apk` profile (`buildType: "apk"`) for
      sideloading, and a `production` profile (AAB) for Play later, since
      Play wants an AAB, not an APK. Set the `EXPO_PUBLIC_*` values as
      EAS environment variables pointing at the hosted project. The build
      won't see `.env.local`: it's gitignored, and it points at
      `localhost` anyway
- [ ] Pick one release signing key and keep it forever. Today
      `android/app/build.gradle` signs release builds with the **debug
      keystore**. Every future version has to be signed with the key
      that signs the first public APK. Otherwise people must uninstall
      (and lose their session) to update.
      - Choose between the existing `chasien-upload-keystore.jks`
        (gitignored, which is correct) and an EAS-managed key.
      - Back the key up somewhere off this laptop.
      - Decide now how it relates to Play App Signing in Phase 12. If
        Play signs with a different key, sideloaded users can't update
        in place to the Play version
- [ ] Version numbering: bump `version`, and increment `versionCode` on
      every release (EAS can auto-increment). Android refuses an
      "update" with a versionCode that isn't higher
- [ ] Smoke-test the release build against the hosted backend on the A14,
      not the dev client. Release builds differ: there's no Metro, the
      code is minified, and env values are baked in. Walk signup with a
      real email, Rooms, posting with media, chat, stories and push
- [ ] Push notifications in the release build. FCM and EAS credentials
      are already set up (Phase 6), so this checks them against the hosted
      project's webhooks
- [ ] Privacy policy and community guidelines hosted before the public
      link goes up. The app collects emails, photos, voice notes and
      push tokens. *Moved here from Phase 12 on 2026-09-21.* GitHub Pages
      is free
- [ ] Download page: the APK on **GitHub Releases** (free, with a stable
      link) and a simple page (GitHub Pages) with install steps. Explain
      the "Install unknown apps" permission and the Play Protect warning
      people will see, list a SHA-256 checksum, and link the abuse
      contact and the web account-deletion page
- [ ] An update path, since sideloaded apps never update themselves: EAS
      Update over-the-air for JavaScript-only fixes (check the free-tier
      limits), plus an in-app "new version available" prompt for native
      changes that need a new APK
- [ ] Check Google's developer-verification rules for sideloaded apps.
      Google has been rolling out a requirement that apps on certified
      Android devices come from verified developers, sideloaded apps
      included, country by country. Check whether it applies where your
      users are at release time, and register if so

**Exit condition:** someone not on your network downloads the APK from
the page onto a phone you don't own, installs it, signs up with a real
email, and uses Rooms, posts, chat and push against the hosted backend.

---

## Phase 12 — Store submission prep

Goal: ready to actually submit. **Google Play first** ($25 one-time,
and the APK Beta Phase's testers carry over), **then Apple** ($99 a year).

- [ ] Re-check the privacy policy and terms (hosted since the APK Beta
      Phase) against each store's requirements
- [ ] Apple "App Privacy" label / Google "Data safety" form — filled to
      match actual behavior, not boilerplate. Google's form also needs the
      web account-deletion URL from Phase 9
- [ ] Content rating: Google's IARC questionnaire and Apple's age rating.
      A social app with user content and chat rates higher than a plain
      app. Keep it consistent with the "16 or older" that signup already
      asks people to confirm
- [ ] App icon, screenshots, store listing copy
- [ ] Google Play Console ($25 one-time)
- [ ] **Google Play closed test.** New personal developer accounts have
      had to run a closed test before getting production access: at
      least 12 testers opted in for 14 days in a row, as of the time of
      writing. Check the current numbers. Recruit the APK beta testers
      for it. It's the longest-lead item in this phase, so start it
      first
- [ ] Production build as an AAB (the `production` profile from the APK
      Beta Phase), signed with the key that phase settled on, and
      meeting Play's target API level (Expo SDK upgrades handle this; confirm it at
      submission time)
- [ ] Apple Developer Program ($99/yr), the first recurring cost. You
      need it even to install a test build on a real iPhone. EAS builds
      iOS in the cloud, so no Mac is needed
- [ ] Apple review demo account: App Review needs working login details,
      plus a Room with real-looking content to look at. Make it a
      dedicated account, not a seed one
- [ ] OAuth, **optional**. Sign in with Apple is only required if another
      third-party login (Google, Facebook) is offered. With email and
      password alone, you don't need any OAuth to submit. *(Password
      reset used to be bundled here. It moved to Phase 11 on 2026-09-21,
      since it never depended on Apple.)* If Google login is added, Sign
      in with Apple has to come with it; update the login/signup screens
      to match
- [ ] TestFlight / Internal testing track with a small real beta group

**Exit condition:** submitted to both stores.

---

## Phase 13 — Beta & post-launch

- [ ] Recruit a small real beta group (a couple of actual Rooms, not just
      test accounts)
- [ ] Watch free-tier usage against the ceilings in `architecture.md`
      (DB size, realtime connections, R2 storage) — know before you hit
      them, not after. That includes the inactivity pause from Phase 11,
      which hits hardest during a quiet week of a small beta
- [ ] Act on reports within the time the store listing and guidelines
      promise. Phase 9 builds the tools; this is doing it for real
- [ ] Feedback loop back into this roadmap
