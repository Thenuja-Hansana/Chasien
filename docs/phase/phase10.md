# Phase 10 — Hardening

> Study-book style: what exists, why each call was made, how the code
> works, and what went wrong along the way. This is the phase that makes
> the app safe to put on the internet and bearable to use when the
> internet isn't there. It was built in ten slices between 2026-09-23 and
> 2026-11-10. Before each one, the plan went to the user with a root cause
> and a recommendation, and their decisions shaped it. Each slice was
> reproduced first (a control run before the fix), then verified against
> the live local stack, with direct API calls as real users, and on the
> Galaxy A14.
>
> Two principles run through it:
> - **The anon key ships inside every build.** Anything the app's own
>   code enforces protects nobody, so the security half (slices 1-7)
>   closes doors in the database itself, and makes "closed" the default.
> - **Never silent.** The second half (slices 8-10) makes every failure
>   say what happened and offer a way on: a crash, a dead connection, a
>   load that didn't come back.

**Goal:** doesn't crash, doesn't leak, doesn't feel broken.
**Exit condition (from `docs/roadmap.md`):** you'd hand this to a
stranger without wincing.

---

## 1. What this phase produced

| Slice | What | Where |
|---|---|---|
| 1 | A push is built from the database row, not the request | `20260923100000`, both push Edge Functions |
| 2 | Database functions are closed unless a migration grants them | `20261002100000` |
| 3 | The tables the column lockdown missed; no DM around `start_dm()` | `20261002110000` |
| 4 | A post and its attachments are made by `create_post()` and nothing else | `20261002120000` |
| 5 | Bio, banner and presence come from `get_profile()`, blanked between blocked people | `20261002130000` |
| 6 | Size limits, rate limits, daily caps and cleanup jobs | `20261002140000`-`140300`, `cleanup-unused-media` |
| 7 | The security re-check as a script; new tables start closed | `20261002150000`, `supabase/tests/run.js` |
| 8 | Error screens, and crash reporting off until a Sentry key is set | `app/_layout.tsx`, `lib/crash-reporting.ts` |
| 9 | Online-only, but honest: timeouts, Try again, reconnect, sign-out | `lib/supabase.ts`, `lib/network.tsx`, 15 screens |
| 10 | The same on Phase 9's screens; correcting a verification address | six screens |

Between slices, found along the way and fixed in their own commits:
- the admin role never reached two places (2026-10-01)
- the emailed domain-verification link answered 401, the status bar was
  invisible in Light mode, and New Room showed two theme swatches
  selected (2026-10-02, from a pass over every item the decision log
  still listed as unchecked)
- "Resend email" did nothing after leaving the verify-email screen
  (2026-10-08)
- `chasien.app`, which isn't ours, replaced with `chasien.com`, and CI
  broken a second time by a lock file npm 11.6 wrote (2026-11-09)

The re-check, `node supabase/tests/run.js --live`, ends the security
half at 521 checks, every one passing; it was run again after every
backend change since.

---

## 2. Decisions, and the reasoning behind each

### 2.1 Make a forged call pointless, rather than keep a secret

The push functions trusted their request body, and the only gate was a
JWT, which the anon key is. The obvious fix, a shared secret between the
database webhook and the function, has to be kept in step in two places
and still lets anyone who has it inject content. Instead the functions
take only a row id, read the row themselves, and **claim it** in one
statement before sending (`update … set pushed_at = now() where id = $1
and pushed_at is null returning …`). A forged call can at most ask for a
push the database was about to send anyway, and a double push became
impossible as a side effect.

### 2.2 Closed by default, at every level

Slices 2, 3 and 7 are the same decision applied three times:
- **Functions.** Postgres grants EXECUTE to PUBLIC, and PostgREST serves
  every function in `public`, so 43 of 66 were callable signed out.
  Revoked from everyone, then granted back by name: one to `anon`, 25 to
  `authenticated`. New functions start closed.
- **Columns.** RLS restricts rows, not columns, so client-written tables
  carry column-level INSERT/UPDATE grants (2026-09-16, finished in slice
  3). A new column isn't writable until a migration says so.
- **Tables.** Supabase's default privileges grant a new table to `anon`
  and `authenticated`; slice 7 withdrew them, which is how the blanket
  grants of slices 3 and 4 had come about.

