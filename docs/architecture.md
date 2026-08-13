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
