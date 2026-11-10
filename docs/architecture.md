# Chasien — Architecture (current state)

Living document. Reflects what we've *decided*, not just brainstormed. When a
decision changes, update this file **and** add an entry to `decision-log.md`
explaining why.

Constraint driving every choice below: **zero budget**, solo/indie, pre-funding,
pre-launch. Everything must run on free tiers until there's a reason (real
user load, real revenue) to spend money.

## Product core (for context)

- **Room** = self-contained social space: feed (reverse-chron only, no
  algorithm), stories, and its own group chat (one General channel that
  every member is in, plus sub-groups members join separately). Visibility
  is one of `public` / `request` (ask, a mod approves) / `invite` (hidden
  unless invited) / `domain_verified` (prove an email address at the
  Room's required domain).
- Every user's access to every piece of content is gated by their
  **membership + role** (`owner` / `admin` / `mod` / `member`) in the Room
  that content belongs to. This is the one invariant the whole system
  protects — it's the line between "working app" and "data leak."
- Reference UI mock lives in `app_reference/` (React + Vite, web-only,
  throwaway — not the real client). Screens there already imply the data
  model: communities, posts w/ polls & comments, stories, chats (room-group +
  DM unified), notifications, discover, create/settings flows.

## Architecture layers

| # | Layer | Choice | Cost | Notes |
|---|---|---|---|---|
| 1 | Client | React Native via **Expo** | Free | Managed workflow — avoids owning native build toolchains until we need a custom native module. |
| 2 | Auth | **Supabase Auth** | Free | Don't hand-roll session/token handling — this is a common breach point for indie apps. |
| 3 | Database | **Supabase Postgres** | Free (500MB cap) | Source of truth for users, rooms, memberships, posts, comments, polls, stories metadata, chats, messages, notifications. |
| 4 | Authorization / business logic | **Supabase Edge Functions** (Deno) | Free (generous request quota) | Anything more complex than Postgres Row Level Security can safely express (join-approval flow, role changes, cross-table checks) goes here. Serverless — no idle server to pay for, no cold-start-sleep problem. |
| 5 | Realtime | **Supabase Realtime** | Free (~200 concurrent connections cap) | Chat messages, typing indicators, presence, live comment/like counts. Gated by the same membership check as everything else before a client can subscribe to a Room's channel. |
| 6 | Media storage + delivery | **Supabase Storage** now, **Cloudflare R2** planned | Free (R2: 10GB, **zero egress fees**) | Post images and clips, story media, chat attachments, voice notes, Room and profile pictures. Private buckets read through short-lived signed URLs. R2 is the intended home because its free egress is the single biggest lever for staying free as media volume grows, but it can't be provisioned or verified locally, so the swap is Phase 11's (decision-log, 2026-08-14). |
| 7 | Push notifications | **Expo Push Service** | Free | No cap that matters pre-scale. |
| 8 | CI | **GitHub Actions** | Free (minutes cap, fine at this scale) | Lint, typecheck and the React Compiler check on every push that touches `mobile/`. The app has no test runner; its behaviour is verified by hand on a device. The backend has a re-runnable check, `node supabase/tests/run.js` (since 2026-10-02), run by hand because it needs the local Docker stack. |
| 8a | Crash reporting | **Sentry** (free plan), switched off until a key is set | Free (5,000 errors/month) | Two error screens in `app/_layout.tsx` (one per screen, one for the whole app) and `lib/crash-reporting.ts`, since 2026-11-09. Starts only when `EXPO_PUBLIC_SENTRY_DSN` is set, sends only from release builds, and sends crashes only: no user, IP, screenshots, sessions, console text or query strings. The account and readable stack traces are APK Beta Phase items. |
| 9 | App builds / distribution | **EAS (Expo Application Services)** | Free tier (limited builds/month), local builds free beyond that | Never fully blocked — local builds are slower but free. |

## Database write access (current rule)

- **Row Level Security decides which rows; column grants decide which
  fields.** Every table has RLS on. Client-writable tables grant
  `authenticated` INSERT/UPDATE on named columns only — exactly what the app
  and the one remaining SECURITY INVOKER function (`vote_poll`) write.
  Since 2026-09-16; before that, a blanket grant left authority-bearing
  columns writable (see decision-log). The tables that pass missed were
  closed on 2026-10-02 (Phase 10, slices 3 and 4). No table is on the old
  grant now.
- **A function that enforces a rule can't be SECURITY INVOKER over a table
  the caller may also write.** The caller needs the same permission the
  function uses, so they can skip the function. Two cases, both closed
  2026-10-02:
  - `start_dm()`: "must be friends" and "not blocked" lived in it, and
    anyone could insert the DM row themselves. `conversations` has no
    client write access now: DMs come from `start_dm()`, sub-groups from
    the room-membership Edge Function.
  - `create_post()` and `create_event_post()`: an author could attach a
    poll, an event or media to an existing post, add options to a live
    poll, or delete media, all directly. `posts` (insert), `post_media`,
    `polls`, `poll_options` and `events` have no client write access now.
  `vote_poll()` stays INVOKER because its one rule (single choice) is also
  a trigger on the table, so skipping the function skips nothing.
- **A post is made by `create_post()` or `create_event_post()` and
  nothing else** (since 2026-10-02). Both are SECURITY DEFINER, so they
  enforce what the `posts` INSERT policy used to: `can_post_in_room()`,
  an approved member who is a moderator or in a Room that lets members
  post. The author is always `auth.uid()`. The server applies the limits
  the app does (10 media, 2 to 4 poll options), and a media path must be
  `{room}/{author}/{file}`, so a post can only point at what its author
  uploaded for that Room. A new kind of post attachment means a change to
  these functions, not a new client-writable table.
- **A grant with no policy behind it is withdrawn,** not left for RLS to
  filter. `room_memberships`, the `my_inbox` view, and DELETE on posts,
  comments, messages, profiles and chat participants: a write is refused
  outright, where it used to succeed and touch nothing.
- **Authority-bearing changes are server-side:** membership, roles and join
  state (room-membership Edge Function), pins and removals (SECURITY DEFINER
  functions), domain verification (service-role Edge Functions), counters
  and notifications (SECURITY DEFINER triggers), and post tags
  (`tag_people_in_post()`, SECURITY DEFINER, called only by `create_post()`,
  which silently drops anyone not allowed so no error can reveal a block —
  clients may only read tags and remove their own).
- **One rule decides who can remove content** (since 2026-09-21):
  `can_remove_content()`. Authors can always remove their own content;
  otherwise the actor must be an owner/admin/mod who strictly outranks the
  author in that Room. It's the same rank rule the room-membership Edge
  Function applies to kicks, mutes and role changes. Every removal is a
  SECURITY DEFINER function (`delete_post`, `remove_comment`,
  `remove_message`, `remove_story`) that soft-deletes (stories are expired
  instead, so the hourly cleanup job takes their media) and logs to
  `moderation_actions` whenever the actor isn't the author. Clients can't
  write that log at all.
- **Blocks are enforced in RLS, both ways** (since 2026-09-21). The SELECT
  policies on posts, comments, stories and post_likes include
  `not is_blocked_with(author)`, so any new content table read by people
  other than its author needs the same clause. DMs, DM reactions and
  friend requests between blocked users are refused by triggers, and
  notifications between them are dropped before insert. Two deliberate
  exceptions: Room group-chat messages (collapsed on the blocker's device
  only) and a profile's handle, name and avatar (readable by everyone,
  because names appear wherever Room members are shown). `blocked_pair()`
  isn't callable over the API, so nobody can probe whether two *other*
  people have blocked each other.
