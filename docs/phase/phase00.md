# Phase 0 — Foundation & Tooling

> Study-book style: this file explains not just *what* exists after Phase 0
> but *why* it exists and *how* the code works, in enough depth that
> someone new to the project (including future-you, six months from now)
> can read it once and understand the whole phase without needing to
> reconstruct the reasoning from git history.

**Goal:** an empty-but-real project skeleton, not another mockup.
**Exit condition (from `docs/roadmap.md`):** `expo start` runs an empty
app, `supabase start` runs locally, CI is green.
**Status:** done. Verified with real commands, not just "looks right" —
see [Verifying this phase](#verifying-this-phase-yourself) at the bottom.

---

## 1. What this phase actually produced

```
chasien/
├── mobile/                 React Native app (Expo + TypeScript + Expo Router)
│   ├── src/
│   │   ├── app/             Expo Router screens (file-based routes)
│   │   │   ├── _layout.tsx  Root layout — navigation theme lives here
│   │   │   └── index.tsx    The one real screen so far
│   │   ├── constants/
│   │   │   └── theme.ts     Chasien's design tokens, ported from the mock
│   │   ├── hooks/
│   │   │   └── use-theme.ts Single hook components use to reach the tokens
│   │   ├── types/
│   │   │   └── css.d.ts     Teaches TypeScript what a `.css` import is
│   │   └── global.css       CSS custom properties, web target only
│   ├── example/             Expo's default demo screens — reference only,
│   │                         not built, not linted, not typechecked
│   ├── eslint.config.js     Lint rules (ESLint "flat config")
│   ├── tsconfig.json        TypeScript compiler settings
│   └── package.json         Scripts + dependencies
│
├── supabase/                Local Supabase project (CLI-initialized)
│   ├── config.toml          Local dev stack configuration
│   └── .gitignore           Ignores local-only Supabase state
│
└── .github/workflows/
    └── mobile-ci.yml        Runs lint + typecheck on every push to mobile/
```

Nothing in here does anything product-specific yet — no Rooms, no feed, no
chat. That's deliberate: Phase 0's only job is to make sure the ground is
solid before Phase 1 starts building the data model on top of it.

---

## 2. Decisions made in this phase, and the reasoning

The compressed version of these lives in `docs/decision-log.md`
(2026-08-13, "Phase 0 scaffold"). Here's the fuller version.

### 2.1 Expo Router, not plain React Navigation

`create-expo-app`'s current default template ships **Expo Router** — a
routing system built *on top of* React Navigation, but where routes are
defined by the file structure inside `src/app/` instead of a hand-written
tree of `<Stack.Screen>` components. A file at `src/app/c/[communityId].tsx`
automatically becomes the route `/c/:communityId`.

This mattered here specifically because `app_reference/src/App.jsx` (the
web mock) already defines its navigation as URL-shaped routes:

```js
<Route path="/c/:communityId" element={<Home />} />
<Route path="/c/:communityId/post/:postId" element={<PostDetail />} />
<Route path="/chats/:chatId" element={<ChatView />} />
```

Expo Router's file-based convention maps onto this almost mechanically —
Phase 3 can largely transcribe the mock's route list into a folder
structure rather than redesigning navigation from scratch. That's the
whole reason it was worth adopting deliberately rather than stripping it
out in favor of the more manual React Navigation API.

### 2.2 One dark theme, not light/dark

The template's default `theme.ts` ships a `Colors.light` / `Colors.dark`
pair, because most apps should support both. Chasien's actual design
source — `app_reference/src/styles/tokens.css` — only ever defines **one**
palette:

```css
:root {
  --color-bg: #17130f;
  --color-surface: #221c17;
  --color-text: #f2e6d4;
  --color-accent: #e08c4e;
  --color-accent-2: #a3b585;
  ...
}
```

There's no `@media (prefers-color-scheme: light)` block, no alternate
palette anywhere in the mock. That's a real product decision the mock
already made (the "Organic" warm-dark aesthetic *is* Chasien's look, not a
default that gets swapped), so `theme.ts` reflects that: `Colors` is one
flat object, not `{ light, dark }`. Inventing a light palette that doesn't
exist in the source of truth would have been guessing at a decision that
wasn't ours to make.

Practical effect: `src/app/_layout.tsx` doesn't call `useColorScheme()` or
switch between `DarkTheme`/`DefaultTheme` based on the OS setting — it
always uses a Chasien-tinted `DarkTheme`. The two hook files the template
shipped for reading OS color scheme (`use-color-scheme.ts` and
`use-color-scheme.web.ts`) were deleted, because after this decision
nothing in the app has a reason to ask the OS what theme it's in.

### 2.3 Demo screens moved, not edited

`create-expo-app` scaffolds two example tabs ("Welcome" and "Explore") plus
supporting components (`ThemedText`, `ThemedView`, `Collapsible`,
`WebBadge`, `HintRow`, `AnimatedIcon`, the tab bar itself). These reference
the old `Colors.light/dark` and old `Spacing.one/two/three...` shape.

Once the tokens changed shape (§2.2, and see the `Spacing` object in
§3.3), those demo files would no longer compile. Two options: fix them to
use the new tokens, or remove them. They were moved wholesale to
`mobile/example/` instead, because:

- They're Expo's generic demo content, not Chasien UI — Phase 3 replaces
  every one of these screens with real ones (Discover, Room feed, Chat,
  ...) mirroring the mock.
- Fixing them to compile against tokens they'll never meaningfully use
  would be work thrown away the moment Phase 3 starts.
- Deleting them outright loses a few patterns that might be worth glancing
  at later (e.g. how `Collapsible` handles animated height). Moving them
  to `example/` keeps that option without them being mistaken for real
  app code.

`example/` is excluded from both `tsconfig.json` and `eslint.config.js`
(see §3.1 and §3.2), so it can never break CI, and it's git-ignored by the
template's own `.gitignore` (the Expo template anticipates exactly this
workflow — see `mobile/.gitignore`, the `example` line was already there
before we added anything).

