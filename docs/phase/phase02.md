# Phase 2 — Auth

> Study-book style: what exists, why each call was made, how the code
> works, and — because three genuinely instructive ones showed up — the
> bugs found while verifying it, including two that turned out to be bugs
> in the verification itself, not the system. That distinction mattered
> enough to be worth documenting precisely, not just fixing quietly.

**Goal:** real accounts, sessions that don't leak, matching the mock's
flow. Named by the user as the most security-sensitive phase so far —
the first one handling actual user credentials, not just data shape.
**Exit condition (from `docs/roadmap.md`):** can sign up, log out, log
back in, session survives app restart, and a stolen/expired token is
rejected server-side.
**Status:** done, verified against the live local stack — see [§5](#5-verification-what-was-actually-tested).

---

## 1. What this phase produced

```
mobile/
├── .env.local                      local Supabase URL + anon key (gitignored)
├── .env.example                    the same, blank — what a fresh clone needs to fill in
├── app.json                        web.output: static -> single (§4)
└── src/
    ├── lib/
    │   ├── supabase.ts              client + LargeSecureStore
    │   └── auth-context.tsx         session state, signUp/signIn/signOut
    └── app/
        ├── _layout.tsx              AuthProvider + route gate
        ├── index.tsx                minimal authenticated placeholder
        ├── login.tsx                real screen, wired
        └── signup.tsx                real screen, wired

supabase/config.toml                 enable_confirmations: false -> true
```

## 2. Decisions, and the reasoning behind each

Compressed versions in `docs/decision-log.md` (two 2026-08-13 entries).
Fuller reasoning here.

### 2.1 Session storage: `LargeSecureStore`, not `AsyncStorage`

The roadmap's own Phase 2 line item says "secure storage, not
AsyncStorage in plaintext" — but the naive fix (swap in
`expo-secure-store` directly) has a real limit: SecureStore caps
individual values around 2048 bytes, and a full Supabase session (access
token + refresh token + user object, serialized as one JSON blob) can
exceed that. Plain `AsyncStorage` has no size cap but stores plaintext.

Rather than improvise a fix, this reproduces Supabase's own documented
pattern for Expo apps verbatim (cited in a comment in the source,
[supabase.com/docs](https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native?auth-store=secure-store)):
a fresh AES-256 key is generated on every write and stored in
`expo-secure-store` (small — a raw key fits easily); the session itself
is encrypted with that key, and the ciphertext — meaningless without the
Keychain/Keystore-held key — goes into `AsyncStorage`, which no longer
has anything sensitive to leak even read directly off a device. Writing
security-critical code from a vendor's own reviewed example, rather than
reconstructing the same idea from memory, is a deliberate choice here —
crypto code is exactly the category where "I'm pretty sure this is right"
isn't good enough.

### 2.2 Email confirmation: on

