# Chasien

A hybrid of Telegram and Instagram: users join **Rooms** — self-contained
social spaces, each with its own posts, stories, and group chat. No
algorithmic feed anywhere in the app; everything is reverse-chronological.

**Status:** pre-implementation. Architecture and data model are being
designed in `docs/`. No production app code exists yet — see the tree below
for what's real vs. planned.

## Repo layout

```
chasien/
├── app_reference/   UI/flow reference mock (React + Vite, web-only).
│                     Throwaway — never shipped, never becomes the real
│                     client. Exists so screens, navigation, and the
│                     implied data model can be pointed at instead of
│                     re-described in prose. See docs/decision-log.md,
│                     2026-08-13 "Product concept & data model hints".
│
├── docs/            Living project journal. Read architecture.md first.
│   ├── architecture.md      Current-state stack and layer choices.
│   ├── decision-log.md      Dated log of *why* each choice was made,
│   │                         append-only, newest entry on top.
│   └── store-compliance.md  App Store / Play Store requirements that
│                             feed back into the data model (report/block,
│                             account deletion) — not just launch paperwork.
│
├── mobile/          (planned, not yet created) React Native (Expo) client
│                     — the actual shipped app.
│
└── supabase/        (planned, not yet created) Postgres migrations +
                      Edge Functions (Supabase CLI convention) — the
                      backend/authorization layer.
```

## Stack (zero-budget, see docs/architecture.md for the full table)

React Native (Expo) · Supabase (Auth, Postgres, Realtime) · Supabase Edge
Functions · Cloudflare R2 (media) · Expo Push · GitHub Actions · EAS builds.
Every layer runs on a free tier through development and early beta; where
each one's free-tier ceiling is, and what to do when we hit it, is in
`docs/architecture.md`.

## Core invariant

Every Room has a visibility mode (`public` / `request-to-join` /
`invite-only`) and every piece of content in it is gated by the requesting
user's membership + role (`owner` / `mod` / `member`) in that Room. Nearly
every query in the system has to check that before returning anything —
it's the line between "working app" and a cross-Room data leak.

## Where to start reading

1. `docs/architecture.md` — what the system is made of right now.
2. `docs/decision-log.md` — why, in order, with alternatives considered.
3. `docs/store-compliance.md` — the app-store constraints shaping the data
   model (report/block/account deletion).