---

## 3. Code walkthrough

### 3.1 `tsconfig.json` — how TypeScript is configured

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./src/*"],
      "@/assets/*": ["./assets/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  "exclude": ["node_modules", "example"]
}
```

- `extends: "expo/tsconfig.base"` pulls in Expo's recommended base
  settings (JSX handling, module resolution tuned for Metro/React Native)
  so we're not reinventing those.
- `strict: true` turns on TypeScript's full strictness (no implicit `any`,
  null-checking, etc.) — catches real bugs at compile time instead of
  runtime, which matters more here than in a typical web app because a
  runtime crash in a mobile app is a much worse experience (no refresh
  button, sometimes a full app-store-visible crash report).
- `paths` sets up the `@/` import alias, so code says
  `import { Colors } from '@/constants/theme'` instead of counting `../../`
  segments. `@/*` maps to `./src/*`; `@/assets/*` maps to `./assets/*`
  specifically because assets live outside `src/` at the project root.
- `include` is a glob list of what TypeScript should look at.
  `.expo/types/**/*.ts` and `expo-env.d.ts` are Expo-generated type
  declarations (created automatically when you run the app) — without
  including them, TypeScript wouldn't know about Expo Router's typed
  routes.
- `exclude` removes `example/` (see §2.3) — this is what actually keeps
  the moved demo code from failing `npm run typecheck`.

### 3.2 `eslint.config.js` — how linting is configured

```js
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'example/*'],
  },
]);
```

This is ESLint's newer **"flat config"** format — a single exported array
of config objects, replacing the older `.eslintrc.json`/`.eslintrc.js`
format. `eslint-config-expo/flat` is Expo's own rule set (React, React
Native, React Hooks, accessibility rules tuned for this stack), and
`defineConfig` is a small helper that gives better editor autocomplete for
the config array. The `ignores` entry is what makes `npm run lint` skip
`example/` and any local web build output in `dist/`.

One real bug this rule set caught during Phase 0: the template's own
`use-color-scheme.web.ts` (before it was deleted, §2.2) called
`setHasHydrated(true)` synchronously inside a `useEffect` with no
dependencies changing — flagged by the `react-hooks/set-state-in-effect`
rule. That's a legitimate "hydration flag" pattern (detect that the
component has mounted on the client, used to avoid server/client render
mismatches), and the rule doesn't have a way to know that's intentional —
which is exactly the situation an `eslint-disable-next-line` comment
*with a reason* is for, rather than turning the rule off project-wide.
Moot now since that file's gone, but the pattern (targeted disable with a
one-line reason, not a blanket rule downgrade) is worth remembering for
future lint fights.

### 3.3 `src/constants/theme.ts` — the design tokens

This is the direct TypeScript translation of
`app_reference/src/styles/tokens.css`. Four exports:

**`Colors`** — nested objects instead of a flat list, deliberately
mirroring the CSS custom property naming:

```ts
export const Colors = {
  bg: '#17130f',
  surface: '#221c17',
  text: '#f2e6d4',
  divider: 'rgba(242, 230, 212, 0.13)',
  neutral: { 100: '#f9f4ed', /* ... */ 900: '#2e2b25' },
  accent: { DEFAULT: '#e08c4e', 100: '#fff2eb', /* ... */ 900: '#402310' },
  accent2: { DEFAULT: '#a3b585', 100: '#f0fae1', /* ... */ 900: '#272e1b' },
} as const;
```

CSS had `--color-accent` and `--color-accent-100` through `-900` as
separate flat variables; here they become `Colors.accent.DEFAULT` and
`Colors.accent[100]`...`Colors.accent[900]` — same information, grouped so
autocomplete shows you all nine shades of one color together instead of
scattered alphabetically among fifty unrelated variables. `as const` tells
TypeScript to treat every value as its exact literal (the type of
`Colors.bg` is the string type `"#17130f"`, not the general `string`) —
that's what makes typos in color names caught at compile time rather than
becoming an invisible wrong color at runtime.

**`Fonts`** — uses React Native's `Platform.select()`, which returns a
different value depending on what platform the code is running on:

```ts
export const Fonts = Platform.select({
  web: { heading: 'var(--font-heading)', body: 'var(--font-body)' },
  default: { heading: 'Caprasimo_400Regular', body: 'Figtree_400Regular', ... },
});
```

On web, React Native Web renders to actual CSS, so a CSS custom property
reference works directly (defined in `global.css`, §3.5). On native
(iOS/Android), fonts have to be loaded as actual font files and referenced
by name — `Caprasimo_400Regular` is the exact name the
`@expo-google-fonts/caprasimo` package will export once installed. That
package isn't installed yet; these are the names Phase 3 needs to load.
Until then, native rendering silently falls back to the system font — not
broken, just not final.

**`Spacing`** — kept the *same numeric keys* as the CSS variables
(`--space-1` through `--space-8`, skipping 5 and 7 because the source
skips them too):

```ts
export const Spacing = { 1: 4.4, 2: 8.8, 3: 13.2, 4: 17.6, 6: 26.4, 8: 35.2 } as const;
```

The template's original version renamed these to words (`half`, `one`,
`two`...) — that was rejected here specifically to preserve **1:1
traceability**: if you're looking at the mock and see `padding:
var(--space-3)`, you can go straight to `Spacing[3]` in code with no
translation step or lookup table in your head.

**`Radius`** and **`Shadows`** — `Radius` adds a `pill: 999` on top of the
CSS source's `sm`/`md`/`lg`, because the mock's component CSS
(`app_reference/src/styles/tokens.css` lines 241-244) rounds buttons, tags,
and inputs all the way to a pill shape as a deliberate rule, common enough
to deserve its own named token. `Shadows` is where the translation is
genuinely lossy: CSS `box-shadow` doesn't exist in React Native. iOS reads
four separate style properties (`shadowColor`, `shadowOffset`,
`shadowOpacity`, `shadowRadius`); Android ignores all of those and instead
uses a single `elevation` number that maps to Android's own shadow
rendering. The values here are a reasonable first approximation from the
CSS blur/spread/opacity numbers, not something tuned by eye on a real
device yet — expect to adjust `elevation` once real screens exist.

### 3.4 `src/hooks/use-theme.ts`

```ts
import { Colors } from '@/constants/theme';