Fixing the one function or the one table each time would have left the
cause: the next one written would have been open the same way.

### 2.3 A rule lives in a SECURITY DEFINER function, and the table has no client write

`start_dm()` checked "friends and not blocked", but it ran as the caller,
so the caller needed INSERT on `conversations`, and with it could skip
the function. The same shape let attachments skip `create_post()`'s
limits. The rule from slices 3 and 4: the function that enforces a rule
is SECURITY DEFINER, and the tables it writes have no client write grant.

### 2.4 Columns a policy can't hide go behind a function

RLS can't hide a column, so between blocked people bio, banner and
`last_active_at` were still readable over the API. The table now gives out
id, handle, name and avatar; `get_profile()` returns the rest and blanks
it when there's a block either way.

### 2.5 Limits that add up to the free tier

The first plan was per-minute rate limits. The user asked whether that
would actually keep storage from running out. It wouldn't: a patient
account could still fill 1 GB. So slice 6 added daily caps, 50 uploads a
day, video at 25 MB, clips at 60 seconds, a `char_length` CHECK on every
text column with the same number as the input's `maxLength`, and cleanup
jobs for unused files and old notifications. The numbers are in
`architecture.md`, "Limits".

### 2.6 The security check is a script, not a memory

September's suites were never saved, so slice 7 turned the re-check into
`supabase/tests/run.js`: 23 rules read from the database's own catalogs,
an isolation matrix of 156 checks, 54 Edge Function calls with the wrong
role, and each slice's suite. It cleans up after itself and is re-run
after any backend change. A function the app calls, or a column that must
stay secret, goes on the lists in `security_invariants.js` in the same
change.

### 2.7 Crashes: two error screens, and crash reports off until there's a key