- **The `profiles` table gives out id, handle, name and avatar; the rest
  comes from `get_profile()`** (since 2026-10-02). RLS can't hide a
  column, so bio, banner and `last_active_at` (presence) were readable by
  someone you'd blocked. SELECT on the table is granted by column now,
  and `get_profile(user)` returns the whole profile with those three
  blanked when there's a block in either direction. In the app that's
  `fetchProfile()`; embeds of `profiles` ask for handle and name and are
  unaffected. A new profile field is hidden by default: it has to be
  added to the table's SELECT grant or to `get_profile()` on purpose.
- **Reports go to app admins, who sit above every Room** (since
  2026-09-22). `app_admins` is written only with the service role; clients
  can't even read it, and `current_user_is_app_admin()` answers only about
  the caller.
  - A report's `content_snapshot` is captured by a trigger when it's
    filed, never by the client.
  - Target validation runs as the reporter, so nobody can report what
    they can't see.
  - App admins can remove content in any Room: `can_remove_content()`
    includes them.
  - They suspend accounts through the `moderate` Edge Function, which
    applies a Supabase Auth ban and writes an `account_suspensions` row
    that only admins can read.
  - The same function signs a report's media for review, using only the
    paths in that report's snapshot.
- **Objectionable text is refused by the database** (since 2026-09-22).
  A `filter_blocked_terms` trigger runs `reject_blocked_terms()` on every
  column people type into: posts, comments, messages, story captions,
  polls, events, Rooms, sub-groups and profiles. So a new user-text column
  needs the trigger too. `blocked_terms` (severe terms only) is private.
  Text is normalized first (case, accents, look-alike letters, leetspeak,
  spaced-out letters) and matched as whole words. `text_is_allowed()` is
  public so signup can check before calling Supabase Auth.
