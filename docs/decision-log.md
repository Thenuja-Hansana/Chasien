# Chasien — Decision log

Append-only journal. Newest entry on top. Each entry: what we decided, the
context at the time, why, what we considered instead, and what would make us
revisit it. This is the "why" behind `architecture.md` — that file says what
we're doing now, this file says how we got there.

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