export function useTheme() {
  return Colors;
}
```

This looks trivial — because it currently is. The point of having it is
consistency: every component reaches colors through `useTheme()` rather
than importing `Colors` directly. Right now that's a style preference with
no functional difference. It stops being trivial the moment Chasien ever
needs per-user or per-Room theming (remember `CommunitySettings.jsx` in
the mock has a "Theme colour" picker per Room) — at that point `useTheme()`
becomes the one place that decides "whose theme," and every component that
already calls it needs zero changes. Writing the hook now, even as a
pass-through, avoids an app-wide find-and-replace later.

### 3.5 `src/global.css`

```css
:root {
  --font-heading: 'Caprasimo', ui-serif, Georgia, serif;
  --font-body: 'Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
```

Only relevant on the web target (React Native Web renders actual HTML/CSS,
native iOS/Android don't process CSS at all). Defines the two CSS custom
properties that `Fonts.web` in `theme.ts` references, each with a generic
fallback chain in case the real font hasn't loaded yet — `ui-serif`/
`Georgia` approximate Caprasimo's display-serif feel, `system-ui` etc.
approximate Figtree's humanist-sans feel.

### 3.6 `src/types/css.d.ts`

```ts
declare module '*.css';

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
```

TypeScript, by default, only understands `.ts`/`.tsx` imports. When code
writes `import '@/global.css'` or `import classes from './x.module.css'`,
the bundler (Metro, via `react-native-web`) knows how to handle that at
build time, but the *type checker* has no idea what a `.css` file's export
shape is — without this file, `npm run typecheck` fails with "cannot find
module" for every CSS import. This is called an **ambient module
declaration**: it doesn't import real code, it just tells TypeScript "any
module whose path ends in `.css`, trust me, treat it as this shape." The
plain `.css` case declares no exports (side-effect import only — you
import it for what it registers, not for a value). The `.module.css` case
declares a default export of a string-keyed object, matching how CSS
Modules actually work (each class name becomes a generated, collision-safe
string).

### 3.7 `src/app/_layout.tsx` — the root layout

```tsx
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { Colors } from '@/constants/theme';

const ChasienNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.bg,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.divider,
    primary: Colors.accent.DEFAULT,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={ChasienNavigationTheme}>
      <Stack />
    </ThemeProvider>
  );
}
```

In an Expo Router app, `_layout.tsx` files define shared UI/behavior that
wraps every route inside their folder — this one is at the root, so it
wraps the entire app. `<Stack />` with no children means "render whatever
screen matches the current route as a stack (push/pop) navigator" — Expo
Router fills in the actual screens from the files in `src/app/`
automatically; nothing needs to be manually registered.

`ThemeProvider` (from `expo-router`, which re-exports React Navigation's)
controls the colors React Navigation itself uses for its own chrome —
header backgrounds, tab bar backgrounds, the default text color inside
navigation-owned UI. `DarkTheme` is React Navigation's built-in dark
palette; spreading it (`...DarkTheme`) and then overriding just the
`colors` object's specific keys means we inherit React Navigation's other
theme settings (like whether status bar text is light or dark) while
replacing every color with Chasien's own token instead of RN's generic
dark-gray defaults. This is the concrete payoff of §2.2's decision — the
whole app's navigation chrome is Organic-palette from the very first
screen, not "generic dark mode that happens to have Chasien screens inside
it."

### 3.8 `src/app/index.tsx` — the one real screen

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '@/constants/theme';

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Chasien</Text>
      <Text style={styles.body}>Phase 0 skeleton — see docs/roadmap.md</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.bg },
  heading: { fontFamily: Fonts?.heading, fontSize: 32, color: Colors.text },
  body: { fontFamily: Fonts?.body, fontSize: 14, color: Colors.neutral[400] },
});
```

