# Chasien — App Store / Play Store compliance notes

Store policies change; re-check the live guidelines close to actual
submission. This doc captures the requirements that are **stable enough to
design for now**, because they affect the data model and core flows, not
just launch-week paperwork.

## What review actually looks at (and what it doesn't)

- It does **not** look at your repo, folder structure, or source code
  organization. `app_reference/` vs `mobile/` vs anything else is invisible
  to Apple/Google.
- It **does** look at the compiled app's behavior: does every screen work,
  does every button lead somewhere real, is there placeholder/lorem-ipsum
  content, does it crash. Half-built flows and dead-end navigation are a
  common, very real rejection reason — that part of the instinct is correct,
  it's just a functional-completeness bar, not a structural one.

## Requirements specific to a UGC social app (build these in now, not later)

Chasien has posts, comments, chat, and Rooms — all user-generated content.
Both stores have explicit UGC policies. Skipping these isn't a "polish
later" item; submissions get rejected without them.

1. **Report & block** — Apple Guideline 1.2 and Google Play's UGC policy
   both require: a way to report objectionable content/users, a way to block
   a user, and (Apple) evidence you act on reports in a reasonable time plus
   a published abuse-contact method. → needs `Report` and `Block` entities
   in the data model, alongside Room membership.
2. **In-app account deletion** — Apple 5.1.1(v) and Google's User Data
   policy require actual deletion (not just deactivation) reachable from
   inside the app, not only via a support email.
3. **Sign in with Apple parity** — if Google/Facebook login is offered on
   iOS, Apple requires Sign in with Apple as an equal option (Guideline
   4.8). Cheaper to design the auth screen for this from the start than
   rework it later.
4. **Privacy Policy + Terms** — both stores require a reachable privacy
   policy URL. Apple's "App Privacy" label and Google's "Data safety" form
   must accurately reflect what the app actually collects — mismatches
   between the declared and actual behavior are a rejection reason on their
   own.
5. **Honest permission prompts** — camera / photo library / microphone /
   notifications each need a specific, honest usage-description string
   (iOS `Info.plist` keys, Android runtime permission rationale). Vague or
   missing ones get flagged.
6. **Feature-complete, crash-free build at submission** — no placeholder
   screens, no unwired buttons, every nav path resolves to something real.

## Feeds back into the data model backlog

Added to `architecture.md`'s "not yet decided" list: `Report`, `Block`, and
a moderation action log, designed alongside Room membership rather than
bolted on after the fact.