- **A push is built from the row, not from the request** (since
  2026-09-23). `notify-activity` and `notify-new-message` are reachable by
  anyone with the anon key, so they take only the row's id from the body,
  read the row with the service role, and claim it first
  (`update … set pushed_at = now() where id = $1 and pushed_at is null`).
  Nothing can be injected through the request, a replay does nothing, and
  no row can be pushed twice. `pushed_at` is never granted to clients, so
  nobody can pre-claim a row to silence someone's push.
- **Deleting an account is real deletion** (since 2026-09-22), run by the
  `delete-account` Edge Function in this order:
  1. list the files (`account_storage_paths()`)
  2. `delete_account_data()`, one transaction: owned Rooms go to
     `room_successor()` (the next admin, then mod, then member) or are
     deleted if nobody else is in them, and their posts, comments,
     messages and stories are deleted
  3. delete the Auth user, whose cascade removes the rest
  4. remove the files

  Deleting your own account needs the password entered in the last 5
  minutes (the token's `amr` timestamp). Reports and the moderation log
  are kept as safety records. `room_successor()` is also what the
  owner-leaves trigger uses, so the preview and the result can't
  disagree.
- **Messages meant for people come from `raise exception` with no custom
  errcode (SQLSTATE `P0001`),** and screens show errors through
  `errorMessage(e, fallback)` in `lib/errors.ts`. It shows `P0001`
  messages and thrown `Error`s, and falls back for everything else
  (permission, RLS, constraint and network errors). supabase-js returns
  database errors as plain objects, so an `e instanceof Error` check would
  hide them all.
- **No client edits of posts, comments or messages yet.** When editing
  ships, grant UPDATE on the content column together with a trigger that
  stamps `edited_at`, so edits can't be silent.
- `anon` has no write privileges on any table, including future ones.
- **A new table, sequence or function is closed until a migration opens
  it** (since 2026-10-02). Supabase's default privileges, which handed
  each new one to `anon` and `authenticated`, are withdrawn; `anon`
  holds no privilege on any table at all. So a new table needs its
  `grant`s written out, by column for anything writable, alongside its
  policies. `supabase/tests/security_invariants.js` reads these rules
  back from the catalogs and fails when one is broken; a function the
  app calls is added to its list in the same change.
- **A secret is kept out of reach by a column grant, not a policy.** The
  email-verification token sat in a row its owner could read, so the
  person it was emailed to could read it without the email and join a
  domain-verified Room. `room_email_verifications` grants SELECT on
  every column but `token` (2026-10-02). RLS picks rows; only a grant
  picks columns.
- **A database function is callable over the API only if a migration
  grants it** (since 2026-10-02, `20261002100000`). PostgREST turns every
  function in `public` into an `/rpc` endpoint, and Postgres opens a new
  function to everyone unless told otherwise, so the defaults are
  withdrawn: a new function is callable by nobody but the service role
  until it's granted on purpose. `authenticated` holds the functions the
  app calls and the helpers its RLS policies evaluate. `anon` holds one,
  `text_is_allowed`, for the signup screen. Trigger functions need no
  grant.
- **The membership helpers answer only about the caller.**
  `is_room_member`, `is_room_moderator`, `is_room_admin`, `is_room_owner`
  and `is_conversation_participant` have to be executable by
  `authenticated`, because policies run as the person querying; that also
  makes them endpoints. So each returns false for any user id but
  `auth.uid()`. A policy must therefore pass `auth.uid()` (all of them
  do). Code that has to ask about *someone else* (a trigger deciding who
  to notify, a removal checking rank) is SECURITY DEFINER and uses
  `room_rank()`, which is not an endpoint: -1 not a member, 0 member,
  1 mod, 2 admin, 3 owner.
- **One Edge Function is public, on purpose** (since 2026-10-02):
  `verify-room-email`, the link inside a domain-verification email. It's
  opened from a mail app, which sends no key, so `supabase/config.toml`
  sets `verify_jwt = false` for it; the emailed token is the credential.
  Every other function keeps the gateway's JWT check, and a new one is
  gated unless it's added to `config.toml` deliberately.

## Limits (current rule)

Since 2026-10-02. The reason for all of it is the free tier: 500 MB of
database and about 1 GB of files. Nothing was limited before.

- **Text has a maximum, in the database.** CHECK constraints
  (`20261002140000`): post 2,000 characters, comment 1,000, message
  4,000, bio 160, display name 50, Room name 50 and description 300,
  sub-group the same, story caption 200, poll question 150 and option 60,
  event title and location 100, link 500. The app's inputs carry the same
  numbers as `maxLength` (`mobile/src/constants/limits.ts`), so nobody
  types past one. **A new text column gets a constraint and an entry
  there.**
- **Actions have a rate, per person.** A BEFORE INSERT trigger,
  `enforce_rate_limit(action, bucket, max, …)`, on each limited table,
  counting in `rate_limit_counters` (one row per person, action and
  fixed minute/hour/day window). It limits `auth.uid()`, so the service
  role, cron and seeds aren't limited. Messages 30 a minute and 2,000 a
  day; comments 10 a minute and 500 a day; likes and reactions 60 a
  minute each; posts and stories 10 an hour and 30 a day each; reports 10
  an hour; friend requests 20 an hour; Rooms 5 a day; verification emails
  1 a minute per Room and 5 an hour (applied in the Edge Function). One
  message for all of them, shown by the app. **A new table people can
  write to gets a trigger.**
- **Per-minute limits don't protect storage by themselves; the daily
  ones do.** One account at 30 messages a minute of 4,000 characters is
  about 170 MB a day. With 2,000 a day it's about 8 MB.
- **Uploads: 50 files per person in 24 hours, and video at most 25 MB**
  in posts and stories. The count is a RESTRICTIVE policy on
  `storage.objects` that counts the person's recent files. It can't use
  the counter table: the Storage service checks the INSERT policy in a
  transaction it rolls back, then writes the row itself, so anything a
  policy writes is lost.
- **Clips are 60 seconds at most**, in the app: the camera stops, and a
  longer gallery video is shown dimmed and can't be picked. The server
  can't see duration; the 25 MB limit is its half. There is no video
  compression in the app.
- **Things that would otherwise pile up are deleted on a schedule**
  (`pg_cron`):
  - expired stories, hourly (Phase 7)
  - files nothing points at, daily: uploads never attached after 24
    hours, replaced profile and Room pictures, and the media of posts and
    messages removed more than 7 days ago. `unused_media()` decides,
    the `cleanup-unused-media` Edge Function removes
  - notifications older than 90 days, daily
  - rate-limit counters older than two days, hourly
- **Not limited here:** Auth's own endpoints (sign-in, sign-up, token
  refresh, emails). Those are settings on the Supabase project, already
  at sensible values in `config.toml` for the local stack and to be set
  on the hosted one in Phase 11, with the decision on a signup captcha.