Because Expo Router is file-based, this file *is* the route `/` — no
registration needed elsewhere. It exists purely to prove the tokens
actually render correctly end to end (right background, right text color,
right font family reference) rather than just typechecking in isolation.
`StyleSheet.create()` is React Native's standard way to define styles — it
doesn't do much at this scale, but at real app scale it lets RN optimize
by referencing styles by an internal ID instead of re-sending style
objects across the JS-to-native bridge on every render.

### 3.9 `.github/workflows/mobile-ci.yml`

```yaml
name: mobile-ci

on:
  push:
    paths: ['mobile/**', '.github/workflows/mobile-ci.yml']
  pull_request:
    paths: ['mobile/**', '.github/workflows/mobile-ci.yml']

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: mobile
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: mobile/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
```

- `paths:` under both `push` and `pull_request` means this workflow only
  *runs at all* when something under `mobile/` (or the workflow file
  itself) changed — pushing a docs-only change doesn't burn CI minutes or
  show an irrelevant check.
- `defaults.run.working-directory: mobile` means every `run:` step below
  executes as if you'd `cd mobile` first, so commands don't need to repeat
  the path.
- `actions/setup-node@v4` with `cache: npm` and `cache-dependency-path`
  caches `node_modules` based on `package-lock.json`'s hash — as long as
  dependencies haven't changed, subsequent CI runs skip re-downloading
  everything, which matters for GitHub Actions' free-tier minutes.
