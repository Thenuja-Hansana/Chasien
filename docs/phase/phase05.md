# Phase 5 — Posts & Engagement

> Study-book style: what exists, why each call was made, how the code
> works, and the bugs found along the way. Notably, this is the first
> phase where most of the bugs were caught *before* the end-to-end run
> rather than by it — by testing each layer (SQL, storage, query shape)
> directly instead of only through the UI. Two of them were invisible to
> both TypeScript and a browser.

**Goal:** the feed actually does something.
**Exit condition (from `docs/roadmap.md`):** a post with an image and a
poll round-trips through the real backend and renders identically to the
mock's version.
**Status:** done — 11/11 UI scenarios pass with two real accounts, plus
8/8 SQL checks and 9/9 storage-policy checks, with database state
cross-checked against the UI on every count. See
[§6](#6-verification-what-was-actually-tested).

---

## 1. What this phase produced

```
supabase/migrations/
├── 20260814063412_post_media_storage.sql     private bucket + path-scoped RLS
├── 20260814063725_create_post_rpc.sql        atomic post + media + poll
└── 20260814073649_members_can_see_each_other.sql   makes the MOD badge real

mobile/src/
├── lib/
│   ├── media.ts        pick → resize/compress → upload → sign (the R2 seam)
│   └── posts.ts        feed, post, comments, likes, poll votes
├── components/
│   ├── PostCard.tsx    one feed row, ported from the mock
│   └── PollCard.tsx    poll with live tallies, ported from the mock
└── app/c/[communityId]/
    ├── index.tsx           Room feed: real, reverse-chron, paginated
    ├── create-post.tsx     text + image + poll composer
    └── post/[postId].tsx   detail: hero image, likes, threaded comments
```

New dependencies: `expo-image-picker`, `expo-image-manipulator`,
`base64-arraybuffer`.

## 2. Decisions, and the reasoning behind each

### 2.1 Supabase Storage now, Cloudflare R2 at Phase 11 — behind a seam

`docs/architecture.md` picks R2 for media, and the reason is sound: zero
egress fees, the single biggest cost lever once image volume grows. But
R2 has no local emulator and needs real credentials on a real Cloudflare
account, which would have made Phase 5 the first phase that *couldn't*
be verified against the live local stack — the standard every phase so
far has held to.

So media runs on Supabase Storage, which the local stack already
provides, and everything outside `lib/media.ts` only ever calls
`uploadPostImage()` / `signMediaUrls()`. The R2 swap becomes a change to
one file, and Phase 11's checklist already listed the bucket as work to
do there. This was put to the user as an explicit choice rather than
decided quietly, because it deviates from a documented architecture
decision.

### 2.2 The bucket is private, and reads go through signed URLs

A public bucket would have been simpler. It also would have quietly
undone the guarantee this whole project is built on: Phases 1 and 4 went
to real lengths to prove a non-member can't see a Room's content, and a
public bucket hands out every post image to anyone with the URL —
for exactly the content most likely to get forwarded around.

So the bucket is private, object paths are `{room_id}/{user_id}/{uuid}.jpg`,
and the storage policies parse those segments back out to answer "is the
caller a member of this Room". Display uses short-lived signed URLs
(1 hour). This also happens to match the roadmap's own wording for the
eventual R2 path ("media upload → Cloudflare R2 **via signed URL**").

Two details in those policies are deliberate and worth not undoing:

- **No `::uuid` cast on the path segments.** They're attacker-controlled;
  casting a malformed one raises a hard error instead of cleanly denying.
  Comparing against `rooms.id::text` keeps a junk path an ordinary
  "no rows matched".
- **Ownership is checked from the path, not `storage.objects.owner`.**
  That table carries both a legacy `owner` (uuid) and a newer `owner_id`
  (text), and which one the Storage API populates varies by version. A
  policy resting on the wrong one fails closed and blocks every upload.
  This was checked against the running database before writing the
  policy, not assumed.

### 2.3 Creating a post is one RPC, not four client calls

A post with an image and a poll is four dependent inserts: `posts`, then
`post_media`, `polls`, `poll_options`. Done from the client, a failure
partway through strands a half-built post — and `posts` has **no DELETE
policy for authors** (row_level_security.sql grants authors
SELECT/INSERT/UPDATE only), so the client physically cannot roll it back.

`create_post()` makes it one transaction: any raise undoes every insert
above it. It's deliberately `SECURITY INVOKER` — unlike the `security
definer` helpers in row_level_security.sql, it has no reason to bypass
RLS. Every insert still passes through the caller's own policies ("can
this user post here", "is members_can_post on", "is the author really
them"), so it adds atomicity without adding trust.

It also closes a gap Phase 1 explicitly flagged and deferred. feed.sql
says, in a comment:

> No "must have text/media/poll" CHECK here: post_media and polls are
> separate rows inserted after the post itself exists (need its id
> first), so that invariant can't be expressed at a single INSERT [...]
> Enforced at the application/Edge Function layer instead.

A function that creates all of those rows *can* express it, and now does.

### 2.4 Two mock controls deliberately left out

`PostCard` omits the mock's bookmark/save toggle and its `dotsH`
overflow menu. Both were local-only state in the mock; neither has
anything behind it here — there is no `bookmarks` table in the Phase 1
schema, and the overflow menu's contents (report/remove) are Phase 9's
trust-and-safety work. Same standard the auth screens were held to in
Phase 2: a button that does nothing on tap is worse than no button.

### 2.5 A poll vote can be changed; the mock's couldn't

`app_reference`'s PollCard hard-locks after the first tap
(`if (voted !== null) return`). That's fine for a static demo, but it
would permanently strand a real mis-tap. The schema already permits
retracting ("users can retract their own vote"), so the UI honours it —
changing a vote is a delete-then-insert, and the one-vote-per-poll
primary key still prevents double-voting. Verified: changing a vote
leaves the total at 1, not 2.

### 2.6 Widening membership visibility so the MOD badge is real

The mock puts a MOD badge on posts. Porting it exposed that
`room_memberships` was readable only two ways (Phase 1): your own row,
or every row if you're a moderator. So the badge could only ever be seen
*by* moderators — nearly nobody. It was dead UI.

`20260814073649_members_can_see_each_other.sql` adds a third, narrowly
scoped policy: approved members can see other **approved** rows in Rooms
they're approved members of. Deliberately excluded:

- `pending` rows — who asked to join (and was declined) stays mod-only.
- `invited` rows — a pending invite isn't advertised before acceptance.
- Non-members gain nothing; `is_room_member()` is false for them, so
  Phase 4's isolation guarantee is untouched.

What it newly reveals, to fellow members only, is the roster of a Room
you're already inside — the ordinary expectation for a community app,
and what the mock assumes. This was verified as a *negative* test too
(§6.3), not just a positive one.

## 3. Code walkthrough

### 3.1 `lib/media.ts` — compress once, and get base64 from the same call

```ts
const rendered = await context.renderAsync();
const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
```

`expo-image-manipulator`'s `manipulateAsync` is **deprecated in SDK 57**,
replaced by the contextual `ImageManipulator.manipulate(uri)` API — the
kind of change `mobile/AGENTS.md` exists to warn about, and one that was
checked in the versioned docs before writing any of this.

Asking for `base64: true` here isn't incidental: the installed
`@supabase/storage-js` types say plainly that in React Native, `Blob` /
`File` / `FormData` "does not work as intended" and an `ArrayBuffer` from
base64 is the supported path. Getting base64 out of the compression step
avoids a second read of the file off disk.

Resize is skipped entirely when the image is already under the 1080px
cap, so a small image is never upscaled into a *bigger* file than it
started as.

### 3.2 `lib/posts.ts` — why "did I like this" is a separate query

```ts
supabase.from('post_likes').select('post_id').eq('user_id', userId).in('post_id', postIds)
```

The tempting version is a filtered embed (`post_likes!inner(user_id)`
filtered to the current user), but an inner join drops every post that
has no likes at all — which is most of them. Two extra small queries,
folded together with `Promise.all`, are correct and still one round trip
of latency.

### 3.3 The embed that must name its foreign key

```ts
profiles!posts_author_id_fkey(handle, name)
```

`posts` and `comments` each have **two** foreign keys to `profiles`
(`author_id` and `removed_by`). A bare `profiles(...)` embed is ambiguous
and PostgREST rejects it outright with `PGRST201`, for every row,
regardless of data — the exact bug that silently broke Room Settings in
Phase 4. The constraint names were confirmed against the live database
before writing the query rather than guessed from convention.

## 4. Three bugs found before the end-to-end run

Each was caught by testing a layer directly instead of waiting for the
UI, and each would have been expensive to diagnose from a screenshot.

### 4.1 `polls` embeds as an object, not an array

The feed query was written expecting `polls: [{...}]` and read
`p.polls?.[0]`. Querying PostgREST directly with a real poll showed:

```json
"polls":{"id":"ec53...","question":"Shape?","poll_options":[...]}
```

A single **object** — because `polls.post_id` carries a UNIQUE
constraint, so PostgREST resolves posts→polls as one-to-one, the same
way it does the many-to-one `profiles` embed. Reading `[0]` off an object
yields `undefined`, so **every poll in the app would have silently
rendered as "no poll"** — one of the phase's two headline features,
gone, with no error anywhere.

TypeScript could not have caught this: the response is untyped JSON and
the `RawPost` shape is hand-written (`as unknown as RawPost`). The type
was confidently wrong, and the compiler agreed with it.

### 4.2 `crypto.randomUUID()` works on web and crashes on device

`media.ts` built its object path with `crypto.randomUUID()`. The project
polyfills crypto via `react-native-get-random-values` — which provides
**only** `crypto.getRandomValues`. Browsers have `randomUUID` natively;
React Native does not.

So image upload would have worked perfectly in every web test and thrown
`crypto.randomUUID is not a function` on a real phone. That is precisely
the web-passes/native-breaks trap that cost Phase 3 two rounds of
debugging — and notably, the browser-driven verification running at the
time would *not* have caught it. Replaced with a 3-line `randomId()`
built on the polyfill that actually exists, which also avoided adding a
dependency.

### 4.3 A corrupted generated file, not a real type error

Mid-phase, `tsc` suddenly reported eight syntax errors in
`.expo/types/router.d.ts` — a *generated* file. Inspecting it showed a
complete, well-formed block followed by a line starting mid-expression
(`ityId: string | number;...`): two Expo type-generation passes had raced
and interleaved their writes while the dev server was under load from
the verification run. Worth recording because the instinct on seeing
eight TS errors is to go hunting in one's own code; the fix was to delete
the artifact and let the dev server regenerate it (14 clean lines).

## 5. One bug found *by* the end-to-end run

`comments(count)` in the feed query had no `deleted_at is null` filter,
while `fetchComments()` (the detail screen) correctly filters
soft-deleted rows. Nothing soft-deletes comments today, so this was
invisible — but the moment Phase 9's moderation starts removing content,
a post's comment badge would have disagreed with its own detail screen.

Proven rather than assumed before fixing: soft-deleting one of two
comments and re-querying gave `count: 2` unfiltered vs `count: 1`
filtered. Fixed by adding the embedded filter to both queries that use
`POST_SELECT`.

## 6. Verification: what was actually tested

Three independent layers, deliberately not just the UI — the top two
found bugs the UI never would have.

### 6.1 The `create_post` RPC, in SQL (8/8)

Run as a real `authenticated` role with `request.jwt.claims` set, the
same technique Phase 1 used.

| Check | Result |
|---|---|
| `auth.uid()` actually resolves | ✅ |
| text-only post creates | ✅ |
| post + poll + 3 options creates | ✅ |
| GUARD: empty post rejected ("needs text, an image, or a poll") | ✅ |
| GUARD: poll with one real option rejected (blank options dropped first) | ✅ |
| GUARD: posting into a Room you're not in rejected by RLS | ✅ |
| poll and its options actually attached to the post | ✅ |
| atomicity — zero half-created rows from the three failed calls | ✅ |
| one-vote-per-poll enforced (second vote → duplicate key) | ✅ |

*(A first run of this battery "failed" tests 1 and 2 — which turned out
to be a bug in the test, not the code: `set_config(..., true)` is
transaction-local and psql autocommits each statement, so `auth.uid()`
was null. Same class of self-inflicted false failure Phase 2 documented.)*

### 6.2 Storage policies, with real user sessions (9/9)

A Node script driving `@supabase/supabase-js` as two genuine signed-in
users against an invite-only Room.

| Check | Result |
|---|---|
| member can upload to their own `{room}/{user}/` path | ✅ |
| cannot upload under **another user's** path segment | ✅ denied |
| non-member cannot upload into the Room | ✅ denied |
| member can mint a signed URL | ✅ |
| the signed URL actually serves the image bytes | ✅ 200 |
| **non-member cannot sign** the Room's media | ✅ denied |
| **non-member cannot download** the object | ✅ denied |
| bucket is private — public URL rejected | ✅ 400 |
| uploader can delete their own object (the cleanup path) | ✅ |

### 6.3 Membership visibility policy, positive *and* negative

| Check | Result |
|---|---|
| plain member sees the approved roster (4 rows) | ✅ |
| plain member can read the OWNER role — the badge works | ✅ |
| plain member canNOT see `pending` rows | ✅ 0 rows |
| non-member sees none of the roster | ✅ 0 rows |
| non-member still sees only their own row | ✅ 1 row |
| mod can still see `pending` rows (Phase 4 approvals intact) | ✅ |

### 6.4 End to end in the UI, two real accounts (11/11)

Two accounts created through `/signup`, confirmed via Mailpit, logged in
through `/login`, in two isolated browser contexts acting simultaneously.

| # | Scenario | Result |
|---|---|---|
| 1 | text post appears in feed with author + relative time | ✅ |
| 2 | feed is reverse-chronological (newest on top) | ✅ |
| 3 | account B sees A's posts (real cross-account read through RLS) | ✅ |
| 4 | likes: 0→1, survives reload, visible to the other account, unlike → 0 | ✅ |
| 5 | poll create + vote; B's vote visible to A (shared state, not local) | ✅ |
| 6 | changing a vote moves it — total stays **1 vote**, not 2 | ✅ |
| 7 | poll validation: one option → Post disabled + hint | ✅ |
| 8 | comments post, are visible cross-account, and update the feed badge | ✅ |
| 9 | threaded reply indents; the reply itself offers no "Reply" | ✅ |
| 10 | **image post**: real JPEG → composer preview → feed → detail hero | ✅ |
| 11 | empty post guard: Post disabled, forced click creates nothing | ✅ |

Console output across both contexts: **zero** errors and zero uncaught
page errors. The only noise was a repeated React Native Web deprecation
warning about `shadow*` style props (32 occurrences, from the feed's
floating action button), since fixed by moving to `boxShadow`.

Every count shown in the UI was cross-checked against direct SQL on the
live database — media, likes, comments, poll tallies, and reply
threading all matched, confirming nothing was being faked by optimistic
local state.

**The exit condition specifically** — "a post with an image and a poll
round-trips through the real backend" — is scenarios 5, 6 and 10, with
the image confirmed rendering from a genuine
`/storage/v1/object/sign/post-media/...` signed URL at 640×420 in the
feed and 430×330 on the detail screen.

### 6.5 What was not covered

Stated plainly rather than left to inference: feed pagination past 20
posts, post editing/deletion (no UI yet), and the **native** iOS/Android
image-picker path — the UI verification was web-only. §4.2's fix is
precisely a native-only bug, so it is reasoned-and-typechecked but not
yet exercised on a device.

## 7. Concepts worth knowing before Phase 6

- **A UNIQUE constraint changes an embed's shape.** PostgREST returns a
  one-to-one embed as an object and a one-to-many as an array. Adding or
  removing a UNIQUE constraint therefore silently changes the JSON shape
  of every query that embeds that table.
- **Hand-written types over untyped JSON are an assertion, not a check.**
  `as unknown as RawPost` makes the compiler agree with whatever you
  claim. Both §4.1 and the Phase 4 embed bug lived inside a type that
  typechecked perfectly.
- **`getRandomValues` and `randomUUID` are different APIs.** Having a
  crypto polyfill does not mean having *the* crypto function you're
  about to call; browsers implement far more of `crypto` than React
  Native does.
- **`INSERT ... RETURNING` re-checks the SELECT policy** (carried over
  from Phase 4, and the reason `create_post` returns only a bare uuid
  rather than the composed row).
- **A soft-delete column has to be filtered everywhere it's counted**,
  not just where rows are listed — an aggregate over an embedded table
  ignores the parent query's filters entirely.

## What's next

**Phase 6 — Chat & realtime.** The unified inbox (Room channels + DMs in
one list), realtime delivery via Supabase Realtime gated by the same
membership check as everything else, typing indicators, read receipts,
reactions, image and voice attachments through the same media pipeline
this phase built, and Expo Push notifications for new messages.