`supabase/config.toml` shipped with `enable_confirmations = false` (the
CLI's default for fast local iteration). Flipped to `true`: a real
account system that lets you sign up with an email you don't control is
a real gap, not just missing polish, and the "involves user data" framing
for this phase specifically supports paying the extra friction. Locally,
confirmation links land in Mailpit (`http://127.0.0.1:54324`) instead of
a real inbox — reachable without any SMTP setup, which is what made
actually testing this flow (§5) possible without a real mail server.

### 2.3 What's deliberately not built yet

The mock's `Login.jsx` shows Apple/Google buttons and a "Forgot
password?" link; `SignUp.jsx` shows a "2 of 3" step indicator implying a
3-step wizard. None of this exists in the real screens:

- **OAuth buttons** — wiring these up needs a registered provider app on
  each platform (real setup, and for Apple, real cost — see
  `docs/store-compliance.md`). Out of scope for a zero-budget phase whose
  job is proving email/password auth is correct.
- **Password reset** — needs a deep-link-handling screen (the reset
  email links back into the app) that's meaningful extra RN plumbing,
  and isn't in the roadmap's Phase 2 checklist.
- **The 3-step wizard** — the mock only actually shows step "2 of 3";
  there's nothing to port for the other two steps. A single screen
  collecting the same fields (email, handle, display name, password,
  agree-to-guidelines) covers what the mock actually specifies.

The reasoning for cutting these, not just the fact of cutting them,
matters: a button that does nothing when tapped is a worse user
experience than not showing the button at all — "no half-finished
implementations," not a corner cut for speed.

## 3. Code walkthrough

### 3.1 `lib/supabase.ts` — the client

```ts
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

`autoRefreshToken: true` means supabase-js silently exchanges the
refresh token for a new access token before the current one expires —
without this, a user would get logged out every `jwt_expiry` seconds
(3600s locally) instead of staying signed in. `detectSessionInUrl: false`
disables a feature for parsing a session out of the URL on page load —
relevant for OAuth-redirect and magic-link flows in a browser context,
not applicable here since neither is wired up yet (§2.3); explicit rather
than left to a default that might silently matter later.

The env vars (`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`)
use Expo's `EXPO_PUBLIC_` prefix convention — anything with that prefix
gets inlined into the client bundle at build time, which is correct here
specifically because the anon key is *meant* to be public (it identifies
the project, not a secret credential; everything it can touch is gated by
RLS, not by the key being hidden).

### 3.2 `lib/auth-context.tsx` — where session state actually lives

```tsx
useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    setSession(data.session);
    setLoading(false);
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
    setSession(newSession);
  });

  return () => subscription.unsubscribe();
}, []);
```

Two separate things happening here, not one: `getSession()` reads
whatever's currently in `LargeSecureStore` once, on mount — this is what
makes "session survives app restart" true, since it's reading back the
encrypted blob from the *previous* run. `onAuthStateChange` is a live
subscription that fires on every subsequent sign-in, sign-out, and
*silent token refresh* — meaning `session` in React state always reflects
reality, not just the state as of the last explicit `signIn()`/`signOut()`
call. Screens read `session` through `useAuth()`; nothing else in the app
needs to know how or when it changes.

### 3.3 `app/_layout.tsx` — the route gate

```tsx
useEffect(() => {
  if (loading) return;
  const onAuthRoute = AUTH_ROUTES.includes(pathname);
  if (!session && !onAuthRoute) {
    router.replace('/login');
  } else if (session && onAuthRoute) {
    router.replace('/');
  }
}, [session, loading, pathname]);
```

The entire route-protection story for this phase, deliberately minimal:
no session and not already on `/login` or `/signup` → bounce to
`/login`; a session but sitting on an auth screen → bounce to `/`. This
is not meant to be the app's real navigation structure — that's Phase
3's job, mirroring `app_reference`'s actual route tree. It exists purely
to prove the session loop works end to end without building screens
that get thrown away next phase.

### 3.4 `app/signup.tsx` — client-side validation mirrors the DB constraint

```ts
const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;
```

This is the same pattern as `profiles`' `handle_format` CHECK constraint
(Phase 1). Duplicating it here isn't redundant — without it, a bad handle
would fail deep inside the signup call as a raw Postgres constraint
violation, surfaced through GoTrue's response in a form that's not
meant for end users to read. Catching it client-side means the user sees
"Lowercase letters, numbers, underscores only" before a network request
even fires. Validation still happens server-side regardless (the DB
constraint doesn't go away) — this is a UX improvement layered on top of
real enforcement, not a replacement for it.

## 4. A real bug: `expo export --platform web` broke on the new auth code

```
ReferenceError: window is not defined
    at ... f.auth.storage.getItem ...
