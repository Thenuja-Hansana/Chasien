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

*Added 2026-09-21, from re-checking Phase 9 against the stores:*

7. **Filter objectionable content before it's posted.** Apple 1.2 lists
   four things for UGC apps: a way to filter objectionable material from
   being posted, a way to report it (with timely responses), a way to
   block abusive users, and published contact information. Item 1 above
   covered only the last three. Rejection notes for UGC apps have
   described "timely" as acting within 24 hours by removing the content
   and ejecting the user who posted it.
8. **Terms that users accept.** Apple expects UGC apps to have users
   agree to terms (an EULA or community guidelines) that make clear there
   is no tolerance for objectionable content or abusive users. Signup has
   the checkbox already; the text it points to has to exist.
9. **Account deletion from the web, too (Google).** Google Play's Data
   safety form asks for a URL where people can request account deletion
   without installing the app, in addition to in-app deletion (item 2).
10. **A demo account for App Review (Apple).** Apps that need a login must
    give reviewers working credentials, with enough content in the
    account to review the features.
11. **Content and age rating.** Google uses the IARC questionnaire and
    Apple its own age rating. User-generated content and chat push the
    rating up. Keep it consistent with the "16 or older" that signup asks
    people to confirm.
12. **Google Play closed testing (new personal developer accounts).**
    Before a new personal account gets production access, it has had to
    run a closed test with at least 12 testers opted in for 14 days in a
    row. This is a scheduling constraint, not a code one, but it's the
    longest lead time before a Play launch.

## Sideloaded APK distribution (no store)

This is the roadmap's APK Beta Phase. No store reviews a sideloaded APK,
but that doesn't make items 1, 2, 7 and 8 optional: real people still
need them, and the same testers go on to the Play closed test. What's
specific to sideloading:
- **The signing key is permanent.** Updates must be signed with the same
  key, or users have to uninstall and reinstall. That includes moving
  from the sideloaded APK to the Play version, which depends on how Play
  App Signing is set up.
- **Users have to opt in**, by allowing "Install unknown apps", and Play
  Protect may warn them.
- **Google's developer verification** for apps on certified Android
  devices has been rolling out country by country and covers sideloaded
  apps too. Check whether it applies where your users are.
- **iOS has no equivalent.** An APK is Android-only. iPhone users need
  TestFlight or the App Store, and both need the Apple Developer Program.

## Feeds back into the data model backlog

Added to `architecture.md`'s "not yet decided" list: `Report`, `Block`, and
a moderation action log, designed alongside Room membership rather than
bolted on after the fact.
