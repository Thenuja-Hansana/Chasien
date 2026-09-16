# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chasien: a hybrid of Telegram and Instagram. Users join **Rooms** —
self-contained social spaces, each with its own posts, stories, and group
chat. No algorithmic feed anywhere in the app; everything is
reverse-chronological.

**Core invariant, more important than anything else in this codebase:**
every Room has a visibility mode (`public` / `request` / `invite` /
`domain_verified`) and every piece of content in it is gated by the
requesting user's membership + role (`owner` / `admin` / `mod` / `member`)
in that Room. Nearly every query has to enforce this — it's the line
between "working app" and a cross-Room data leak. When touching any query,
RLS policy, or Edge Function, preserve this before anything else.

## Before starting work

Before writing any code for a build/feature request or a bug fix, give a
detailed summary first and wait for confirmation before implementing:

- **Bug fix:** explain why the bug is happening (root cause) and how you
  plan to fix it.
- **New feature:** explain how it will integrate into the current
  application — which files/layers it touches (client screens, `src/lib/`
  data-access functions, migrations, RLS policies, Edge Functions) and how
  it fits the existing architecture described below.

## Repo layout

- `mobile/` — the real shipped app: React Native via Expo Router, TypeScript.
- `supabase/` — the backend: Postgres migrations, RLS policies, and Deno
  Edge Functions (Supabase CLI convention).
- `app_reference/` — a throwaway React+Vite web mock (never shipped, never
  becomes the real client). Its screens imply the data model and are a
  legitimate reference for "what should this flow look like," but its code
  itself is not a pattern to copy into `mobile/`.
- `docs/` — living project journal. Read `docs/architecture.md` and
  `docs/roadmap.md` before making non-trivial changes; see "Docs" below.

## Commands

All app commands run from `mobile/`:

```bash
npm install
npm run lint        # expo lint (ESLint)
npm run typecheck   # tsc --noEmit
npm start           # expo start
npm run android     # expo run:android (native rebuild)
npm run ios         # expo run:ios
npm run web         # expo start --web
```

There is no test suite/runner configured in this project (no `test` script,
no Jest config) — `lint` + `typecheck` are what CI (and you) can verify
mechanically. Everything else is verified by hand against a live local
Supabase stack (see `docs/running-locally.md`); phase write-ups in
`docs/phase/` describe what was actually checked, not TypeScript's ability
to compile.

CI (`.github/workflows/mobile-ci.yml`) runs `npm ci && npm run lint && npm
run typecheck` inside `mobile/` on any push/PR touching `mobile/**`.

Backend, from the repo root (needs Docker Desktop):

```bash
npx supabase start          # local Postgres + Auth + Storage + Realtime + edge_runtime
npx supabase migration new <name>   # new migration file under supabase/migrations/
npx supabase functions serve        # local Edge Functions
```

Full step-by-step local setup (Android device via `adb reverse`, Docker
gotchas, JAVA_HOME for native builds, Mailpit for confirmation emails, test
account credentials) is in `docs/running-locally.md` — read it before
debugging an environment problem, several non-obvious ones are already
documented there with fixes.

## Architecture

**Stack** (every layer chosen to run on a free tier — see
`docs/architecture.md` for the full table and where each free tier breaks):
React Native (Expo, managed workflow) → Supabase Auth → Supabase Postgres
→ Supabase Edge Functions (Deno) for anything RLS can't safely express →
Supabase Realtime → media storage (currently Supabase Storage, migrating to
Cloudflare R2 later for free egress — see "Media" below) → Expo Push →
GitHub Actions → EAS builds.

