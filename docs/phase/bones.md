# Bones Phase — UI/UX polish & mobile performance

> Study-book style: what exists, why each call was made, how the code
> works, and what went wrong along the way. This phase was inserted
> between Phases 8 and 9 by name rather than number, so no existing Phase
> 9–13 reference had to change. It began as a ten-item polish and
> performance checklist. It became the longest stretch of the project
> (2 to 21 September):
> - a new design system
> - a rebuilt way of creating posts
> - a new model for how the feed behaves
> - two things that belonged to later phases, done early: locking down
>   which columns clients can write, and making the React Compiler
>   actually compile the app
>
> Almost every real bug here was invisible to typecheck and lint.
> They were found on the Galaxy A14, or by measuring.

**Goal:** the app should feel good and run smoothly on the real hardware
available, not just be feature-complete.
**Exit condition (from `docs/roadmap.md`):** the app feels smooth (no
dropped-frame scrolling on feed, chat and notifications, no layout
breakage) on the Galaxy A14 specifically, and every screen matches the
design language.
**Status:** closed 2026-09-21.
- **The checklist:** nine of its ten items are done. The tenth (images)
  is done except right-sized variants, which need Supabase's paid image
  transformations.
- **The New Post screen** was added to the checklist later. Its four
  stages were finished 2026-09-16.