One screen's crash used to blank the whole app. Now a crashed screen is
replaced inside the app with Try again and Go back, and a crash outside
any screen gets a last-resort screen drawn outside every provider.
Sentry is wired but does nothing until `EXPO_PUBLIC_SENTRY_DSN` is set,
and only release builds send. The account was deferred to the APK Beta
Phase (the user's choice): during development crashes are on Metro's
screen anyway. What a report may carry was decided by reading real
reports from a stand-in server, not from the SDK's documentation.

### 2.8 Online-only, but honest

No offline queue (the roadmap's call, kept). Instead every request times
out, every network failure says "No connection", every first load that
fails offers Try again, open screens reload when the connection returns,
and nothing typed, recorded or picked is lost on a failed send. Where a
reload would cost someone their unsaved edits or their place (Room
settings, the story and clips viewers), it doesn't reload by itself.

### 2.9 Sign-out unregisters the phone, and only signs out this phone

A signed-out phone kept getting the old account's pushes, message text
included. Sign-out now deletes this phone's push-token row first, while
there's still a session to do it with, and is **refused while offline**
rather than leave the row behind (the user's choice). It also signs out
of this phone only; the default had ended the account's sessions on every
device, whose tokens then stayed registered too.

### 2.10 Nobody deletes their account without seeing what happens to their Rooms

On the delete-account screen, "Delete my account" stays disabled until
the preview of the Rooms they own has loaded (slice 10, the user's
choice). If it fails, the error and Try again are in that section, not
down by the button.

---

## 3. Code walkthrough

### 3.1 Claiming a row (slice 1)

```sql
update notifications set pushed_at = now()
 where id = $1 and pushed_at is null
returning *;
```
Zero rows back means "already sent, or never existed", and both give the
same answer, so ids can't be probed. `pushed_at` is in no column grant,
so a client can't claim a row to silence someone's push. If Expo itself is
unreachable the claim is given back, because a lost push is worse than a
retried one.

### 3.2 The shape of a "closed by default" migration (slice 2)

Revoke from `PUBLIC, anon, authenticated` on every function, `alter
default privileges … revoke execute`, then one `grant execute … to
authenticated` per function the app calls. The membership helpers
(`is_room_member()` and its siblings) gained `and user_id = auth.uid()`,
so they answer only about the caller; code that has to ask about someone
else uses `room_rank()`, which isn't an endpoint.

### 3.3 Timeouts in one place (slice 9)

`lib/supabase.ts` hands the client a `fetchWithTimeout`: an
`AbortController` per request, 20 seconds, or 5 minutes for a POST/PUT to
`/storage/v1/object/` (signing URLs is a POST there too, and is excluded).
A timeout rejects as `AbortError` with the message "Network request timed
out". The name is load-bearing: the database client retries a failed GET
three times with back-off unless it was aborted.

### 3.4 Recognising a network failure (slice 9)

`isNetworkError()` in `lib/errors.ts` checks the shapes supabase-js
actually produces: a database query's plain error object, Storage's and
Auth's `Error`s, and Edge Functions' `FunctionsFetchError`. The global
`fetch` is Expo's (SDK 57), so a refused connection reads "fetch failed:
java.net.ConnectException …". `errorMessage()` turns all of them into "No
connection. Check your internet and try again."

### 3.5 The load pattern every screen now follows (slices 9 and 10)

```tsx
const load = useCallback(() => {
  fetchThings(id)
    .then((rows) => { setThings(rows); setError(null); })
    .catch((e) => setError(errorMessage(e, 'Failed to load things.')));
}, [id]);
useFocusEffect(load);
useOnReconnect(load);

{things === null && error ? <LoadError message={error} onRetry={load} />
  : things === null ? <Skeletons /> : …}
```
`useOnReconnect()` (`lib/network.tsx`, from `expo-network`) fires once
when the phone's connection comes back. Realtime reconnects by itself but
replays nothing, which is why a chat has to fetch again.

### 3.6 Two error boundaries (slice 8)

- `<Stack unstable_screenErrorBoundary={ScreenError}>`: each screen is
  wrapped, inside the providers, so the error screen has the theme and the
  router. The `unstable_` prefix is expo-router's; typecheck catches a
  rename.
- `export function ErrorBoundary` in `_layout.tsx`: expo-router wraps the
  whole root layout in it, so it's outside every provider and
  `useTheme()` would throw there. It takes Light or Dark from the phone
  and hides the splash screen itself.

React retries a failed render once before a boundary takes over, so a
crash that only happens on the first render never reaches it. Testing it
needs a crash that lasts a few seconds.

### 3.7 A banner the app makes room for (slice 9)

A floating pill covered headers. The strip that replaced it moves the app
down by its own height only, and is drawn in the gap that opens under the
status bar. Moving the app down by the status bar's height as well left
an empty band, because a screen's `SafeAreaView` keeps its full padding
wherever it sits. The app is always the first child, online or not, so
going offline never remounts it.

### 3.8 What a crash report may carry (slice 8)

`lib/crash-reporting.ts`: no user, no IP, no screenshot, no view
hierarchy, no replay, no tracing, no sessions; breadcrumbs only for
requests (query string stripped) and foreground/background. Android's own
breadcrumbs (battery, power saving, network and VPN state) skip
`beforeBreadcrumb`, so `beforeSend` filters them as well. Read its file
comment before letting a report carry anything new.

---

## 4. Bugs and findings

- **The email-verification token was readable by the person it was meant
  to be emailed to** (slice 7). A domain-verified Room could be joined
  without receiving the email. The worst hole of the phase; found by
  writing the schema rules, not by looking for it.
- **`notify_mentions()` could forge a mention from anyone to any Room
  member**, signed out (slice 2).
- **Anyone could open a DM with anyone** by inserting the conversation
  row, around `start_dm()`'s friends and block rules (slice 3).
- **A 200,000-character post was accepted** (slice 4); nothing limited
  text anywhere.
- **The emailed verification link answered 401**: the gateway wanted a
  JWT before a function written to be public ran (2026-10-02).
- **The status bar was white on white in Light mode**, and a Dark app on
  a Light phone sat on a light navigation bar (2026-10-02).
- **Expo's `fetch` words its errors differently from React Native's**, so
  the first version of the network check missed every real failure. Seen
  only by logging the error Home actually received (slice 9).
- **A timeout reported as a network error would have taken about 87
  seconds**, because of the database client's own retries (slice 9).
- **Sentry sent a "session" on every app start and close**, and
  Android's breadcrumbs went straight past the JS filter (slice 8). Both
  found by reading real reports.
- **An offline admin was told "App admins only"** on the admin
  delete-account screen, because a failed check counted as "not an admin"
  (slice 10).
- **CI failed at `npm ci` twice** because npm 11.6 rewrote the lock file
  without `@emnapi`, the second time unnoticed for five weeks because the
  branch was never pushed. The laptop's npm is upgraded now.

---

## 5. Verification: what was actually tested

- **Security (slices 1-7):** each hole reproduced first, then closed:
  10 direct checks with the anon key for slice 1, the slice suites (52,
  50, 42, 26 and 61 database checks), and the full re-check at 521.
- **Crashes (slice 8):** a crash on Explore, on Home from a cold start,
  and in `AuthGate`, in both phone themes; with no key Sentry never
  starts; with a stand-in server, reports read in full.
- **Offline (slice 9):** an offline cold start; a message sent while the
  phone was offline appearing on reconnect; a send through a paused
  gateway giving up by 26 seconds with the text and reply restored; Send
  again delivering a voice note; sign-out refused offline, then removing
  the token row and one of two sessions, with the token registered again
  on the next sign-in.
- **Phase 9's screens (slice 10):** each of the six opened with the
  gateway stopped, before and after: endless placeholders or a spinner
  (and, for an admin, "App admins only") before; "Couldn't load this"
  with Try again after, and Try again loading each one. The
  delete-account Rooms preview failing in its own section with Delete
  disabled. A verification link sent to a wrong address, corrected with
  "Use a different email": the first link refused as invalid, the second
  joined the Room.

Every test's data was removed afterwards and the row counts compared with
the baseline.

### 5.1 Known limits, and what was not covered

- **Hosting.** Everything here ran against `supabase start`. Auth's own
  rate limits, the cleanup jobs' URLs and `PUBLIC_FUNCTIONS_URL` are
  hosted-project settings, listed in Phase 11.
- **Crash reports from testers' phones** need the Sentry account, the
  config plugin and source maps (APK Beta Phase). Until then a release
  build's reports would be minified.
- **Slow offline failures.** On a connection that hangs, a cold start
  with an expired session took 62 seconds to say "No connection" (Auth
  retries the refresh first); on a refused connection, verify-email took
  27, because the database client retries a failed GET three times.
  Honest at the end, not fast. Turning the retries off client-wide was
  considered and left: they also rescue a single dropped request.
- **A request can time out after the server acted on it**, so sending
  again could duplicate it.
- **The "No connection" strip reports the phone's internet,** not the
  backend; locally, with the phone's Wi-Fi off, it shows while the app
  works over USB.
- **Uncapped lists, on purpose for now:** open reports, suspensions and
  blocked accounts are plain scroll lists with no limit (the moderation
  log is capped at 100, resolved reports at 50). Fine at beta size.
- **Report evidence images are not cached to disk, on purpose:** caching
  would leave copies of removed, possibly objectionable content on the
  admin's phone.
- **A banner file stays fetchable** by someone who saved its path before
  being blocked (slice 5, left open).
- **By the documented limits, one account can still fill the file store
  in a day** (50 uploads × 25 MB, against about 1 GB). To revisit with the
  move to R2, where the ceiling is 10 GB.
- **iOS** has never run on a real device.

---

## 6. Concepts worth knowing before Phase 11

- **Closed by default beats fixing the instance.** Each hole in this
  phase was one example of a default that let it happen; close the
  default and the next example never opens.
- **Reproduce before fixing.** A control run is what proves the fix fixed
  something, and twice in this phase it showed the problem was different
  from the plan's guess.
- **Read what actually crosses the wire.** Sentry's reports and Expo's
  fetch errors both differed from what the documentation suggested.
- **An open connection outlives the network change you made.** The app
  reuses connections, so a test that changes the network mid-run can
  pass for the wrong reason (`running-locally.md`, gotcha 14).
- **Silence is a bug.** A spinner that never stops is worse than an
  error, because nobody can act on it.

---

## What's next

Phase 11 — the production backend and real email. A hosted Supabase
project, every migration and Edge Function deployed with its secrets,
Auth's rate limits and the cleanup jobs set there, a real email provider
sending from `chasien.com` (Resend recommended), password reset, and the
move to R2 before strangers can watch clips. Its exit condition:
someone not on this network signs up with a real email address and logs
in.
