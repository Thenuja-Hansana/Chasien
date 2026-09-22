# Phase 7 — Stories

> Study-book style: what exists, why each call was made, how the code
> works, and what went wrong along the way. Most of this phase's schema
> was already written in Phase 1; the real work was the client, the
> storage bucket, and making expired media *actually* disappear. Two of
> the viewer's behaviours were ported faithfully from the mock and were
> still wrong. That only showed once two real accounts had stories at the
> same time on a real phone. And two environment gaps surfaced that had
> been hiding since Phase 6.

**Goal:** ephemeral content that's actually ephemeral.
**Exit condition (from `docs/roadmap.md`):** a story posted 25h ago is
gone from both the UI and the storage bucket, unattended.
**Status:** done, 2026-09-02:
- **The exit condition:** a story backdated 25 hours was removed by the
  cleanup function, row *and* file (a raw `GET` against the storage API
  returned `404 NoSuchKey`).
- **The viewer** was reworked the same day after real-device use: stories
  are grouped by author, and the progress bars auto-advance.
- **The hourly job firing on its own** (rather than being invoked by
  hand) was only observed later. See [§5](#5-verification-what-was-actually-tested).

---

## 1. What this phase produced

```
supabase/migrations/
├── 20260901190000_story_media_storage.sql   private story-media bucket: members read, authors upload/delete, images + video
└── 20260901190100_story_cleanup_cron.sql    pg_net + pg_cron, hourly call to the cleanup function

supabase/functions/
└── cleanup-expired-stories/index.ts         service role: delete expired stories' files, then their rows

mobile/src/
├── lib/stories.ts                           fetchActiveStories(), createStory(), signed URLs
├── lib/media.ts                             image/video pickers (and, same day, the camera)
├── app/c/[communityId]/index.tsx            the Room's story-ring row
├── app/c/[communityId]/create-story.tsx     pick or shoot, caption, share
└── app/c/[communityId]/story.tsx            the full-screen viewer
```

Already there since Phase 1, untouched:
- `stories` (`20260813051219_stories.sql`), including
  `expires_at timestamptz not null default (now() + interval '24 hours')`
- its RLS (`20260813051235_row_level_security.sql`): the SELECT policy
  that makes expiry real, plus INSERT and DELETE scoped to the author

---

## 2. Decisions, and the reasoning behind each

### 2.1 Expiry is enforced by RLS, not by the client

The SELECT policy on `stories` is:

```sql
using (is_room_member(room_id, auth.uid()) and expires_at > now());
```

A story past its 24 hours doesn't exist for any client, however it asks.
The app's `fetchActiveStories()` doesn't even filter by time; it relies on
the policy. A client-side filter would have been a UI nicety. Anyone with
the anon key could still have fetched yesterday's stories from the API.

Phase 1's migration also explains why the index isn't a partial index on
`where expires_at > now()`: `now()` isn't allowed in an index predicate.
A plain `(room_id, expires_at desc)` index serves the same query.

### 2.2 Media type isn't a column

`stories.media_url` holds one storage path, with no image/video flag.
Whether a story is a video is inferred from the file's extension (`.mp4`
or not) by `mediaKindFromPath()` in `lib/mediaUtils.ts`. That's safe
because the upload code controls the extension completely (a random id
plus `.jpg` or `.mp4`). The alternative, adding a column, would have meant
editing an already-applied Phase 1 migration, and this project's rule is
additive migrations only.

### 2.3 The bucket mirrors post-media, plus video

`story-media` is private, with the same membership-gated policies as
Phase 5's `post-media`:
- a Room's members can read its stories' files
- a member can upload into their own folder
- an uploader can delete their own files

The difference is its allowed MIME types include video. Stories were the
first feature in the app to accept video at all. Paths are
`{room_id}/{user_id}/{random}.jpg|.mp4`, the same shape as every other
media bucket.

### 2.4 Cleanup runs on a timer, and deletes the file before the row