## Where the database reaches its Edge Functions (current rule)

Since 2026-11-10 (Phase 11 slice 1, `20261110100000`): every call from
the database to an Edge Function, the two push triggers and the cleanup
jobs, goes through `call_edge_function()`, which reads the address and
the anon key from Vault (`edge_functions_url`, `edge_functions_key`). Set
by `seed.sql` locally and by hand on the hosted project
(`docs/hosting.md`). Never write an address or key into a trigger or a
job; the security re-check refuses it. A push trigger sends only the
row's id.

## Network failures (current rule)

Online-only, with no offline queue, but never silent (Phase 10 slice
9, decision-log 2026-11-10):
- Every request through `lib/supabase.ts` times out: 20 seconds, 5
  minutes for an upload.
- `errorMessage()` (`lib/errors.ts`) words a dropped, refused or
  timed-out request as "No connection. Check your internet and try
  again."
- A screen that loads on open shows `LoadError` (Try again) when its
  first load failed, clears its error after a successful load, and
  reloads on `useOnReconnect()` (`lib/network.tsx`) unless reloading
  would cost someone their place or unsaved edits. A new screen follows
  the same pattern.
- The "No connection" strip (`components/OfflineBanner.tsx`) follows
  the phone's own internet state, from `expo-network`.
- Sign-out removes this phone's push token first and ends this phone's
  session only.

