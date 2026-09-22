# Phase 9 — Trust & safety

> Study-book style: what exists, why each call was made, how the code
> works, and what went wrong along the way. This is the phase the app
> stores check for a user-generated-content app: report, block, act on
> reports, filter, publish rules and a contact, and let people delete
> their account. It was built in six slices. Before each one, the plan
> went to the user and their decisions shaped it. Each was verified
> against the live local stack, with direct API calls as real users, the
> real app, and the Galaxy A14.
>
> One principle runs through all of it: the anon key ships inside every
> build, so anything enforced only by the app protects nobody. Every rule
> here lives in the database or an Edge Function.
>
> The phase also turned up two app-wide problems and one security hole,
> none of them trust-and-safety features:
> - CI had silently failed for two weeks
> - no database error message had ever reached a screen
> - the push functions trust any caller

**Goal:** the things that get a UGC app rejected if missing.
**Exit condition (from `docs/roadmap.md`):** you could pass an App Store
UGC review today, checked with three accounts at once (blocker, blocked,
bystander) and with direct API calls, not only through the UI.
**Status:** done, 2026-09-21 to 2026-09-22. Six slices.
- **Every slice with server-side rules** was verified with direct-API
  checks that confirm the *reason* for each refusal.
- **Every slice** was checked in the app. Slice 5 had no server-side
  rules, so it was UI and phone only.