There's no event to hook when a story expires: time just passes. So an
hourly `pg_cron` job calls the `cleanup-expired-stories` Edge Function
through `pg_net`, using the same internal address as the chat webhook
(`http://edge_runtime:8081/...`, because a container can't reach the
host's port mapping).

The function uses the service role on purpose. Expired rows are exactly
the ones RLS hides from everyone, so an ordinary client couldn't see what
to delete.

The order matters:

```ts
const paths = expired.map((s) => s.media_url as string);
const { error: storageError } = await admin.storage.from(BUCKET).remove(paths);
if (storageError) {
  // Deliberately don't delete the rows in this branch: an orphaned
  // bucket object with nothing left pointing at it can't be retried,
  // but a row that failed to have its media removed just gets picked
  // up again on the next hourly run.
  return json({ ok: false, error: storageError.message }, 500);
}
```

Files first, rows second. If removing the files fails, the rows stay, and
the next run tries again. The reverse order would strand files that
nothing points at, and free-tier storage is the resource this project
protects hardest.

### 2.5 Two things from the mock were left out

The mock's story viewer has a reply box and a like button. Neither was on
Phase 7's checklist. The standard since Phase 5's post card is that a
control which doesn't persist anything is worse than none, so both were
cut rather than drawn as dead UI. Both are easy later: a reply could
become a real DM through `startDm()`, and likes could reuse the posts
pattern.

### 2.6 The camera was added the same day

The first version picked from the gallery only. Commit `7700c77` wired in
`expo-image-picker`'s camera as a second option, with the config plugin
its Android permission prompts need. It shipped in the same Phase 7 push.

---

## 3. Code walkthrough

### 3.1 The viewer groups stories by author

The mock's viewer walks `STORIES[index]`: one flat list. That was a
faithful port, and it was wrong the moment two people had stories: Tobi's
and Mara's interleaved into one sequence. Real Stories UIs play all of one
person's stories, then the next person's.

```ts
function groupByAuthor(stories: Story[]): [string, Story[]][] {
  const order: string[] = [];
  const map = new Map<string, Story[]>();
  for (const s of stories) {
    const key = s.author_id ?? s.id;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(s);
  }
  return order.map((key) => [key, map.get(key)!]);
}
```

`next()` and `prev()` walk within an author's group before moving to the
next or previous author. The ring row on the Room screen
(`dedupeStoryAuthors()` in `index.tsx`) is built from the same query in
the same order (oldest first), so tapping the third ring opens the third
group. The two can't disagree, because neither sorts on its own.

### 3.2 Progress bars that actually advance

The mock's progress bars were static: nothing moved unless you tapped.
Now:
- **An image** gets a fixed 5-second timer (`IMAGE_DURATION_MS`).
- **A video** follows its real playback: expo-video's `timeUpdate` event
  drives the bar, and `playToEnd` advances. So a 3-second clip and a
  30-second one each take their own length.

The image timer, as it is today:

```ts
const animation = Animated.timing(progressAnim, {
  toValue: 1,
  duration: IMAGE_DURATION_MS,
  easing: Easing.linear,
  useNativeDriver: true,
});
runningAnimation.current = animation;
animation.start(({ finished }) => {
  if (finished) nextRef.current();
});
```

The first version kept the bar's width in React state and visibly
stuttered on the Galaxy A14. The fix (also `7700c77`) was an
`Animated.Value` on the native driver. The native driver can only animate
transforms and opacity, not `width`, so the bar fills with a
`scaleX` transform from its left edge instead. Later phases added
pausing the timer while the options sheet is open (Phase 9), and reading
`next` through a ref so the effect's dependencies stay honest (the React
Compiler work, Bones Phase).

---

## 4. Environment gaps found

### 4.1 `pg_net` had never been a tracked dependency

A fresh `supabase db reset` while writing the cron migration failed with
`schema "net" does not exist`. The chat webhook had been calling `pg_net`
since Phase 6, but no migration ever enabled it. It only worked because
the Supabase CLI's own bootstrap turned it on, outside version control.
The cron migration now runs `create extension if not exists pg_net`
itself.

The lesson: if a reset fails on something that "should" exist, check
whether any tracked migration ever created it before assuming something
broke.

### 4.2 `pg_cron` works locally, whatever the docs imply

Supabase's docs describe cron as a hosted-platform feature. That refers to
the dashboard's cron *screen*. The extension itself is in the same
Postgres image the local stack runs. Checked with
`select * from pg_available_extensions` before writing any SQL that
depended on it.

### 4.3 A new Edge Function needs the whole stack restarted

`docker restart supabase_edge_runtime_chasien`, done twice, left the new
function unserved (404). The directory was mounted and visible inside the
container. The edge runtime reads its list of functions from an
environment variable the CLI generates at `supabase start`, not from the
folder. Only `supabase stop` then `supabase start` regenerates it. This
came up again in Phase 9 (`moderate`, `delete-account`); `running-locally.md`
gotcha #9 covers doing that restart without re-downloading images.

---

## 5. Verification: what was actually tested

- **The exit condition, directly:** a story was inserted with a creation
  time 25 hours in the past, and the cleanup function was invoked. Then:
  - the row was gone
  - a raw `GET` for the file against the storage API returned `404
    NoSuchKey`, so the bytes were really gone, not just hidden
- **The viewer's two problems** (a flat sequence instead of grouping by
  author, and bars that never moved) were *found* by using it on the
  Galaxy A14 with two accounts' stories active, and fixed the same day.
  The progress bar's stutter was also found on the phone, and fixed in
  `7700c77`. The decision log doesn't record a separate re-test after
  those fixes; the viewer has been used on the phone in every phase
  since.
- **The hourly schedule firing unattended** wasn't observed in Phase 7:
  the test invoked the function by hand. It has since been seen in the
  database's own log of outgoing calls (`net._http_response`): an entry
  on 2026-09-22 at 14:30 local time (09:00 UTC, the job's `0 * * * *`
  schedule) answered `{"ok":true,"deleted":0}`.

### 5.1 What was not covered

- **No separate attack on the story-media bucket's policies.** The decision
  log records no isolation test of its own; the policies mirror
  post-media's, which Phase 5 did test.
- **The cleanup job calls its function with the public anon key,** like
  the push webhooks. For this function that's harmless, since all a
  caller can trigger is deleting stories that have already expired. But
  it belongs to the same Phase 10 item as the webhooks: functions called
  by the database should check a secret.
- **Report evidence (Phase 9) is lost** when a reported story expires:
  the hourly job deletes its file like any other. The snapshot keeps the
  caption and the author.

---

## 6. Concepts worth knowing before Phase 8

- **Time can live in a policy.** `expires_at > now()` in RLS makes expiry
  a rule of the data, not a feature of one screen.
- **Delete bytes before rows.** When a row is the only pointer to a file,
  removing the row first makes a failed file deletion permanent.
- **A job with no event behind it** is `pg_cron` plus `pg_net` plus an
  Edge Function, with the service role when the rows are ones RLS hides.
- **A faithful port can still be wrong.** The mock only ever had to show
  one story at a time. Some behaviour only appears with real data from
  more than one account.

---

## What's next

Phase 8 (Notifications) builds the fan-out for a table Phase 1 also
already had, and adds a notification for new stories. See
[`phase08.md`](phase08.md).