**Client (`mobile/`):**
- Expo Router file-based routing under `src/app/`, mirroring the mock's
  routes (e.g. `/c/:communityId` → `app/c/[communityId]/index.tsx`).
  `src/app/_layout.tsx` is the root: it gates fonts/splash screen, holds
  `AuthGate` (redirects between auth screens and the app based on session
  state), and lists modal-presented screens (the four "compose something
  new" sheets) and screens with non-default transitions.
  There is no `Tabs` navigator — `TabBar.tsx` is a plain shared component
  rendered per-screen, because its destinations (current Room, current
  user) aren't a fixed route set.
- `src/lib/` holds all data access — one file per domain (`rooms.ts`,
  `posts.ts`, `chat.ts`, `stories.ts`, `friends.ts`, `subgroups.ts`,
  `notifications.ts`, …), each just async functions wrapping
  `supabase.from(...)` queries or `supabase.rpc(...)` calls. There is no
  separate service/repository class layer — screens call these functions
  directly. Comments in these files routinely cite the specific migration
  that backs a column or constraint; keep that convention when adding
  fields.
- `src/lib/supabase.ts` is the one Supabase client instance, configured
  with `LargeSecureStore` — a custom `auth.storage` adapter that encrypts
  the session (AES-256, key in `expo-secure-store`) before persisting the
  ciphertext in `AsyncStorage`, because `expo-secure-store` alone caps
  values at ~2KB. Read its file comment before touching auth storage.
- `src/lib/theme-context.tsx` + `src/hooks/use-theme.ts` +
  `src/constants/theme.ts` are the single source of truth for colors/type/
  spacing (Light/Dark). Always read colors via `useTheme()`, never a static
  import — screens re-render on theme-mode change through this hook.
- Multi-tab creation flows (Post/Clip/Poll/Event) lift shared state into one
  parent shell rather than owning it per-tab, so switching tabs mid-draft
  never loses input — see `create-post.tsx` and `src/components/create/`.

**Backend (`supabase/`):**
- `migrations/` is timestamp-ordered and cumulative — read the relevant
  ones before changing schema in an area rather than guessing current
  shape from application code alone.
- RLS is deny-by-default on every table, membership-scoped. Some tables
  (notably `room_memberships`) are intentionally **read-only to direct
  clients** — writes (join/approve/invite/role-change) are forced through
  Edge Functions instead of RLS write policies, because a bug in a write
  policy on the one table everything else's access derives from is a
  worse failure mode than a bug in application code.
- Multi-step writes that must be atomic (e.g. `create_post`, `delete_post`,
  `create_event_post`) are Postgres RPC functions, not several sequential
  client inserts — there's no client-side rollback if a later insert in a
  sequence fails, and several tables deliberately have no client DELETE
  policy to unwind a partial write by hand.
- Table `GRANT`s to the `authenticated` role (`grants.sql`-style
  migrations) are required in addition to RLS policies — RLS alone still
  returns "permission denied" without them.
- **RLS restricts rows, not columns.** Client-writable tables use
  column-level `INSERT`/`UPDATE` grants listing exactly what the app (and
  any SECURITY INVOKER function) writes — see
  `20260916150000_lock_down_client_writable_columns.sql`. A new column is
  *not* client-writable until you add it to that table's grant on purpose;
  never re-grant table-wide `INSERT`/`UPDATE`. Anything authority-bearing
  (roles, join state, pins, timestamps, moderation fields, verification)
  goes through SECURITY DEFINER functions or Edge Functions instead. `anon`
  holds no write privileges on any table.
- `functions/` (Deno Edge Functions) is for anything beyond what RLS can
  safely express: cross-table checks, role changes, join-approval flow,
  webhook-triggered push notification fan-out.

**Media:** uploads go through a private, membership-gated bucket behind
short-lived signed URLs, never a public bucket (a public bucket would
undo the Room-isolation guarantee). Client-side compress/resize happens
before upload (`src/lib/mediaUtils.ts`, shared by `media.ts` for posts/
stories and `messageMedia.ts` for chat attachments) to protect the
free-tier storage/egress cap. Currently backed by Supabase Storage behind
a one-file seam, planned to move to Cloudflare R2 (free egress) once R2
can be provisioned/verified — don't assume the storage backend is final
when reading this code.

**Notifications:** DB triggers (`security definer` functions) on the
relevant tables write to `notifications` and fire a Database Webhook →
Edge Function → Expo Push. `src/lib/push.ts` dynamically imports
`expo-notifications` and no-ops under Expo Go, since Expo Go cannot do
push at all as of SDK 53+ — always test push via a dev-client build, not
Expo Go.

## Docs — read before non-trivial changes

- `docs/roadmap.md` — ordered, checkable phase-by-phase task list; **check
  the current phase here before starting new feature work**, and update it
  when a checklist item is completed.
- `docs/architecture.md` — current-state stack and layer choices, kept in
  sync with `decision-log.md`.
- `docs/decision-log.md` — append-only, newest entry on top; the "why"
  behind every non-obvious choice, including bugs found only through
  real-device verification. Add an entry here for any decision that isn't
  self-evident from the diff, and update `architecture.md` alongside it if
  the decision changes current-state architecture.
- `docs/store-compliance.md` — App Store / Play Store UGC requirements
  (report/block, account deletion, permission prompt copy) that shape the
  data model, not just launch paperwork.
- `docs/running-locally.md` — full local runbook plus a running list of
  every environment gotcha already hit and diagnosed (Docker health,
  network/adb quirks, JAVA_HOME, RAM pressure) — check here first before
  re-diagnosing an environment failure from scratch.
- `docs/phase/phaseNN.md` — one deep-dive write-up per completed phase:
  decisions plus what was actually verified against a live local stack
  (not just "it compiles" — several real bugs were only ever caught this
  way).

## Working conventions specific to this repo

- This is a solo-dev, zero-budget project — every architecture choice is
  weighed against free-tier limits (Supabase's 500MB DB cap, ~200
  concurrent Realtime connections, R2/storage egress). Don't introduce a
  paid dependency or service without flagging the cost tradeoff.
- Real verification means exercising a change against the live local
  Supabase stack (and, for UI, a real Android device or `expo start
  --web`) — not just a green typecheck/lint. Several real bugs in this
  codebase's history were invisible to both and only surfaced this way.
- When a change affects Room visibility, membership, or role checks,
  verify the isolation guarantee explicitly (a non-member/wrong-role
  request should return zero rows or a "not found," not just a
  UI-level hide).
