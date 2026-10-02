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
| 8 | CI | **GitHub Actions** | Free (minutes cap, fine at this scale) | Lint, typecheck and the React Compiler check on every push that touches `mobile/`. There is no test runner; behaviour is verified by hand against the local stack. |
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

- **Apple Developer Program** — $99/year. Needed to put any build on a
  real iPhone, test builds included, so iOS waits for it. Android
  development needs none of this: a dev-client build installs over USB.
- **Google Play Console** — $25 one-time. Same timing — needed at
  distribution, not before.
- **Domain name** (e.g. `chasien.app`, seen in the mock's URL preview) —
  optional, cosmetic, not required for the app to function.

None of these block development. They come due at "we're ready to put this
in front of real users outside our own devices."

## Where free tiers actually break (design around these, don't just hope)

- **Media bandwidth/storage** is the real ceiling for a photo/video-heavy
  social app — not compute, not DB rows. Mitigate by: compress/resize images
  client-side before upload, cap story/video length, let ephemeral content
  (stories) actually expire and get purged rather than accumulating.
- **Realtime concurrent connections** (~200 on Supabase free tier) — fine
  for dev + friends/beta, will need attention before any real growth.
- Supabase free project **pauses after 7 days fully idle** — a non-issue
  once there's regular dev activity or a scheduled keep-alive ping.

## Not yet decided

The three questions this section used to hold are settled: the schema is
built (`supabase/migrations/`), the split between RLS and server-side
code is the "Database write access" section above, and the client keeps
no state library (screens call `mobile/src/lib/` directly and hold their
own state). What's still open, each tracked in `roadmap.md`:

- Offline behaviour for the feed and chat (Phase 10).
- Which crash-reporting service to use (Phase 10).
- Which SMTP provider sends real Auth emails (Phase 11).
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