- **The performance and compiler work** ran through 2026-09-20.
- **"Smooth" was a good-faith manual judgement** during the checklist
  itself; frame times were measured properly later. See
  [§5](#5-verification-what-was-actually-tested).

---

## 1. What this phase produced

Grouped by what it's for rather than by date.

**A design system** (2–11 September):
- **`constants/theme.ts`** replaced the mock's single dark "Organic"
  palette with a black/white/gray system in Light and Dark. Every screen
  reads colours, spacing and type through `useTheme()`, and re-renders
  when the mode changes.
- **Shared pieces:** a `Typography.label` token, filled tab icons,
  `Skeleton` loaders, one `EmptyState`, and haptics.
- **Room categories** (`rooms.category`, a fixed list).

**The ten-item checklist** (audited 2026-09-10, finished 2026-09-15):
- a UI consistency audit
- a small-screen check
- list virtualization
- image loading and caching
- loading, empty and error states
- animations and transitions
- cold start
- memory
- touch targets and accessibility
- (added later) the New Post screen

**Creating things** (15–17 September):

```
mobile/src/app/c/[communityId]/create-post.tsx   a tabbed shell: Post / Clip / Poll / Event
mobile/src/components/create/                     CreateTabSwitcher, MediaGridPicker, PhotoEditor,
                                                  ReviewDetails, LocationSheet, TagPeopleSheet, ...
supabase/migrations/
├── 20260915150000_events.sql                        an events table, 1:1 with posts
├── 20260915150100 / 160100_create_event_post_rpc*   create_event_post() (v2 adds end time and link)
├── 20260916130000_drop_create_event_post_v1_overload.sql
├── 20260916120000_poll_allow_multiple.sql / 120200_vote_poll_rpc.sql
├── 20260916160000_post_location.sql
└── 20260916170000 / 170100_post_tags.sql             tag people, written only by tag_people_in_post()
```

**How the feed behaves** (15–17 September):
- **A ⋯ menu on every post:** Hide (for you only, `hidden_posts`) and
  Delete (the author or the Room's owner, through `delete_post()`).
- **Tapping a feed post no longer opens a page.** The comment icon opens a
  Comments sheet, the like count opens a Likes sheet, and a clip opens a
  full-screen clips viewer.
- **Cursor paging** replaced offset paging.

**Performance** (15–20 September):
- tuned `FlatList`s
- images cached by storage path
- no live blur behind the tab bar on Android
- sheets that don't re-render the feed
- the whole app compiling under the React Compiler, enforced in CI by
  `npm run check:compiler`

**Security, done early** (Phase 10's column audit, 16 September):
- **Column-level INSERT/UPDATE grants** on every table clients can write
  (`20260916140000`, `20260916150000`).
- **The domain-verification bypass** was closed.

---

## 2. Decisions, and the reasoning behind each

### 2.1 Inserted by name, not by number

Calling it "Phase 9" would have pushed Trust & Safety to 10 and changed
every reference to Phases 9–13 already written into the roadmap, the
decision log and these write-ups. Naming it avoided all of that. It went
*before* Trust & Safety because Phase 9 only adds screens: polishing
Phases 0–8's worth of surface was cheaper then than after. Two items came
forward from Phase 10 (virtualization and caching; loading/empty/error
states), and Phase 10 keeps a lighter re-check of them.

### 2.2 A redesign, not a drift fix

The consistency item was scoped as "find where screens drift from the
mock's tokens". It became a new theme: black, white and gray, in Light and
Dark, in one token file, which is consistency by construction. The
follow-up audits (11 September) still found real leftovers:
- a pre-theme cream colour hard-coded in 5 places, as two slightly
  different hex values
- a destructive button not using the `error` token
- an invisible toggle thumb in Light mode, only spotted on the phone
- the small uppercase label style using the regular-weight font file in 9
  of 11 screens, so it probably never rendered bold (now `Typography.label`)

### 2.3 Tune `FlatList`, don't switch libraries

The feed and chat thread already used `FlatList`. They got
`removeClippedSubviews`, `windowSize`, `maxToRenderPerBatch` and
`initialNumToRender`, but no `getItemLayout`: a post's or message's height
depends on its content, so it can't be known in advance. The notifications
feed was a `ScrollView` of three nested `.map()`s, and became a
`SectionList`, the virtualized list built for grouped data. The story-ring
row became a horizontal `FlatList`. No `FlashList` was needed. Home's Room
list and the Chats inbox were out of the item's named scope and left as
they were (see §5.1).

### 2.4 Images: no resized variants, so control size at upload

Right-sized thumbnails need Supabase Storage's image transformations,
which are Pro-plan only, and this project stays on the free tier. The
mitigation is at upload time: `compressImageForUpload()` caps every image
at 1080px on its longest edge (or a 1080px-class crop for feed and story
presets), and `expo-image` decodes at roughly the rendered size anyway.

A real bug surfaced with the placeholders: `Avatar` rendered *nothing*
while a photo loaded, instead of its own colour/letter fallback. Now the
fallback always renders underneath and the photo fades in on top (§3.3).
Discover's cards and the profile banner had the same gap. Chat images
were using React Native's core `Image`, with no caching at all, and moved
to `expo-image`.

### 2.5 Compose screens look like sheets; the story viewer fades

Four screens have the "compose something new" shape: Cancel on the left, a
title, the action on the right. Those are New Room, New post, New story
and New sub-group, and they slid in like going deeper into the app. They
now present as modals, since dismissing them means going back to where
you were. The story viewer is full-bleed media, so it cross-fades instead,
like Instagram's. Everything else keeps the default slide, which was an
earlier, deliberate decision.

### 2.6 Creating became a tabbed modal, with one owner for the draft

The Room's "+" used to open one linear form with an optional poll. It's
now a modal with Post, Clip, Poll and Event tabs. Every tab's state lives
in the parent shell, not in the tab, so switching tabs mid-draft never
loses anything. `CLAUDE.md` records this as a rule for multi-tab flows.
Clip is a video-only post through the same `create_post()`. Events got
their own table, one row per post, like polls.

### 2.7 The New Post screen, in four stages, each on the phone first

Instagram's New Post screen, built one stage at a time, with each stage
tested on the Galaxy A14 before the next:
1. **The screen:** media shown at exactly the size and crop it will post
   at (it *is* the feed's `PostMediaCarousel`), a borderless caption, and
   the Post button pinned at the bottom.
2. **A photo editor:** crop, rotate and flip within the three allowed
   shapes. Edits are stored as numbers relative to the photo, never as new
   files. One shape per post; portrait moved from 4:5 to 3:4.
3. **Add location:** free text (place-search APIs are paid), with a CHECK
   on the table so a direct insert can't bypass the limit.
4. **Tag people:** written only by a `SECURITY DEFINER` function that
   silently drops anyone not allowed. A client insert checked by RLS would
   have revealed blocks through its errors.

### 2.8 Feed posts open sheets, not pages

Following Instagram's screenshots: the comment icon opens a Comments
sheet, the like count opens a Likes sheet, and a clip opens a full-screen
viewer. The post screen stays, but only as the landing page for
notifications and profile thumbnails. Pin/Unpin had lived only on that
screen, so it moved into the post's ⋯ menu; otherwise moderators would
have lost it. Things deliberately not drawn as dead controls: hearts on
comments, photo/GIF comments, and translation. Each needs a table, a paid
API or both.

### 2.9 Cursor paging instead of offset

The feed loaded `range(page × 20, …)` ordered by `created_at` alone.
Reproduced on the local stack:
- a post arriving between pages showed one post twice
- a post removed between pages made one post **never appear**, silently
- two posts with the same timestamp at a page boundary had no defined
  order

Paging now continues from the last post seen, by `(created_at, id)`
(§3.2).

### 2.10 Column-level grants, a Phase 10 item done early

Planning the location column exposed that `grants.sql` had granted every
column of every table and left restriction to RLS. But RLS filters
*rows*, not *columns*. All 24 tables were audited, and holes reproduced
before fixing:
- joining a domain-verified Room without a matching email
- approving yourself into a private sub-group
- moving a message into a chat you're muted in
- rewriting who a friendship is between
- never-expiring stories
- double votes on single-choice polls
- pre-reviewed reports with made-up evidence
- future-dated or self-pinned posts, messages and comments
- rewriting a Room's counters or creator
- and `anon` holding write and TRUNCATE privileges everywhere

Now every client-writable table grants INSERT/UPDATE on named columns
only, and anything that carries authority goes through `SECURITY DEFINER`
functions or Edge Functions. `CLAUDE.md` states this as a standing rule.
Room notification mute, which silently did nothing, was fixed on the way.

### 2.11 The React Compiler: compile everything, and fail the build if not

`reactCompiler: true` was on, and much of the code assumed its
memoization. Running the compiler over `src` with a logger showed it
silently skipping every component in 26 of 85 files. Nothing reports
that: Metro still says "React Compiler enabled", and lint and typecheck
pass. The fixes were rewrites the compiler accepts:
- no `try/finally`
- no conditional expressions or `throw` inside a `try`
- no react-hooks `eslint-disable` (any of them makes it skip the whole
  component)
- `.get()`/`.set()` on Reanimated shared values
- no reading a ref during render

Every component compiles (102 then, 111 at the end of Phase 9).
`scripts/check-react-compiler.js` runs in CI with an empty `BASELINE`:
- a new skip fails the build
- a listed file that stops skipping also fails, so the list can only
  shrink

---

## 3. Code walkthrough

### 3.1 Caching an image by what it is, not by its URL

Every signed URL carries a fresh token, so the same photo got a new URL on
every load, and `expo-image`, which caches by URL, never hit.

```ts
export function cachedImageSource(uri: string): { uri: string; cacheKey?: string } {
  const match = /\/storage\/v1\/object\/sign\/([^?]+)/.exec(uri);
  return match ? { uri, cacheKey: decodeURIComponent(match[1]) } : { uri };
}
```

The cache key is the bucket and path. That's safe because every upload
path ends in a fresh random id, so a path never points at different
bytes. Signing still controls access: without a signed URL the app can't
fetch the image at all. Local files from the picker pass through
unchanged.

### 3.2 A page boundary that can't move

```ts
postsQuery.or(`created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`)
...
postsQuery.order('created_at', { ascending }).order('id', { ascending }).limit(FEED_PAGE_SIZE),
```

"Older than the last post I saw, or the same moment and a smaller id."
The `id` tie-break gives every post one defined position. New or removed
posts elsewhere can't shift the boundary.

### 3.3 A placeholder that's always there

```tsx
const inner = imageUrl ? (
  <View style={styles.fill}>
    {fallback}
    <Image
      source={cachedImageSource(imageUrl)}
      style={[styles.fill, StyleSheet.absoluteFill, { borderRadius: radius }]}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={200}
    />
  </View>
) : (
  fallback
);
```

The letter-on-colour fallback always renders, and the photo fades in on
top once decoded. Before, a photo avatar was blank while loading. (Home's
room rows now use this too: Room pictures, 2026-09-22.)

### 3.4 Writing async handlers the compiler can compile

The compiler can't handle `try/finally`, or a conditional inside `try`.
The rewrite used across the app is a nested async function with promise
`.catch()`/`.finally()`:

```ts
const send = async () => {
  await fileReport(myId, target.type, target.id, reason, details);
  if (blockTarget) {
    await blockUser(blockTarget.id);
    onBlocked?.(blockTarget.id);
  }
  setDone({ blocked: !!blockTarget });
};
await send().catch((e) => { ... });
setSending(false);
```

(This example is from Phase 9's report sheet, which follows the pattern
from day one.)

---

## 4. Bugs found, and how

Nearly all were invisible to typecheck and lint.

| Bug | How it was found | Fix |
|---|---|---|
| The "+" button permanently covered the last post in a short feed | 375px walk on web | Bottom padding reserves the tab bar *and* the button |
| Chat showed "No messages yet" before real history loaded | Loading-state audit | `null` means loading, distinct from an empty list |
| The story viewer's text disappeared in Light mode | Loading-state audit | The always-dark viewer uses its own fixed palette |
| A white strip above Discover's banner (two rounds) | Screenshots from the phone | The banner paints behind the status bar; only its text is inset |
| Multiline fields (Room description, bio) hid their first lines at 1.3× font size | Font scale set to 1.3× on the A14 | Pin the selection to the start until the field is focused |
| Backing out of New Room with the phone's back gesture lost the form silently | Checking hardware back | The discard prompt also runs on hardware back |
| The same photo added to a post twice | A duplicate-key warning | The picker opens with the post's photos already ticked |
| Offset paging duplicated or silently skipped posts | Reproduced on the local stack | Cursor paging (§2.9) |
| The location sheet hid behind the keyboard | On the A14 | `KeyboardAvoidingView` uses `'height'` on Android, never `undefined` |
| The caret sat at the wrong end of empty poll/event rows | On the A14 | A fixed row height (an upstream React Native bug) |
| A leftover `create_event_post` overload broke calls (`PGRST203`) | A backend smoke test | The overload was dropped; every parameter is always sent |
| Tapping a clip did nothing | On the A14 (a synthetic tap *worked*) | The video ignores touches when its controls are off |
| The clips viewer crashed out of memory within ~7 s | On the A14, watching the Java heap | Looping clips had queued copies of themselves; every player now shares a small buffer (5 s ahead, 16 MB) |
| Swiping a sheet down didn't close it; the drag lagged | On the A14, logging touch events | The sheet was rebuilt on gesture-handler and Reanimated: it moves on the UI thread, and a drag down on the list closes it when the list is at its top |
| A dark "shadow" followed a sheet down, late | On the A14, frame by frame | The sheet no longer re-renders the feed (540–925 ms) on close |
| Scrolling janked | `dumpsys gfxinfo` over 20 flings | No live blur behind the tab bar on Android |
| The same photos downloaded again on every visit | Kong's access log | Cache by storage path (§3.1) |
| 26 of 85 files silently not compiled | Running the compiler with a logger | Rewrites plus a CI check (§2.11) |
| Clients could write authority-bearing columns | A column audit | Column-level grants (§2.10) |

---

## 5. Verification: what was actually tested

**On the Galaxy A14:**
- **Memory:** 55 scroll swipes over a Room feed, measured with `dumpsys
  meminfo` after each batch. The view count stayed exactly 1237
  throughout: no leaked views. Total memory rose +34 MB in the first
  batch, then only +4.6 MB in the next. That's a cache filling up, not a
  leak, which would keep rising at the same rate.
- **Startup:** the production JS bundle is 5.1 MB (Hermes bytecode).
  Native launch before JS starts measured ~3.6–4.0 s. The 30+ second
  cold starts seen in development come from the dev client fetching an
  unminified bundle over the network, which a release build never does.
- **Font size:** system font scale 1.3×, walking Home, Discover, a Room
  feed and Room Settings. This found the multiline-field bug.
- **Frame times** (`dumpsys gfxinfo`, 20 flings on the Grit Club feed,
  production bundle):

  | | Janky frames | Median | 90th pct |
  |---|---|---|---|
  | Live blur (before) | 16.6% | 34 ms | 69 ms |
  | Static glass (after, two runs) | 12.2% / 12.6% | 26 ms | 46 / 48 ms |

- **One like on the feed, before and after the compiler fixes:** card
  render time 295 → 46 ms, feed-list commit 323 → 64 ms.
- **Photo downloads per feed visit:** 21 before caching by path; 9 on the
  first visit after (old cache entries were keyed by URL), then 0 and 0.
- **Each New Post stage** was tested on the phone before the next,
  including the tag notification arriving from a second account.

**On the local stack:**
- **Security:** a 38-check suite, the domain-verification flow, and a
  30-check backend test through the public API as real users.
- **Isolation:** held for a non-member across posts, media, polls, votes
  and events.

**On web, at 375px wide:**
- **Every main screen, scrolled to its true bottom** (a floating button
  always overlaps an *unscrolled* list, which isn't a bug).

### 5.1 What was not covered

- **"Smooth" in the checklist** was a manual judgement. `gfxinfo`
  measurement came later (17 September), for the tab bar.
- **Right-sized image variants** are blocked on a paid feature.
- **Release-build startup** wasn't measured. That needs a release build,
  which the APK Beta Phase will produce.
- **Memory while scrolling a long chat** wasn't measured. Blind `adb`
  taps kept missing the Chats tab.
- **Home's Room list and the Chats inbox** are still a `ScrollView` with
  `.map()`. The chat thread loads a whole conversation's history at once,
  with no paging.
- **The accessibility and font-scale pass** covered representative
  screens, not all of them. The one bug found was systemic, and both
  places with that pattern were fixed.

---

## 6. Concepts worth knowing before Phase 9

- **Measure on the device, on a production bundle.** Development mode
  adds its own slowness; the tab-bar jank was the same in both, which is
  how it was known to be real.
- **A synthetic tap isn't a finger.** A real finger moves a pixel or two;
  the clip-tap bug only existed because of that.
- **Caches key on something.** When the key changes every time (a token
  in a URL), the cache is decoration.
- **RLS filters rows, not columns.** What a client may write is a
  separate grant.
- **A tool that silently does nothing needs a check that fails loudly.**
  The React Compiler skipped 26 files with every signal green, until a
  script made skipping a build error.
- **Offset paging lies under concurrent writes.** Page by a stable key.

---

## What's next

Phase 9 — Trust & Safety: blocking, moderation, reports, a content
filter, guidelines and account deletion. See [`phase09.md`](phase09.md).
