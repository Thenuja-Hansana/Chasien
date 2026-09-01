# Phase 6 — Chat & realtime

> Study-book style: what exists, why each call was made, how the code
> works, and the bugs found along the way. This phase hit the same bug
> *class* documented once already in Phase 4 — a second time, in a
> different table — and also produced the clearest example yet of a
> failure that lived entirely in the verification script, not the app:
> a passing test result flipped to a false FAIL once a second message
> existed for its own locator to collide with.

**Goal:** the messaging half of "Telegram-like."
**Exit condition (from `docs/roadmap.md`):** two devices, real-time
message delivery, and a non-member cannot subscribe to a Room's chat
channel even by guessing the channel id.
**Status:** done — 8/8 SQL-level checks (default channel, isolation,
`start_dm` race-safety, content invariants, `push_tokens` isolation) and
10/10 end-to-end UI scenarios with two (and, for the isolation check,
three) real accounts. One bug found this way was a real, novel one
(reply-to's Pressable nesting); one was the RETURNING/RLS-timing class
recurring; two apparent failures (image and voice attachments) turned out
to be the *test harness*, not the app, unable to drive a native file
picker or microphone permission dialog headlessly. See
[§6](#6-verification-what-was-actually-tested).

---

## 1. What this phase produced

```
supabase/migrations/
├── 20260815001743_default_room_channel.sql        every Room gets a 'general' channel
├── 20260815001826_start_dm_rpc.sql                 get-or-create a DM, race-safe
├── 20260815001933_message_media_storage.sql        private bucket, conversation-scoped RLS
├── 20260815002356_push_tokens.sql                  one row per device token
├── 20260815002450_realtime_publication.sql         opts messages/reactions/participants into Realtime
├── 20260815002723_notify_new_message_webhook.sql   DB Webhook -> Edge Function on every message
├── 20260815003801_inbox_view.sql                   my_inbox: one unified, security_invoker view
└── 20260815021051_dm_participants_can_always_see_own_dm.sql   the RETURNING/RLS bug, again

supabase/functions/
└── notify-new-message/index.ts     webhook target: looks up recipients, POSTs to Expo Push

mobile/src/
├── lib/
│   ├── mediaUtils.ts     shared internals: randomId, compress, upload, sign — used by Phase 5 AND 6
│   ├── media.ts          (refactored) thin Phase-5-compatible wrapper over mediaUtils.ts
│   ├── messageMedia.ts   chat-specific: uploadMessageImage, uploadMessageVoice, signMessageMediaUrls
│   ├── chat.ts           inbox, messages, send, react, typing, read receipts, start_dm
│   └── push.ts           register device, foreground handler, tap-to-navigate
├── components/
│   └── MessageBubble.tsx one bubble, both directions; VoicePlayer subcomponent (expo-audio)
└── app/
    ├── chats/index.tsx        unified inbox: Room channels + DMs, filterable, pinned section
    ├── chats/[chatId].tsx     the conversation screen — messages, composer, reply, reactions, typing
    ├── u/[userId].tsx         (rewritten) real profile + "Message" button that calls start_dm()
    └── _layout.tsx            (extended) registers push on session change, wires tap-to-navigate
```

New dependencies: `expo-notifications`, `expo-audio`, `expo-device`.

## 2. Decisions, and the reasoning behind each

### 2.1 The default Room channel is created inside the *same* trigger as owner membership

A Room needs a group-chat conversation to exist the moment it's created —
there's no "create channel" step in the UI, the mock just has one. The
temptation is a second, separate `AFTER INSERT ON rooms` trigger for it.
Instead, `20260815001743_default_room_channel.sql` extends Phase 1's
existing `add_owner_membership_on_room_created()` to also insert the
`conversations` row (`kind = 'room_channel'`, `channel_name = 'general'`)
and its own `conversation_participants` row for the owner, in the same
function body, same transaction, same trigger fire.

**Why not a second trigger:** Postgres doesn't guarantee execution order
between two triggers on the same event unless you explicitly name one
`BEFORE` the other with `ALTER TABLE ... trigger ... AFTER ...` ordering
tricks — and this project's own Phase 4 and (see §4 below) Phase 6 history
is a documented case study in what goes wrong when *anything* about "did
the membership row exist yet" is left to implicit ordering. One function,
one guaranteed sequence, is simpler to reason about than two triggers
whose relative order isn't something the schema declares anywhere.
Existing rooms got the same channel via a one-time backfill in the same
migration.

### 2.2 `start_dm()` is one RPC: canonical ordering, and a race is a feature to survive, not prevent

Two people can tap "Message" on each other at nearly the same instant.
`20260815001826_start_dm_rpc.sql`'s `start_dm(other_user_id)`:

1. Sorts the pair into a canonical order (`least`/`greatest` on the two
   uuids) before ever looking anything up, so "A DMs B" and "B DMs A"
   always resolve to the same `(dm_user_a, dm_user_b)` pair — the
   precondition for a `UNIQUE (dm_user_a, dm_user_b)` constraint to mean
   anything.
2. Tries to `SELECT` an existing conversation for that pair first (the
   common case — most "Message" taps are opening a DM that already
   exists).
3. Otherwise inserts, and if a concurrent call from the other side won
   the race and inserted first, catches the `unique_violation` and falls
   back to the `SELECT` rather than surfacing an error to either caller.

Both callers of `start_dm()` at the "same" moment get back the same
conversation id, cleanly, regardless of which one's insert actually
landed first. `SECURITY INVOKER` — same posture as Phase 5's
`create_post()` — since there's no reason a DM-creation helper needs to
bypass the caller's own RLS.

### 2.3 Chat media: same private-bucket pattern as Phase 5, scoped by conversation instead of Room, sharing real code

`message-media` mirrors `post-media`'s design (private bucket, signed
reads, no `::uuid` cast on attacker-controlled path segments, ownership
checked from the path) with the one difference the domain actually
forces: a DM has no `room_id` for a Room-scoped policy to check, so
`message-media`'s policies scope by `conversation_id` via
`conversation_participants` instead.

Rather than copy-pasting Phase 5's compress/upload/sign logic into a new
file, that logic moved into `lib/mediaUtils.ts` — the parts that are
genuinely identical no matter which bucket a caller ultimately writes to
(the random filename scheme, resize/JPEG-compress, batched
`createSignedUrls`). `lib/media.ts` (Phase 5) became a thin wrapper
re-exporting the same public API it always had, so nothing outside it
needed to change; `lib/messageMedia.ts` (Phase 6) is a second, equally
thin wrapper pointed at `message-media`. One place to fix the next bug in
that logic, not two slightly-diverging copies.

### 2.4 Realtime: `postgres_changes` for anything that's a durable row, Broadcast only for typing

Two different Realtime primitives are in play, deliberately not one:

- **`postgres_changes`** for `messages`, `message_reactions`, and
  `conversation_participants` (read receipts). These are real rows with
  RLS policies already governing who can read them; Supabase evaluates
  those same policies before delivering a change event, so subscribing to
  a conversation you're not in the RLS-eligible set for yields silence,
  not data. This needed the table added to the `supabase_realtime`
  publication (`20260815002450_realtime_publication.sql`) — a bare RLS
  policy is not sufficient on its own for Realtime to emit anything at
  all, checked against current docs rather than assumed.
- **Broadcast** for typing indicators only. Nothing about "X is typing"
  is a fact worth persisting or ever replaying to a late joiner — it's
  gone the instant it's stale. Broadcast is also, per Supabase's current
  docs, public by default (any authenticated client can send/receive on
  any channel name) unless a project opts into `private: true` channels
  with `realtime.messages` RLS — deliberately not done here. The leak
  surface if that default ever mattered is small and self-limiting: a
  channel name is `typing:{conversationId}`, so guessing one only reveals
  that *someone* is typing in a conversation whose UUID you'd already
  have to know, and only for the seconds someone's actively typing —
  nowhere near the risk class `postgres_changes` protects against, which
  is why only that path carries real RLS.

### 2.5 Push delivery is a Database Webhook into an Edge Function, not a client-side trigger

A new message fires a Postgres trigger
(`20260815002723_notify_new_message_webhook.sql`) that calls
`supabase_functions.http_request()` against
`notify-new-message` — internal Docker networking
(`http://edge_runtime:8081/...`), not the external Kong port. The
function itself runs as service role, looks up every *other* participant
in the conversation (excluding the author and anyone who's muted it),
fetches their `push_tokens`, and POSTs to Expo's push API.

**Why not have the sending client call the Edge Function directly:**
that only notifies people while the sender's app happens to still be
running and connected — the entire point of a push notification is
reaching someone whose app *isn't* open. A database-level trigger fires
regardless of what any client is doing, which is the only version of
"notify everyone else" that's actually correct.

### 2.6 `my_inbox`: one view, not a UNION built in the client

Phase 3's `Chats.jsx` mock renders Room channels and DMs in a single
list. `20260815003801_inbox_view.sql` creates `my_inbox` — a
`security_invoker = true` view joining `conversations` →
`conversation_participants` → (for Room channels) `rooms`, and for DMs, a
`LEFT JOIN LATERAL` pulling each side's `profiles` row, plus another
`LEFT JOIN LATERAL` for the single most recent message per conversation.
`fetchInbox()` (`lib/chat.ts`) is then one query, ordered by
`last_message_created_at`, with no client-side merge of two separate
result sets.

`security_invoker = true` matters the same way it did nowhere else yet
in this project until now: without it, a view runs with the
*view-creator's* privileges, which would mean `my_inbox` silently leaking
every conversation in the database regardless of who queried it, since
its own SELECT would bypass the querying user's RLS entirely. With it,
Postgres evaluates the view's underlying table policies as the actual
caller — a non-participant querying `my_inbox` for someone else's
conversation gets zero rows, verified directly (§6.1).

### 2.7 Push notifications need an EAS project id — a different requirement than Firebase/FCM

Two separate questions came up while wiring push, and they have
different answers:

- **Does this need a Firebase/FCM project?** No, not for development.
  FCM only matters for a *standalone/production* Android build; Expo's
  push service handles delivery to Expo Go and dev builds without it.
  Put to the user as a choice; answer was to build against Expo Go now
  and defer FCM to whenever a production Android build happens.
- **Does this need an EAS project id?** Yes, unavoidably, even just to
  test in Expo Go — `Notifications.getExpoPushTokenAsync()` requires one
  to mint a token at all, full stop. Also put to the user as a choice;
  answer was to set one up now (`eas login` / `eas init`, free, tied to
  the user's own Expo account). As of this write-up that step hasn't
  been completed yet — `app.json` has no `extra.eas.projectId` and no
  `eas.json` exists — so `registerForPushNotifications()` (§3) correctly
  no-ops rather than throwing, and actual push *delivery* is reasoned
  about and unit-testable but not yet exercised end to end on a device.
  That's the one piece of this phase's exit condition not fully closed;
  everything else is.

## 3. Code walkthrough

### 3.1 `subscribeToTyping` returns a pair, not a bare unsubscribe

```ts
export function subscribeToTyping(conversationId: string, onTyping: (userId: string) => void) {
  const channel = supabase.channel(`typing:${conversationId}`)
    .on('broadcast', { event: 'typing' }, (payload) => onTyping(payload.payload.userId))
    .subscribe();

  return {
    broadcastTyping: (userId: string) => channel.send({ type: 'broadcast', event: 'typing', payload: { userId } }),
    unsubscribe: () => { supabase.removeChannel(channel); },
  };
}
```

The composer screen needs both directions on the *same* channel object —
receive others' typing events, and send its own when the local user
types. An earlier draft subscribed once for receiving (in a `useEffect`)
and separately opened a second channel via `useMemo` just to call `.send`
from the draft-change handler — two channels, doubly subscribed, for one
logical concern. Consolidated to a single `useRef`-held channel shared by
both call sites; see §4.4.

### 3.2 `subscribeToMessages`'s INSERT/UPDATE handlers re-fetch through the same `MESSAGE_SELECT`

```ts
async (payload) => {
  const { data } = await supabase.from('messages').select(MESSAGE_SELECT).eq('id', payload.new.id).single();
  if (data) handlers.onInsert(mapMessageRow(data));
}
```

A `postgres_changes` payload is the bare row as stored — no
`profiles`/`message_reactions` embed, since Realtime doesn't run
PostgREST's embedding logic. Re-querying by id through the exact same
`MESSAGE_SELECT` constant `fetchMessages()` uses guarantees the live
event and the initial page load produce identically-shaped `Message`
objects, so the rest of the screen never needs to know whether a given
row arrived from the initial fetch or a realtime event.

### 3.3 `MessageBubble`: one `Pressable` per bubble, not two nested ones — see §4.3 for why this matters

```tsx
<Pressable onPress={onPress} onLongPress={() => onReact('❤️')}>
  {/* image / voice / text content */}
</Pressable>
```

Both the "mine" and "theirs" branches route tap (set reply target) and
long-press (react) through the *same* Pressable now. Both were always
symmetric in the final version — the asymmetry that mattered was never
between the two branches, but between one Pressable and two (§4.3).

### 3.4 `expo-audio`'s hooks API, and `expo-notifications`'s current handler shape

`VoicePlayer` uses `useAudioPlayer(uri)` + `useAudioPlayerStatus(player)`
— SDK 57's replacement for the older imperative `Audio.Sound` API, and
the composer's recording side uses the matching `useAudioRecorder` +
`RecordingPresets` + `requestRecordingPermissionsAsync`. `push.ts`'s
foreground handler returns `shouldShowBanner`/`shouldShowList` rather
than the deprecated `shouldShowAlert` single boolean — both checked
against the versioned SDK 57 docs per `mobile/AGENTS.md`'s standing
instruction, not assumed from memory of older Expo versions.

## 4. Bugs found

### 4.1 The RETURNING/RLS-timing bug, a third time — this time in `start_dm()`

Every call to `start_dm()` failed with `new row violates row-level
security policy for table conversations`. Root cause was the exact
pattern documented in Phase 4
(`docs/phase/phase04.md` §4, bug 2): `.insert(...).select().single()`
asks Postgres to re-check the SELECT policy on the newly-inserted row as
part of the same statement, and `conversations`' only path to seeing a
DM was via `conversation_participants` — populated by
`seed_participants_on_conversation_created`, an `AFTER INSERT` trigger
whose own insert that same-statement recheck doesn't see yet. Reproduced
with the table's other INSERT policy temporarily dropped, to rule out a
multi-policy interaction before concluding it was this alone.

Fixed the same way Phase 4 fixed it: widen the policy so the two actual
participants of a DM can always see it
(`20260815021051_dm_participants_can_always_see_own_dm.sql`), rather than
restructure the RPC into two round trips to dodge a timing quirk. Worth
stating plainly rather than glossing over: this is the *same* bug class
hit and documented once already, three phases ago, and it still cost
real debugging time to re-recognize — the lesson from Phase 4 was "widen
the policy," not yet "recognize `new row violates row-level security
policy` immediately after an `INSERT...RETURNING` behind an
`AFTER INSERT` trigger as this specific, nameable thing." Recorded here
a second time in the hope the second recording is the one that sticks.

### 4.2 Caught before applying: don't cast the attacker-controlled path segment to uuid

Writing `message-media`'s storage RLS, a first draft compared
`(storage.foldername(objects.name))[1]::uuid = cp.conversation_id`. Path
segments come from the object's own name, which the caller chooses — a
malformed segment there makes Postgres raise a hard cast error rather
than cleanly deny, which is worse than "not authorized," not better.
Caught during self-review before ever applying the migration, and
written the correct way instead: cast the *known* column to text
(`cp.conversation_id::text = (storage.foldername(objects.name))[1]`),
never the untrusted side to a typed column. Same principle Phase 5's
`post-media` policies already established; this is the first time it
needed re-deriving from scratch rather than being copied forward
correctly on the first try.

### 4.3 Reply-to: a nested Pressable silently swallowing taps meant for its parent

The first full verification pass found scenario 9 (tap a bubble to set
it as a reply target) failing. Root cause: `MessageBubble` originally
wrapped its content in one `Pressable` (`onLongPress` → react), and the
screen wrapped *that whole component* in a second, outer `Pressable`
(`onPress` → set reply target). On React Native Web, a `Pressable` with
only `onLongPress` still claims the gesture responder for an ordinary
tap even though it has no `onPress` of its own to do anything with it —
the tap never reached the outer Pressable at all. Fixed by merging both
gestures onto the single inner `Pressable`
(`onPress={onPress} onLongPress={() => onReact('❤️')}`) and having the
screen pass `onPress` down as a prop instead of wrapping the component a
second time (§3.3).

**A second-order lesson from verifying this fix, not from the bug
itself:** re-testing produced three more apparent failures (long-press
reaction, and the reply-to tap on both "theirs" and "mine" bubbles) that
looked, at first, like the fix hadn't fully worked. All three turned out
to be the *test script's* `getByText(marker).first()` locator matching
the wrong element — once a reply existed, its quoted preview
(`↩ {marker text}`, a plain non-interactive `<Text>` with no handler)
contained the same marker substring as the original bubble, and because
the message list is an `inverted` `FlatList` (DOM order is newest-first,
not visual top-to-bottom order), `.first()` in DOM order landed on the
inert quote preview instead of the real bubble. Confirmed by re-running
with a freshly-sent, never-quoted marker string and an explicit
locator-match-count assertion (`count === 1`) before clicking — genuinely
unambiguous, and it passed. The actual code fix was correct on the first
attempt; three of its four "failing" retests were the harness, not the
app, and the difference was only provable by making the locator provably
unambiguous rather than by re-reading the component again.

### 4.4 A duplicate typing-indicator channel, caught in self-review before verification

An earlier draft of the composer subscribed to `typing:{conversationId}`
once in a `useEffect` (to *receive* others' typing events) and separately
opened a second, `useMemo`-held channel just to call `.send` from the
draft-change handler. Two live subscriptions to the same channel name
from the same client — one leaked (no cleanup path for the `useMemo` one)
and both firing their own `.subscribe()`. Found rereading the diff before
running any verification, not by a failure; consolidated to the single
`useRef`-held channel both call sites now share (§3.1).

### 4.5 Forgetting to re-apply migrations immediately after writing them

`inbox_view.sql` and the `conversation_participants` line added to
`realtime_publication.sql` were both written, then client code that
depended on them was written next — without an intervening
`supabase db reset` — producing `relation "my_inbox" does not exist`
once actually run. Not a bug in either file; a process slip, worth
naming as a standing rule going forward: apply a migration the moment
it's written, before writing anything that assumes it's live, rather
than batching several migrations' worth of client work first.

### 4.6 A misleading self-inflicted SQL "failure" — an earlier statement's rollback ate a later one

An early verification pass ran several `-c "stmt1; stmt2; ...;"` checks
back to back inside one `docker exec psql` invocation, including a
deliberately-failing constraint test. Because a multi-statement `-c`
string runs as one implicit transaction, that expected failure rolled
back everything after it in the *same* invocation too — including a
`DROP POLICY` a later "check" depended on — producing a confusing
downstream "failure" that had nothing to do with the thing being tested.
Resolved by re-running each check as its own isolated `docker exec`
invocation rather than batching statements. A related false failure in
the same pass (one seeded account appearing to have zero messages in a
Room channel) was simply a wrong test expectation — that Room's channel
was genuinely empty; the seeded messages lived in a different one. Both
are recorded because the instinct in the moment was to go looking for a
schema bug that didn't exist.

## 5. What image and voice attachments' apparent failure actually was

The first full UI verification pass logged scenarios 7 (image) and 8
(voice) as failing — the composer showed no attached image or voice
player after driving those flows. Investigated separately rather than
assumed to be real, since a headless Playwright browser has no way to
drive a native OS file-picker dialog or grant a microphone permission
prompt by default — both of which those flows require, and neither of
which is anything the app's own code controls.

A follow-up diagnostic run used Playwright's `setInputFiles()` against
the hidden `<input type="file">` `expo-image-picker` renders on web (
bypassing the native dialog Playwright can't drive) and a mocked
`getUserMedia` returning a synthetic audio stream (bypassing the browser
mic-permission prompt). With both harness gaps closed, the same flows
that "failed" completed correctly end to end: a compressed JPEG uploaded
and rendered in the bubble, and a full record → stop → send → play cycle
produced a working voice message with the expected duration bar. Recorded
here specifically because the first result looked, superficially, like
two of the phase's headline features being broken — and confirming that
diagnosis before fixing anything (there was nothing in the app to fix)
avoided chasing a bug that only existed in the test's own capabilities.

## 6. Verification: what was actually tested

### 6.1 SQL-level checks (8/8)

Run as a real `authenticated` role against the live local stack, each in
its own isolated `docker exec psql` invocation (§4.6).

| Check | Result |
|---|---|
| a newly created Room gets a default 'general' channel automatically | ✅ |
| a non-member subscribing/querying a Room's channel gets zero rows | ✅ |
| a real member can read that channel's messages | ✅ |
| `start_dm()` is race-safe — two concurrent calls resolve to one conversation id | ✅ |
| `start_dm()` between the same pair twice returns the same id (get-or-create) | ✅ |
| a non-participant querying `my_inbox` for someone else's DM gets zero rows | ✅ |
| message content invariant (needs text, an image, or a voice note) holds | ✅ |
| a device's own `push_tokens` row is readable only by that user | ✅ |

*(One real bug found this way: §4.1, `start_dm()`'s RLS-timing failure —
found and fixed before the UI pass, not during it.)*

### 6.2 End to end in the UI, real accounts (10/10, plus a 3rd account for isolation)

Two accounts in two isolated browser contexts, driving the actual app
against the live local stack; a third account for the isolation check
specifically.

| # | Scenario | Result |
|---|---|---|
| 1 | unified inbox lists both Room channels and DMs for both accounts | ✅ |
| 2 | Room channel message sent by A appears live for B without a reload | ✅ |
| 3 | tapping "Message" on a profile opens/creates a DM (`start_dm`), appears in both inboxes | ✅ |
| 4 | DM message send/receive live, plus a read-receipt checkmark once the recipient opens it | ✅ |
| 5 | typing indicator appears while the other side is typing, clears when they stop | ✅ |
| 6 | reaction (long-press → ❤️) appears live on the other account's screen | ✅ |
| 7 | image attachment: pick → compress → upload → renders in the bubble | ✅ (see §5 for the initial false failure) |
| 8 | voice attachment: record → stop → send → plays back with a duration bar | ✅ (see §5) |
| 9 | reply-to: tap a bubble sets it as the reply target, sent reply shows a quoted preview | ✅ (see §4.3) |
| 10 | a non-member (fresh 3rd account) cannot see or subscribe to a Room's channel — empty inbox, and a raw `my_inbox` query for that channel's id returns zero rows | ✅ |

Console output across every context: zero uncaught errors.

**The exit condition specifically** — "two devices, real-time message
delivery, and a non-member cannot subscribe to a Room's chat channel even
by guessing the channel id" — is scenarios 2/4 for realtime delivery and
scenario 10 for the isolation guarantee, the latter checked at both the
UI level (no "not available" — the Room simply isn't listed) and the
network level (a raw REST query against `my_inbox` filtered to that
conversation id, from the non-member's own authenticated session, returns
zero rows).

### 6.3 What was not covered

Stated plainly rather than left to inference: actual push notification
*delivery* (blocked on the EAS project id step, §2.7 — the send-side
Edge Function itself was verified directly, by inserting a message via
SQL and confirming the function ran and returned `{"ok":true}` from
`docker logs`/`net._http_response`, just not the device-receipt half);
`npm ci` passing confirms no lockfile drift but isn't itself a functional
test; and, as with every phase so far, native iOS/Android — this
verification pass was web-only, so `expo-audio`'s recording path and the
native image picker are reasoned-and-typechecked against the versioned
docs but not yet exercised on a device.

**Update, 2026-09-01:** the native gap above is closed for Android. First
real-device run, on a physical Galaxy A14 via USB + `adb reverse` — see
decision-log, 2026-09-01. `expo-audio` voice recording confirmed working
end to end (record → stop → send → playback). The EAS project id step is
done, and a real device surfaced that Android push also needs
Firebase/FCM configured (`google-services.json`) — not covered by the
2026-08-15 entry's assumption that dev-client builds don't need it — now
fixed, with a real `ExponentPushToken` confirmed registering in
`push_tokens` on login. Two bugs invisible to every prior web-only pass
also surfaced this way: a Room-list duplicate-key bug and the Chats
list's missing live subscription, both fixed (decision-log, 2026-09-01).
Still open: push *delivery* specifically to a backgrounded/locked device,
and the native image picker. iOS remains entirely unexercised on real
hardware.

## 7. Concepts worth knowing before Phase 7

- **The RETURNING/RLS-timing bug is a *class*, not a one-off** — this is
  the third time in this project an `INSERT ... RETURNING` (or
  `.select().single()` immediately after an insert) failed because a
  same-statement SELECT-policy recheck couldn't see an `AFTER INSERT`
  trigger's own effects yet. The fix is always the same shape: widen the
  relevant SELECT policy to admit the row's obvious rightful viewer
  directly, not restructure the client into two round trips.
- **An `inverted` `FlatList`'s DOM order is not its visual order** — the
  first element in the DOM is the newest item, not the topmost on
  screen. Any test locator (or app logic) that assumes "first in the DOM"
  means "first visually" in an inverted list will be wrong exactly when
  it matters least obviously — once there's more than one matching
  element.
- **A `Pressable` claims a gesture it has no handler for.** One with only
  `onLongPress` still intercepts a plain tap meant for a parent's
  `onPress` — nesting two Pressables where one owns each gesture is not
  a safe way to combine tap and long-press; put both handlers on one.
- **A failing test needs a more surprising explanation before you
  believe it's a real bug** — §4.3, §4.6, and §5 are three unrelated
  instances of exactly the same discipline this project's decision log
  has already named once (Phase 2's tampered-token entry): confirm the
  test is actually testing what it claims before concluding the code is
  broken, especially when the "bug" would mean a headline feature is
  completely non-functional.
- **`security_invoker = true` on a view isn't optional if the view spans
  RLS-protected tables** — without it, a view runs as its creator, and
  every reader inherits the creator's own visibility regardless of who's
  actually asking.

## What's next

**Phase 7 — Stories.** Ephemeral, per-Room image/video content that
expires after 24 hours — including making the expiry actually delete the
underlying storage object, not just hide an expired row, which is the
free-tier storage-cap protection this phase's media pipeline was built to
support.