```

`mobile/app.json` had `web.output: "static"` — Expo Router's default,
which pre-renders every route to HTML *using Node.js* at build time, so
the exported site can be served without a running JS server. Node has no
`window`/DOM. `LargeSecureStore.getItem()` calls `AsyncStorage.getItem()`,
whose web implementation is backed by `localStorage` — which doesn't
exist outside a browser. The static pre-render pass tried to read the
session (to decide what to render) before any browser existed to read it
from.

Fixed by switching to `web.output: "single"` — a plain SPA: one HTML
shell, everything rendered client-side, no Node-side pre-render pass at
all. This is the right mode for Chasien generally, not just a workaround
for this bug: an app that's entirely behind a login gate has nothing
meaningful to statically pre-render for search engines in the first
place, which is the whole point of `"static"` mode.

## 5. Verification: what was actually tested

Two layers, both run for real, not assumed.

### 5.1 The encryption itself — standalone, without the RN runtime

A Node script exercising the exact same `aes-js` calls as
`LargeSecureStore`, isolating the part actually worth verifying (the AES
logic — SecureStore/AsyncStorage themselves are just key-value gets and
sets, not where a mistake would hide):

| Check | Result |
|---|---|
| encrypt → decrypt recovers the original session JSON exactly | ✅ |
| the ciphertext does not contain the plaintext access token | ✅ |
| two encryptions of the same value use different keys (fresh key per write) | ✅ |
| decrypting with the wrong key does not recover the plaintext | ✅ |
| a tampered ciphertext does not decrypt back to the original | ✅ |

### 5.2 Server-side behavior — against the live local Supabase stack

Using `fetch` directly against the local Auth (GoTrue) and PostgREST
APIs — the same HTTP surface the real app talks to, not a mock of it.

| Check | Result |
|---|---|
| signup returns 200 but no session (confirmation required) | ✅ |
| login before confirming is rejected | ✅ `400`, "Email not confirmed" |
| the confirmation email actually arrives (fetched from Mailpit's API) | ✅ |
| following the confirmation link succeeds | ✅ |
| login after confirming succeeds, returns access + refresh tokens | ✅ |
| the `handle_new_user()` trigger created a matching profile row | ✅ |
| the refresh token issues a new access token | ✅ |
| a token with a tampered *payload* is rejected | ✅ `401` |
| a token with a tampered *signature* is rejected | ✅ `401` |
| a malformed (non-JWT) token is rejected | ✅ `401` |
| logout succeeds | ✅ `204` |
| the refresh token is rejected after logout (revoked server-side) | ✅ |
| the still-live access token continues to authenticate after logout | ✅ *(expected — see below)* |

That last row is worth stating precisely rather than leaving implicit:
Supabase's default sign-out revokes the *refresh token*, not the
short-lived access token already issued — which remains valid, as any
signed JWT does, until it naturally expires (`jwt_expiry`, 3600s
locally). "Rejected server-side" in the exit condition refers to a
stolen or tampered token failing verification, which is checked directly
above — not to an instant, retroactive revocation of every access token
ever issued the moment someone logs out elsewhere, which no JWT-based
system does by default.

### 5.3 Two false failures, and why they're worth naming precisely

The first run of the server-side battery reported 5 failures, not 0.
Investigating each rather than assuming the system was broken:

- **Not restarting Supabase after editing `config.toml`.** Config
  changes don't apply to an already-running stack; `enable_confirmations`
  was still `false` in the live containers. Three of the five failures
  (signup returning a session, pre-confirmation login succeeding, no
  confirmation email existing) all traced back to this one cause. Fixed
  by `supabase stop && supabase start`, not by touching the app.
- **A wrong assertion about profile visibility.** The verification
  script asserted a fresh signup's profile query returned exactly one
  row; it returned eight. `profiles` is readable by *any* authenticated
  user by design (Phase 1) — Discover, Search, and rendering "who posted
  this" all need to resolve arbitrary profiles, not just your own. The
  trigger had worked correctly; the test asked the wrong question. Fixed
  by filtering the query to the handle under test.
- **A flawed tampering method.** The first "tampered token" test flipped
  the *last* character of a JWT signature's base64url encoding and got a
  `200` back — briefly looking like signature verification wasn't being
  enforced at all, which would be a severe, well-known Supabase
  vulnerability and therefore an implausible explanation on its own. The
  actual cause: depending on the encoded length modulo 3, the final
  character of a base64url segment can carry unused padding bits, so
  flipping it doesn't always change the decoded bytes. A mid-segment flip
  has no such ambiguity and was correctly rejected. The lesson generalizes
  beyond this one test: **an alarming result needs a more alarming
  explanation to actually be believed** — "the framework has an
  unnoticed critical vulnerability" should lose to "my test has a bug" by
  default, and get investigated accordingly, not written up as the
  scarier conclusion on first read.

## 6. Concepts worth knowing before Phase 3

- **Config changes need a restart.** `supabase/config.toml` (and by
  extension anything under `[auth]`) only takes effect for a
  *newly-started* local stack — editing the file alone changes nothing
  already running.
- **Base64url padding bits.** The last character of a base64-encoded
  segment can encode fewer than 6 meaningful bits when the input length
  isn't a multiple of 3 bytes — worth remembering any time a test
  "tampers" with encoded data by mutating a single trailing character.
- **Access-token revocation vs refresh-token revocation.** Signing out
  of a JWT-based system typically revokes the *refresh token* (stopping
  future renewal) rather than instantly invalidating already-issued
  access tokens, which stay valid until their own expiry. This is a
  deliberate, common tradeoff (checking a revocation list on every
  request defeats the point of a stateless JWT), not an oversight — but
  it means "logged out" and "this specific token stops working" are not
  the same instant.
- **Static pre-rendering assumes a DOM exists.** Any storage/browser API
  used in code that might run during Expo Router's static web export
  needs to tolerate running in Node.js with no `window` — or, as here,
  the app just shouldn't be statically pre-rendered in the first place.

## What's next

**Phase 3 — App shell & navigation.** Every screen from
`app_reference` gets a real (data-empty) route, using Expo Router's
file-based structure (`/c/:communityId` → `app/c/[communityId].tsx`,
etc. — see `docs/phase/phase00.md` §2.1), plus the shared components
(Avatar, Icon, TabBar) ported from the mock and real font loading
(`@expo-google-fonts/caprasimo` / `@expo-google-fonts/figtree`) wired up
for the first time. Today's single placeholder screen and minimal auth
gate get replaced with the real thing.