## System bars (current rule)

- **The status bar and Android's navigation bar follow the app's own
  Light/Dark mode, not the phone's** (since 2026-10-02). The root layout
  mounts `<StatusBar>` (`expo-status-bar`) and `<NavigationBar>`
  (`expo-navigation-bar`) with a style taken from `useThemeContext().mode`.
  Never `style="auto"`: that follows the phone's theme, and the mode
  chosen in Settings can differ from it.
- **A screen that's dark in both modes mounts its own pair** with
  `style="light"` (the clips and story viewers). Both components stack,
  so the root's style comes back when the screen closes.
- **Sheets and dialogs are separate windows on Android,** and React
  Native styles each one's navigation bar from the OS-level colour
  scheme, not from the components above. So `ThemeProvider` also calls
  `Appearance.setColorScheme()` with the stored mode (`'unspecified'`
  when there is none, which follows the phone). Both halves are needed:
  the component for the main window, the scheme for every `<Modal>`.
- `expo-navigation-bar` is a native module: adding or upgrading it means
  rebuilding the dev client.

## Known costs we can't avoid forever

Not infra, but flagging now so nothing is a surprise later:

- **Google Play Console** — $25 one-time. Due when the private APK's
  testers move into Play's closed test (roadmap, Phase 12), not before.
  The same account is what Google's developer verification asks of a
  sideloaded app on more than 20 devices, which is why there's no
  public APK link (decision-log, 2026-10-08).
- **Domain name** — `chasien.com`, already owned (Namecheap); the cost
  is its yearly renewal. It isn't cosmetic: the email provider sends
  from a domain it has verified, and the privacy policy and
  account-deletion pages need an address. *(Until 2026-10-08 this said
  `chasien.app`, "optional, cosmetic".)*
- **Apple Developer Program** — $99/year. Needed to put any build on a
  real iPhone, test builds included. **Set aside** (2026-10-08): iOS
  isn't scheduled. Android development needs none of this: a dev-client
  build installs over USB.

Nothing is due before the private APK beta. The first payment is
Google's $25.

## Where free tiers actually break (design around these, don't just hope)

- **Media bandwidth/storage** is the real ceiling for a photo/video-heavy
  social app — not compute, not DB rows. Mitigate by: compress/resize images
  client-side before upload, cap story/video length, let ephemeral content
  (stories) actually expire and get purged rather than accumulating.
- **Egress on Supabase Storage is 5 GB a month** (checked 2026-10-08),
  and it's the first ceiling video reaches: 200 views of one 25 MB
  clip, or about 3,500 downloads at the 1.4 MB average measured in
  Phase 10. R2's egress is free, so the R2 move (Phase 11) has to come
  before strangers can watch clips, not after.
- **Realtime concurrent connections** (~200 on Supabase free tier) — fine
  for dev + friends/beta, will need attention before any real growth.
- Supabase free project **pauses after 7 days fully idle** — a non-issue
  once there's regular dev activity or a scheduled keep-alive ping.
- **The first paid step is Supabase Pro, $25 a month** (checked
  2026-10-08). It lifts the database to 8 GB, files to 100 GB and
  Realtime to 500 connections, and ends the inactivity pause. It's the
  first monthly bill, so it's the deadline for deciding how the app
  earns anything; no revenue plan exists yet.

## Not yet decided

The three questions this section used to hold are settled: the schema is
built (`supabase/migrations/`), the split between RLS and server-side
code is the "Database write access" section above, and the client keeps
no state library (screens call `mobile/src/lib/` directly and hold their
own state). What's still open, each tracked in `roadmap.md`:

- Which release signing key to keep for good, and how it relates to Play
  App Signing (APK Beta Phase).

## See also

- `decision-log.md` — dated log of why each choice above was made.
- `store-compliance.md` — App Store / Play Store requirements that feed
  back into the data model (report/block/account-deletion), so review
  rejection isn't a late surprise.
- `roadmap.md` — the ordered, checkable task list this architecture feeds
  into. Start there for "what do I actually do next."
- `phase/phaseNN.md` (and `phase/bones.md` for the Bones Phase, which
  was inserted by name) — one study-book-style doc per completed phase:
  decisions plus a full code walkthrough, written to teach, not just log.