- **Known limits** are listed in
  [§5.1](#51-known-limits-and-what-was-not-covered).

---

## 1. What this phase produced

```
supabase/migrations/
├── 20260921100000_block_enforcement.sql           blocks in RLS, both ways; block_user(); DM/friend/notification triggers
├── 20260921110000_moderation_enum_values.sql      enum values, in their own transaction
├── 20260921110100_moderation_tools.sql            can_remove_content(); remove_comment/message/story(); delete_post() rewritten
├── 20260921120000_report_enum_values.sql
├── 20260921120100_reports.sql                     app_admins, account_suspensions, report snapshots, resolve_report()
├── 20260922110000_content_filter.sql              blocked_terms, normalization, a trigger on every text column
└── 20260922120000_account_deletion.sql            room_successor(), preview, storage paths, delete_account_data()

supabase/functions/
├── moderate/index.ts          app admins: suspend, unsuspend, sign a report's media
├── delete-account/index.ts    delete your own account, or (app admins) one requested by email
└── notify-activity/index.ts   gained report_filed, and high priority

mobile/src/
├── lib/blocks.ts, moderation.ts, reports.ts, account.ts, support.ts, errors.ts
├── constants/contact.ts                         SUPPORT_EMAIL
├── components/ReportSheet.tsx                   one report flow for six kinds of thing
├── app/u/[userId]/blocked.tsx                   Settings → Blocked
├── app/c/[communityId]/moderation.tsx           a Room's moderation log
├── app/admin/reports.tsx                        app admins: Open / Resolved / Suspended
├── app/admin/delete-account.tsx                 app admins: requests sent by email
├── app/guidelines.tsx                           community guidelines, readable signed out
└── app/u/[userId]/delete-account.tsx            Settings → Delete account
```

Also shipped while Phase 9 was in progress, but not trust and safety:
- Room pictures on Home and in Chats (`20260922100000`)
- push at high priority
- the CI fix
- the app-wide error-message fix (§2.6)

---

## 2. Decisions, and the reasoning behind each

The user's decisions, made during planning:

| Question | Chosen |
|---|---|
| Room group chats when you block someone | Their messages collapse to "Message from someone you blocked" on *your* device only |
| Deleting an account | Delete all of their content |
| How reports reach the developer | Push plus an in-app screen (not email) |
| Content that matches the filter | Refuse it |
| What the filter covers | Severe terms only: slurs and child-sexual-abuse terms |
| Contact address | `info.chasien@gmail.com`, a dedicated inbox |
| A deleted owner's Rooms | Pass to the next role down: admin, then mod, then member |
| DMs and replies on deletion | Accepted as they already worked: a DM goes for both people; replies go with what they reply to |
| Reports and the moderation log on deletion | Kept, as safety records |
| Emailed deletion requests | Handled within 30 days |

### 2.1 Blocking lives in RLS, in both directions

The blocker not seeing the blocked person is a convenience. The blocked
person not seeing the blocker is the actual safety feature, and that side
runs on a client the blocked person controls. So:
- **Posts, comments, stories and likes** are hidden both ways by one
  clause added to each SELECT policy (§3.1).
- **DMs, DM reactions and friend requests** between blocked people are
  refused by triggers.
- **Notifications** between them are dropped before they're inserted,
  which stops the push too.
- **`block_user()`** does the block and its side effects atomically: it
  ends the friendship or pending request, removes tags between them, and
  clears their notifications about each other.

Room group chats are the deliberate exception, and profiles stay readable
because names appear wherever a Room's members are listed.

### 2.2 One rank rule for every removal

Before this phase a Room's owner could remove posts, and that was all.
Comments and messages couldn't be removed by anyone, including their
authors: their UPDATE policies had had no granted columns since the
2026-09-16 column lockdown. Now one function decides:

```sql
select coalesce(p_actor = p_author, false)
  or (is_room_moderator(p_room_id, p_actor) and room_rank(p_room_id, p_actor) > room_rank(p_room_id, p_author))
  or is_app_admin(p_actor);
```

You can always remove your own content. Otherwise you must strictly
outrank the author in that Room: the same rule the Edge Function already
used for kicking and muting. The last line (app admins, anywhere) came in
Slice 3. Every removal is a `SECURITY DEFINER` function that soft-deletes
and logs to `moderation_actions`, which clients can't write at all.
Stories are removed by *expiring* them, so Phase 7's hourly job takes
their files too.

### 2.3 Reports go to app admins, with the server's own evidence

**App admins:** reports go to the developer, not a Room's mods, because
the Room's owner may be the person reported. `app_admins` can't be read or
written by clients at all. You become one only through SQL with the
service role, and `@thenuja` is one locally.

**Notifying them:** each report writes a `report_filed` notification for
every app admin:
- it has no actor, so a push never names the reporter
- because there's no actor, the block trigger can't swallow it
- its data holds only ids and the reason, never the reported content

**The evidence:** a `BEFORE INSERT` trigger captures `content_snapshot`
when the report is filed: the text, the media paths, the author and the
Room. Clients can't supply one. Names are copied in, because the admin
usually isn't a member and the author may delete their account before
review.

**Only what you can see:** target validation still runs *as the
reporter*, so nobody can report something in a Room they're not in.

**Acting:** remove the content, suspend the account, or dismiss. A
suspension is a Supabase Auth ban plus a row in an admin-only
`account_suspensions` table. The row is written first, so there's never a
ban without a record an admin can see and lift. Reported media is signed
for the admin by the `moderate` function, and only paths from that
report's snapshot.

### 2.4 The content filter refuses, in the database

A `blocked_terms` list is checked by a trigger on every column people type
into:
- posts, comments and messages
- story captions, polls and events
- Rooms, sub-groups and profiles

Signup gets its own check. Because it's a trigger, it holds for the app,
for RPCs, and for the Edge Function that creates sub-groups. Report
details are deliberately not filtered, since a reporter may need to quote
what they're reporting.

**Matching:**
- **Text is normalized first:** case, accents, zero-width characters,
  look-alike Cyrillic and Greek letters, leetspeak, and letters split by
  spaces or dots.
- **Then matched as whole words,** so "Niger", "Scunthorpe" and
  "flame retardant" pass.
- **Words that are also everyday words are left off** ("a chink in the
  armour", "kaffir lime"). The migration lists them.
- **An edit only checks the columns that changed,** so re-saving a form
  with an old field left as it was still works.

### 2.5 Guidelines and a contact address, reachable before signing in

`app/guidelines.tsx` holds the zero-tolerance line Apple asks for, and
only describes what the app actually does. The signed-out gate allows
`/guidelines`, so signup can link to it before an account exists.
`info.chasien@gmail.com` is one constant, shown in three places:
- Settings → Contact us
- the guidelines
- the message a suspended account now sees at login

That message used to be "Wrong email or password."

### 2.6 Messages written for people reach the screen

Found while building the filter: supabase-js returns a failed query's
error as a **plain object**, not an `Error`. `lib/` rethrew it, and every
screen checked `e instanceof Error`. So all 85 places showed their generic
fallback for every database error, including the messages Slices 1–3 had
written on purpose. The rule now:

```ts
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (errorCode(e) === 'P0001') {
    const { message } = e as { message?: unknown };
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}
```

`P0001` is what `raise exception` produces when no custom code is given.
So SQL written for people raises without an errcode, and permission, RLS
and constraint wording never reaches the screen.

### 2.7 Deleting an account, for real

Run by the `delete-account` Edge Function, in this order:
1. **List the files,** while the Rooms and conversations they live in
   still exist.
2. **One transaction:** hand over or delete owned Rooms, then delete the
   person's posts, comments, messages and stories. Their foreign keys are
   SET NULL, which is why the app used to show "Deleted user".
3. **Delete the Auth user,** whose cascade removes likes, memberships,
   friendships, blocks, notifications, push tokens and DMs.
4. **Remove the files,** last, so nothing points at a file that's already
   gone. A retry is safe, because step 2 finds nothing left to do.

**Who takes over a Room:** `room_successor()` is the one rule. The
existing owner-leaves trigger now calls it, and so does the preview the
person sees ("Uchihas: goes to @realthenuja"), so the two can't disagree.

**A fresh password:** deleting your own account needs the password
entered in the last 5 minutes. Checked before relying on it: the
access token's `amr` claim records when the password was entered, and a
token refresh keeps that time.

**Without the app:** app admins handle emailed requests from Settings →
Delete an account, which finds the account by email.

---

## 3. Code walkthrough

### 3.1 A block is one clause in a policy

```sql
alter policy "room members can read posts, minus soft-deleted content" on posts
using (
  is_room_member(room_id, auth.uid())
  and (deleted_at is null or author_id = auth.uid() or is_room_moderator(room_id, auth.uid()))
  and not is_blocked_with(author_id)
);
```

Each policy keeps its old expression and adds one line. Room membership
stays first, because it's the line between Rooms and nothing here should
loosen it. A consequence worth knowing: the INSERT policies on comments
and likes look the post up through a subquery on `posts`, which is itself
under RLS. So once a post is hidden from you, you can't comment on it or
like it either, with no extra rule. That was verified, not assumed.

### 3.2 Two helpers, so nobody can probe other people's blocks

`blocked_pair(a, b)` answers about *any* two users. If it were callable,
anyone could ask whether two strangers had blocked each other. So it
isn't callable, and policies use a caller-only wrapper:

```sql
create function is_blocked_with(p_other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select blocked_pair(auth.uid(), p_other);
$$;
```

The same shape recurs through the phase: `is_app_admin(user)` is internal
while `current_user_is_app_admin()` is public, `room_successor()` is
internal while `account_deletion_preview()` is public, and so on.

### 3.3 The snapshot trigger, and why its order matters

Postgres runs a table's `BEFORE` triggers in name order.
`capture_report_snapshot` (SECURITY DEFINER, sees everything) runs
*before* `validate_report_target` (runs as the reporter). That's safe only
because the snapshot never raises an error about the target's contents:
- if the reporter can't see the target, validation then aborts the insert
- the snapshot is simply thrown away

The migration's comment first claimed the opposite order. The mistake was
found while writing the decision log, and the comment now says why the
real order is safe, and warns against adding such an error.

### 3.4 How the filter matches

Each term becomes a regex, one run of letters at a time:

```sql
if left(v_run, 1) = ' ' then
  v_out := v_out || ' ?';
elsif length(v_run) = 1 then
  v_out := v_out || v_run || '+';
else
  v_out := v_out || left(v_run, 1) || '{' || length(v_run) || ',}';
end if;
```

A single letter may be stretched ("niiiice"), a doubled one must stay at
least doubled (so the term with "gg" can't match "Niger"), and a space
between words is optional ("child porn" and "childporn"). The terms are
then joined into one regex with word boundaries and optional plural
endings:

```sql
select '\m(?:' || string_agg(pattern, '|') || ')(?:s|es|z)?\M' into v_pattern from blocked_terms;
```

### 3.5 Requiring a fresh password without trusting the app

```ts
function passwordEnteredRecently(accessToken: string): boolean {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const entry = (payload.amr ?? []).find((a: { method?: string }) => a.method === 'password');
    return !!entry && Date.now() / 1000 - Number(entry.timestamp) <= REAUTH_WINDOW_SECONDS;
  } catch {
    return false;
  }
}
```

It only runs after `getUser()` has validated the token, so its claims can
be trusted. The app signs in again with the password right before
calling.

---

## 4. Bugs and findings

| What | Slice | How it was found | Outcome |
|---|---|---|---|
| A test passed for the wrong reason (a column-grant error, not the block) | 1 | Printing each refusal's reason | Every test since checks the reason, not just that it failed |
| A test's `block_user()` deleted 15 real seed notifications | 1 | Counting rows after the run | Not restorable. Every destructive test since backs up first and restores surgically |
| The profile's Unblock button collapsed; "Active now" showed between blocked people | 1 | Screenshots | Fixed |
| Comments and messages couldn't be removed by anyone, even authors | 2 | Planning | `remove_comment()`, `remove_message()` |
| `delete_post()` skipped the log when the author was deleted (`<>` against null) | 2 | A test | `is distinct from` |
| A DM refusal said "members below your role"; DMs have no roles | 2 | Checking reasons | Its own message |
| The signed media URL pointed at `http://kong:8000`, inside Docker | 3 | Fetching the URL | The function returns the path; the app adds its own address |
| The report sheet's Done button shrank to its label | 3 | A screenshot | `alignSelf: 'stretch'` |
| The snapshot trigger's comment claimed the wrong order | 3 | Writing the decision log | Comment corrected, with a warning (§3.3) |
| Pushes never arrived | — | Tracing each hop to Google | The phone was offline; the app worked over the USB tunnel |
| Pushes were delayed while the phone was locked | — | Forced Doze on the A14 | `priority: 'high'`: undelivered after 60 s at normal, delivered within 5 s at high |
| CI failed at `npm ci` for two weeks | — | Checking a run after a push | The lock file was regenerated with a current npm (npm 11.6 drops two entries) |
| The push functions trust any caller with the anon key | — | Reading the code, then proving it harmlessly | On Phase 10's list, due before hosting |
| No database error message ever reached a screen | 4 | The filter's message didn't show | `errorMessage()` everywhere (§2.6) |
| A soft hyphen slipped through the filter | 4 | A test | Invisible characters stripped before `unaccent()` |
| The migration file contained invisible characters | 4 | Reading it back | Restored to escape codes |
| A suspended account was told "Wrong email or password." | 5 | Planning | It's told it's suspended, and where to appeal |
| The React Compiler skipped two components written this phase (story viewer, report sheet) | 2–3 | `check:compiler` | Rewritten before commit |
| A test run left three files behind after failing part-way | 6 | Row and file counts before/after | Removed; test cleanup now finds files with `account_storage_paths()` |

---

## 5. Verification: what was actually tested

| Slice | Direct API (reasons checked) | In the app (Expo web) | Also |
|---|---|---|---|
| 1. Blocking | 47, including the Room isolation checks again | 21 | Blocker, blocked and bystander at once (Mara, Tobi, Nadia), plus an outsider for isolation |
| 2. Moderation tools | 41, on a full role ladder | 28 | |
| 3. Reports | 42 (database) + 22 (`moderate`) | 34 | Suspension only on throwaway accounts |
| 4. Content filter | 29: 21 evasions caught, 36 innocent phrases passed | 15 | The migration re-run from scratch in a rolled-back transaction |
| 5. Guidelines & contact | | 13 | On the A14: the screen, and Gmail opening addressed correctly |
| 6. Account deletion | 52 + 4 on the password rule (after a real 5-minute wait) | 16 | On the A14, view only |
| Push priority | | | Forced deep idle on the A14, before and after |

How the testing was run:
- **Destructive tests used throwaway accounts,** never seed accounts
  (except where a seed account was the subject, with a backup taken).
- **Push was paused for every run** and confirmed back on afterwards,
  because test inserts could otherwise push to a real phone.
- **Row, file and log counts were compared** before and after every run.
- **Screenshots were reviewed by eye,** because text checks pass straight
  over layout bugs.

### 5.1 Known limits, and what was not covered

- **Between blocked people, profiles are readable through the API,**
  including bio and last-active time. The screens hide them. Phase 10.
- **A removed chat message** stays on other people's screens until they
  reopen the chat.
- **A suspension** stops sign-in and refresh straight away, but an access
  token already issued keeps working for up to an hour. Supabase also
  answers "banned" even to a wrong password, so an email's suspension is
  discoverable.
- **Suspending doesn't remove the person's other content.** Account
  deletion does.
- **A reported story's media** is deleted when the story expires. The
  snapshot keeps the caption.
- **A whole Room can't be taken down.** A Room report can be dismissed,
  or its owner suspended.
- **The push functions and the story-cleanup job** accept calls from
  anyone with the anon key. Phase 10, before hosting.
- **The account-deletion page** needs a public URL. That comes with the
  download page in the APK Beta Phase.
- **No app admin exists on a hosted project yet.** Add one when Phase 11
  creates it.
- **iOS** remains untested on real hardware.

---

## 6. Concepts worth knowing before Phase 10

- **The client is not a security boundary.** Anything that must hold is a
  policy, a trigger or a server function.
- **Check why something was refused,** not just that it was. A refusal
  for the wrong reason hides a hole.
- **Internal helper, caller-only wrapper.** A function that answers about
  anyone stays uncallable; the public one answers only about the caller.
- **Trigger order is by name.** If one `BEFORE` trigger must run first,
  either name it so or make the others safe in any order.
- **Keep a pointer to whatever you still have to delete.** Phase 7 deletes
  a story's file *before* its row, because the row is the only pointer to
  the file. Account deletion removes files *last*, because it collected
  their paths first. Same rule, opposite order.
- **Errors meant for people need a convention.** Here it's `P0001` plus
  `errorMessage()`.

---

## What's next

Phase 10 — Hardening. It starts with the push functions: the database's
webhooks should send a secret those functions check, before the backend
is hosted in Phase 11.
