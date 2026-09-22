# Chasien — Architecture (current state)

Living document. Reflects what we've *decided*, not just brainstormed. When a
decision changes, update this file **and** add an entry to `decision-log.md`
explaining why.

Constraint driving every choice below: **zero budget**, solo/indie, pre-funding,
pre-launch. Everything must run on free tiers until there's a reason (real
user load, real revenue) to spend money.

## Product core (for context)

- **Room** = self-contained social space: feed (reverse-chron only, no
  algorithm), stories, and its own group chat. Visibility is one of
  `public` / `request-to-join` / `invite-only`.
- Every user's access to every piece of content is gated by their
  **membership + role** (`owner` / `mod` / `member`) in the Room that content
  belongs to. This is the one invariant the whole system protects — it's the
  line between "working app" and "data leak."
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
| 6 | Media storage + delivery | **Cloudflare R2** | Free (10GB, **zero egress fees**) | Post images, story media, chat attachments, voice notes. Egress being free (unlike S3/Supabase Storage) is the single biggest lever for staying free as media volume grows. |
| 7 | Push notifications | **Expo Push Service** | Free | No cap that matters pre-scale. |
| 8 | CI | **GitHub Actions** | Free (minutes cap, fine at this scale) | Lint/typecheck/test on every push. |
| 9 | App builds / distribution | **EAS (Expo Application Services)** | Free tier (limited builds/month), local builds free beyond that | Never fully blocked — local builds are slower but free. |

## Database write access (current rule)

- **Row Level Security decides which rows; column grants decide which
  fields.** Every table has RLS on. Client-writable tables grant
  `authenticated` INSERT/UPDATE on named columns only — exactly what the app
  and the SECURITY INVOKER functions (`create_post`, `create_event_post`,
  `vote_poll`, `start_dm`) write. Since 2026-09-16; before that, a blanket
  grant left authority-bearing columns writable (see decision-log).
- **Authority-bearing changes are server-side:** membership, roles and join
  state (room-membership Edge Function), pins and removals (SECURITY DEFINER
  functions), domain verification (service-role Edge Functions), counters
  and notifications (SECURITY DEFINER triggers), and post tags
  (`tag_people_in_post()`, SECURITY DEFINER, which silently drops anyone not
  allowed so no error can reveal a block — clients may only read tags and
  remove their own).
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
  only) and profiles (readable by everyone, because names appear wherever
  Room members are shown). `blocked_pair()` isn't callable over the API, so
  nobody can probe whether two *other* people have blocked each other.
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

## Known costs we can't avoid forever

Not infra, but flagging now so nothing is a surprise later:

- **Apple Developer Program** — $99/year. Only needed when we actually
  distribute to TestFlight/App Store. Dev-time testing can happen via Expo
  Go / internal builds without it.
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

- Full data model / schema (users, rooms, memberships, posts, comments,
  polls, stories, chats, messages, notifications) — next up. Now includes
  `Report`, `Block`, and a moderation action log — see
  `store-compliance.md`, these are day-1 requirements for a UGC app, not
  optional polish.
- Client-side state management & offline/sync strategy for the RN app.
- Exact Row Level Security policy set vs. what moves into Edge Functions.

## See also

- `decision-log.md` — dated log of why each choice above was made.
- `store-compliance.md` — App Store / Play Store requirements that feed
  back into the data model (report/block/account-deletion), so review
  rejection isn't a late surprise.
- `roadmap.md` — the ordered, checkable task list this architecture feeds
  into. Start there for "what do I actually do next."
- `phase/phaseNN.md` — one study-book-style doc per completed phase:
  decisions plus a full code walkthrough, written to teach, not just log.
