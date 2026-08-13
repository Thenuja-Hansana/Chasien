# Chasien — Decision log

Append-only journal. Newest entry on top. Each entry: what we decided, the
context at the time, why, what we considered instead, and what would make us
revisit it. This is the "why" behind `architecture.md` — that file says what
we're doing now, this file says how we got there.

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
