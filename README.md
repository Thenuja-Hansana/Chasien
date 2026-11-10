# Chasien

A hybrid of Telegram and Instagram: users join **Rooms** — self-contained
social spaces, each with its own posts, stories, and group chat. No
algorithmic feed anywhere in the app; everything is reverse-chronological.

**Status:** built and running locally, not yet released. The app and
backend are real and verified against a local Supabase stack and a
physical Android phone; nothing is hosted yet, so nobody outside this
machine can use it. `docs/roadmap.md` has the current phase and what's
left before the first build testers can install.

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
│   ├── store-compliance.md  App Store / Play Store requirements that
│   │                         feed back into the data model (report/block,
│   │                         account deletion) — not just launch paperwork.
│   ├── roadmap.md           Ordered, checkable solo-dev task list — start
│   │                         here for "what do I actually do next."
│   ├── running-locally.md   Local runbook, plus every environment
│   │                         problem already hit and how it was fixed.
│   └── phase/               One study-book-style .md per completed phase —
│                             decisions *and* a full code walkthrough, deep
│                             enough to onboard someone from zero.
│
├── mobile/          React Native (Expo Router, TypeScript) client — the
│                     actual shipped app. Screens in src/app/, all data
│                     access in src/lib/.
│
└── supabase/        The backend (Supabase CLI convention): Postgres
                      migrations and Row Level Security policies in
                      migrations/, Deno Edge Functions in functions/.
```

## Stack (zero-budget, see docs/architecture.md for the full table)

React Native (Expo) · Supabase (Auth, Postgres, Realtime, Storage) ·
Supabase Edge Functions · Expo Push · GitHub Actions · EAS builds. Media
runs on Supabase Storage for now, with a move to Cloudflare R2 planned
for its free egress. Every layer runs on a free tier through development
and early beta; where each one's free-tier ceiling is, and what to do
when we hit it, is in `docs/architecture.md`.

## Core invariant

Every Room has a visibility mode (`public` / `request` / `invite` /
`domain_verified`) and every piece of content in it is gated by the
requesting user's membership + role (`owner` / `admin` / `mod` /
`member`) in that Room. Nearly every query in the system has to check
that before returning anything — it's the line between "working app" and
a cross-Room data leak.

## Where to start reading

1. `docs/roadmap.md` — the task list, in order, with the current phase
   marked.
2. `docs/architecture.md` — what the system is made of right now.
3. `docs/decision-log.md` — why, in order, with alternatives considered.
4. `docs/store-compliance.md` — the app-store constraints shaping the data
   model (report/block/account deletion).
5. `docs/hosting.md` — the hosted backend, step by step.
6. `docs/running-locally.md` — step-by-step instructions to get the
   backend and mobile app running on your own machine, plus a
   troubleshooting list of every environment gotcha hit so far.
