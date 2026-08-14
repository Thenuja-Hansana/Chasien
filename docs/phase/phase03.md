# Phase 3 — App Shell & Navigation

> Study-book style: what exists, why each call was made, how the code
> works, and — because live verification turned up three genuinely
> instructive ones — the bugs found while actually running the app,
> not just typechecking it. Two of the three were caused by this
> phase's own fixes, not pre-existing code — worth reading precisely
> for that reason.

**Goal:** every screen from `app_reference` exists as a real
(data-empty) RN screen.
**Exit condition (from `docs/roadmap.md`):** navigate the entire app
end to end on a real device/simulator with a real (empty) account — no
dead-end screens.
**Status:** done — verified end to end in a browser (three rounds) and
on a real Android emulator with a real, email-confirmed account; not
yet run on iOS or a physical device, since neither was available in
this environment. See [§5](#5-verification-what-was-actually-tested).

---

## 1. What this phase produced

```
mobile/src/
├── app/
│   ├── _layout.tsx                    + useFonts()/SplashScreen coordination
│   ├── index.tsx                      rewritten: Room-less Home empty state (was Phase 2's placeholder)
│   ├── login.tsx, signup.tsx          unchanged from Phase 2
│   ├── discover.tsx
│   ├── search.tsx
│   ├── notifications.tsx
│   ├── create-community.tsx
│   ├── chats/
│   │   ├── index.tsx
│   │   └── [chatId].tsx
│   ├── u/
│   │   └── [userId].tsx               Profile — also where real sign-out now lives
│   └── c/[communityId]/
│       ├── index.tsx                  Room feed
│       ├── create-post.tsx
│       ├── story.tsx
│       ├── settings.tsx
│       └── post/[postId].tsx
├── components/
│   ├── Avatar.tsx                     expo-linear-gradient
│   ├── Icon.tsx                       react-native-svg
│   └── TabBar.tsx
├── constants/theme.ts                 Fonts simplified (§4.3)
├── global.css                         deleted (§4.3)
└── lib/supabase.ts                    LargeSecureStore: web branch + fix (§4.1, §4.2)
```

13 routes total, matching every path in `app_reference/src/App.jsx`
one-for-one. New dependencies: `react-native-svg`,
`expo-linear-gradient`, `@expo-google-fonts/caprasimo`,
`@expo-google-fonts/figtree`.

## 2. Decisions, and the reasoning behind each

Compressed versions in `docs/decision-log.md` (four 2026-08-13/14
entries, newest on top). Fuller reasoning here.

### 2.1 Scope: shells, not a full mock port

Before writing any screen, the phase's scope was narrowed deliberately:
navigation, chrome (headers, `TabBar`), and empty states are real; Room
membership, posts, chat messages, and every mutation that would write
one (join, create, post, send) stay deferred to Phases 4-6, matching
those phases' own stated goals in the roadmap. Concretely this meant
*not* porting `app_reference`'s local-state-only interactive widgets
that have nothing real behind them yet — filter chips, theme-color
pickers, poll cards, the "who can join" radio list — since building
fully-interactive UI with no backing data is exactly the "half-finished
implementation" the project's own standards rule out. Where a mock
screen's primary action needs a mutation that doesn't exist yet (Create
Room's submit button, New Post's Post button), the button is visibly
disabled with a one-line note on which phase builds it for real, rather
than silently doing nothing on tap.

### 2.2 `TabBar` stayed a plain component, not an Expo Router `Tabs` layout

Expo Router's `Tabs` (and the headless `expo-router/ui` primitives)
assume a fixed set of routes. Chasien's tab bar doesn't have one — the
mock's own `TabBar.jsx` computes each tab's destination from
`(communityId, userId)` props passed in per-screen (Home tab →
whichever Room you're currently in; You tab → your own profile), and
renders itself individually inside seven different top-level screens,
not as a wrapping layout. Fighting Expo Router's tab primitive to model
that would have been more code for a worse match to the original
design. `TabBar` was ported as exactly what it already was: a shared
component each screen renders at its own bottom edge, using `Link`
with `asChild` (needed because `Link` wraps plain children in `Text`,
which can't hold the icon+label+dot column layout each tab needs) and
object-form `href`s for the dynamic routes, since `app.json`'s
`typedRoutes: true` requires that shape for anything with params.

### 2.3 Root `"/"` has no default Room

The mock hardcodes `grit-club` as `:communityId`'s default everywhere
it's used standalone. A real account starts in zero Rooms — there's no
equivalent default to fall back to, and inventing one (e.g. auto-adding
every new signup to some seed Room) would be real, undocumented product
behavior smuggled into a phase whose job is navigation, not Room
semantics. Root `"/"` is instead its own empty state ("No Rooms yet" +
a link to Discover); `TabBar`'s Home tab already handles the
`communityId`-present-vs-absent split (§2.2 above), so this isn't a
special case, just the `communityId: undefined` path through logic
that already existed.

### 2.4 Sign-out moved to Profile

`app_reference` has no equivalent of a logout button anywhere — it's a
pure UI mock with no real auth to log out of. Phase 2 had it living
temporarily on the root placeholder screen, which Phase 3 replaces.
Profile (`/u/:userId`) is the natural real home for it once real
screens exist, so it moved there rather than getting dropped — Phase
3's exit condition is "no dead-end screens," and losing the one
already-working piece of account control while adding twelve new
screens would be a regression hiding inside a feature phase.

## 3. Code walkthrough

### 3.1 `app/_layout.tsx` — fonts, coordinated with the splash screen

```tsx
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Caprasimo_400Regular,
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;
  // ...
}
```

Standard Expo pattern, reproduced from the SDK 57 docs rather than
improvised (per `AGENTS.md`'s standing instruction to check current
docs before writing Expo code — the API here has changed across SDK
versions): hold the splash screen open, load fonts, render nothing
until either loading finishes or fails, then hide the splash. Without
this, screens would render once in a fallback system font and then
visibly snap to Caprasimo/Figtree a moment later.

### 3.2 `components/TabBar.tsx` — computing hrefs per tab

```tsx
{ label: 'Home', icon: 'homeTab', href: communityId
    ? { pathname: '/c/[communityId]', params: { communityId } }
    : '/' },
{ label: 'Post', icon: 'postTab', href: communityId
    ? { pathname: '/c/[communityId]/create-post', params: { communityId } }
    : undefined },
```

`Post` has no sensible destination without a current Room — rather
than link it somewhere wrong, a tab with `href: undefined` renders as a
plain (non-`Link`) `View`, visually identical to an inactive tab but
inert. `Home` degrades to `"/"` instead, since that's a real, correct
destination even Room-less.

### 3.3 `app/u/[userId].tsx` — the one screen with real data

```tsx
const isOwnProfile = userId === session.user.id;
// ...
<Avatar gradient={session.user.id} letter={email.charAt(0).toUpperCase() || '?'} size={72} ring />
```

Every other screen in this phase is empty-state-only, but Profile
renders one real thing: the signed-in account's own identity
(`session.user.email`), since that data already exists from Phase 2
and costs nothing extra to show truthfully instead of stubbing. `Avatar`
falls back to its default gradient for any `gradient` key it doesn't
recognize (`app_reference`'s original component behavior, kept as-is —
see `GRADIENTS[gradient] ?? GRADIENTS.mara` in `Avatar.tsx`), which is
what makes passing a raw user UUID as the gradient key safe: it always
resolves to *some* gradient, never `undefined`.

## 4. Three real bugs, found by actually running the app

All three surfaced only by driving the app in a live browser session
against the local Supabase stack — `tsc --noEmit` and `expo lint` were
clean throughout, including right before each bug was found. That
distinction is the point of this section.

### 4.1 `LargeSecureStore` crashed outright on web

```
ExpoSecureStore.default.setValueWithKeyAsync is not a function
```

`expo-secure-store` has no web implementation at all — there's no
Keychain/Keystore equivalent in a browser for it to wrap. Every call
into it from `LargeSecureStore._encrypt`/`_decrypt` threw the instant
login was attempted with `expo start --web`, blocking every
authenticated screen this phase added, not just new ones.

Fixed with a `Platform.OS === 'web'` branch: the AES encryption key
goes to `localStorage` on web instead of `SecureStore`. Chasien ships
mobile-only (`docs/decision-log.md`, "Zero-budget stack finalized") so
this was never a production security boundary — but `web.output` is
deliberately kept buildable for local dev (Phase 2, §4 of that phase's
doc), and a dev target that can't log in isn't useful.

### 4.2 That fix collided with AsyncStorage's own storage key

Re-verifying immediately after §4.1's fix surfaced a second,
self-inflicted bug: `localStorage.setItem(key, encryptionKeyHex)`
followed two lines later by `AsyncStorage.setItem(key, encrypted)` —
`@react-native-async-storage/async-storage`'s web backend is a thin
wrapper directly over `localStorage`, using the *same* key with no
prefix of its own. The second write silently clobbered the first,
destroying the encryption key the instant it was used. Any later page
load then tried to decrypt the session using the leftover ciphertext
as if it were the key, throwing `invalid key size` from `aes-js` and
blanking the whole app behind Expo's uncaught-error overlay — worse
than §4.1's bug, since it now happened on nearly every reload instead
of only on web login specifically.

Fixed by giving the web-only key a distinct `localStorage` key
(`` `${key}-secure-store-key` ``) instead of reusing the session's own
key. Confirmed by the third verification round (§5.3): a hard reload
while logged in no longer crashes.

**Why this one matters beyond the fix itself:** it shipped past
typecheck and lint clean, both times. A same-tick key collision like
this is invisible to static analysis by construction — it's only
observable by actually running the code and reloading the page, which
is exactly why this phase's verification loop re-ran after every fix
instead of trusting the first green typecheck.

### 4.3 Fonts silently fell back to serif on web

`constants/theme.ts`'s `Fonts` export had a `Platform.select` splitting
web from native — web resolved `Fonts.heading` to `var(--font-heading)`,
a CSS custom property defined in `global.css` (written in Phase 0,
before any real font-loading existed) as `'Caprasimo', ui-serif,
Georgia, serif'`. But `useFonts()` (§3.1, added this phase) registers
the loaded webfont under the literal object key passed to it —
`'Caprasimo_400Regular'` — on every platform, web included.
`'Caprasimo'` was never a font that actually existed anywhere, on any
platform, so the CSS variable silently fell through to its own
`Georgia, serif` fallback every time, with no error to notice.

Fixed by deleting the indirection entirely: `Fonts` is now one plain
object using the real registered names on every platform, and
`global.css` (which had no other consumer) is gone. Simpler than the
thing it replaced, not just a fix for the mismatch — the CSS-var split
existed only because it predated real font loading, not because web
genuinely needed different values.

## 5. Verification: what was actually tested

### 5.1 Static checks

`tsc --noEmit` and `expo lint` clean after every change in this phase,
including after each of the three bugs in §4 — worth restating since
none of the three would have been caught by either.

### 5.2 Live browser verification (three rounds)

Each round drove the actual app with a browser automation tool against
the live local Supabase stack — real signup, real email confirmation
fetched from Mailpit's API, real login through the actual `/login`
screen, not shortcuts through the API.

| Round | Result |
|---|---|
| 1 | Signup + email confirmation worked. Login crashed — §4.1. |
| 2 | Login worked past §4.1's fix. Discovered §4.2 via a page reload. |
| 3 | Full flow clean: signup → confirm → login → every screen reachable from the UI → **hard reload while logged in** → all 6 dynamic routes direct-visited → logout → redirect verified. Zero console errors or warnings. |

Specific checks in the final (passing) round:

| Check | Result |
|---|---|
| Signup → Mailpit confirmation → login via real `/login` screen | ✅ |
| Fonts resolve to `Caprasimo_400Regular`/`Figtree_400Regular` (`document.fonts`, computed styles) — not a serif fallback | ✅ |
| Home → Discover → search submit lands on `/search?q=...` prefilled → Notifications → Chats → Profile (Log out visible) → Create Room, all via real UI clicks | ✅ |
| Hard reload while logged in — the specific regression check for §4.2 | ✅ |
| All 6 dynamic routes (`/c/test-room`, `/c/test-room/create-post`, `/c/test-room/settings`, `/c/test-room/story`, `/c/test-room/post/test-post`, `/chats/test-chat`) render real content directly via URL, no crash, no redirect to login | ✅ |
| Logout → redirect to `/login`; visiting `/` afterward redirects back to `/login` | ✅ |
| Console output throughout | 0 errors, 0 warnings |

### 5.3 Live device verification (Android emulator)

The App Store's public `Expo Go` build hadn't yet caught up to SDK 57
at verification time (a known, temporary lag after any new SDK ships —
Apple's review isn't instant even though Expo's own site already lists
the new SDK as current), and Google Play's build hit the same lag.
Rather than wait or spend on Apple's paid Developer Program just to get
an early TestFlight build (explicitly deferred to Phase 11 — see
`docs/decision-log.md`), verification moved to a local Android
emulator (Pixel 9 Pro AVD, already provisioned in this environment):
`expo start --android` downloads and sideloads the exact SDK-57-matching
Expo Go build directly, bypassing both app stores entirely. Confirmed
via screenshot: `mobile`, `SDK version: 57.0.0`, real signup with a
real inbox address, confirmation fetched and applied via curl against
Mailpit + the local Auth API directly, login succeeded, Login screen
rendered with the correct Caprasimo/Figtree fonts and theme colors —
this on a genuine native client, not a browser.

**Not yet done:** iOS (no Mac/simulator available in this environment)
and a physical device on either platform. The roadmap's exit condition
is marked met with that caveat stated explicitly, not silently assumed.

## 6. Concepts worth knowing before Phase 4

- **A same-tick storage key collision is invisible to typecheck and
  lint.** §4.2 is the concrete example — the only way to have caught it
  before shipping was running the code and reloading the page.
- **`Link`'s default child gets wrapped in `Text`.** Passing a `View`
  with block/flex layout as a `Link`'s child silently breaks unless
  `asChild` is used, forwarding props to a `Pressable` (or similar)
  child instead of wrapping it.
- **Typed routes need object-form `href`s for dynamic segments.** With
  `experiments.typedRoutes: true` (already set in `app.json`), any
  route with a `[param]` segment needs `{ pathname, params }`, not a
  template-string path — the latter doesn't typecheck against the
  generated route types.
- **A brand-new Expo SDK lags behind on both app stores briefly.**
  Expo's own site can say a new SDK is "latest" before either app
  store's `Expo Go` binary has actually finished review. A local
  emulator with `expo start --android`/`--ios` sidesteps this
  entirely, since it fetches the matching Expo Go build directly.
- **GUI windows launched via automation can land off-screen.** The
  Android emulator's window opened with negative Y-coordinates (above
  the visible display) in this environment — worth checking
  `GetWindowRect` (or equivalent) before assuming a "window won't
  open" report means the process itself failed.

## What's next

**Phase 4 — Rooms core.** Discover becomes real (browsing actual public
Rooms via Supabase queries, not an empty state); join flows (public,
request-to-join, invite-only); the Create Room flow this phase left
disabled becomes a real write; Community Settings gets real
owner/mod-gated controls; the Room feed (`/c/[communityId]`) starts
rendering real posts instead of "no posts yet." This is also where the
`Toggle` and theme-color-picker widgets `app_reference` has, and this
phase deliberately didn't port (§2.1), get built for real against
actual mutations instead of staying half-finished UI.