- `npm ci` (as opposed to `npm install`) installs *exactly* what's in
  `package-lock.json`, failing instead of silently updating anything if
  the lockfile and `package.json` disagree — the right choice for CI,
  where reproducibility matters more than convenience.

### 3.10 `supabase/config.toml`

Created by `supabase init`, this is the configuration for the **local**
Supabase development stack (what `supabase start` spins up via Docker —
a local Postgres, a local Auth server, local Storage, etc., so development
doesn't touch the real hosted project). Two numbers worth remembering:
the local API runs on port `54321`, the local Postgres database on port
`54322`. `project_id = "chasien"` just namespaces Docker containers/volumes
so this doesn't collide with some other Supabase project on the same
machine. Nothing in this file talks to the internet or costs money — it's
purely local dev infrastructure. Phase 1 is where this actually starts
being used (migrations go in `supabase/migrations/`, which doesn't exist
yet — the CLI creates it the first time you run `supabase migration new`).

---

## 4. Concepts worth knowing before Phase 1

A few things referenced above that are worth understanding properly,
since they'll come up again:

- **File-based routing (Expo Router):** the folder structure under
  `src/app/` *is* the route tree. `index.tsx` → `/`, `c/[id].tsx` →
  `/c/:id`, `_layout.tsx` → shared wrapper for everything in that folder.
  No central "router config" file to keep in sync with reality.
- **Ambient type declarations (`declare module`):** a way to tell
  TypeScript about the shape of something it can't see the real source of
  — either because it's not TypeScript (`.css`) or because it's generated
  at build time. You'll likely need more of these later (e.g. for `.svg`
  imports, if Chasien uses them).
- **Nested `.gitignore` files:** git honors a `.gitignore` in *any*
  directory, scoped to that directory and below. That's why `mobile/`
  having its own `.gitignore` (ignoring `node_modules/`, `.expo/`, etc.)
  works correctly even though the root `.gitignore` doesn't mention them —
  no need to duplicate ignore rules at the root for things scoped to a
  subproject.
- **Why local Supabase runs in Docker:** `supabase start` isn't a single
  process — it orchestrates several (Postgres, GoTrue for auth, Storage
  API, Realtime, ...) as Docker containers, so the local environment
  matches what's actually deployed. This means Docker Desktop (or
  equivalent) needs to be installed and running before Phase 1's
  `supabase start` will work — not yet verified in this environment, worth
  checking before Phase 1 begins.

---

## 5. Verifying this phase yourself

From `mobile/`:

```sh
npm run lint        # should exit clean
npm run typecheck   # should exit clean
npx expo export --platform web   # should bundle and produce dist/ with no errors
```

From the repo root:

```sh
npx supabase --version   # confirms the CLI is reachable
```

All four were run during this phase and passed — this isn't a claim to
take on faith, it's reproducible.

---

## What's next

**Phase 1 — Core data model & backend.** Schema for `users`, `rooms`,
`room_memberships`, `posts`, `comments`, `polls`, `stories`, `chats`,
`messages`, `notifications`, `reports`, `blocks`, and
`moderation_actions`, plus Row Level Security policies and the Edge
Functions for anything RLS can't safely express. See `docs/roadmap.md`
Phase 1 for the checklist, and expect `docs/phase/phase01.md` to explain
it the same way this file explained Phase 0.
