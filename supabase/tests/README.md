# Backend checks

Scripts that exercise the local Supabase stack as real accounts. There is
no test runner; each is run by hand with `node`, against `supabase start`
with the seed data loaded (`docs/running-locally.md`). They use the seed
accounts (password `password123`) and the local stack's well-known demo
keys, so they only ever work against a local stack.

Started in Phase 10 (2026-10-02). The checks written for earlier phases
were run once and never kept; Phase 10's slice 7 gathers what follows into
one re-runnable security sweep.

| Script | What it proves | Leaves behind |
|---|---|---|
| `phase10_slice2_suite.js` | Prints SQL. 52 checks that every function the app calls still works, the membership helpers answer only about the caller, and non-members read nothing. Runs as each account the way PostgREST would, in one transaction. | Nothing: it rolls back, and no push is sent. |
| `phase10_slice2_live.js` | 19 checks over the real API for what a transaction can't cover: signup, the `room-membership` and `delete-account` Edge Functions, uploading to and signing from storage. | A Room `zz-live2` and one Mailpit email. Delete both afterwards. |
| `phase10_slice3_suite.js` | Prints SQL. 50 checks: a DM can only be opened through `start_dm()`, sub-groups only through the service role, timestamps on likes, reactions, hidden posts and push tokens come from the server, unused grants are gone, and every direct write the app makes still works. | Nothing: it rolls back. |
| `phase10_slice3_live.js` | 21 checks over the real API: the direct DM and sub-group writes are refused, friends can DM, sub-groups work through the Edge Function. | A Room `zz-live3`, one DM between tobi and kwame, and two friend notifications. Delete them afterwards. |
| `phase10_slice4_suite.js` | Prints SQL. 42 checks: the two post functions still make every kind of post, the server applies the 10-media and 4-option limits and checks media paths, nothing can be attached or changed around the functions, and who may post is who could before (member, moderators-only Room, pending, removed, outsider, signed out). | Nothing: it rolls back. |
| `phase10_slice5_suite.js` | Prints SQL. 26 checks: the `profiles` table gives out names but not bio, banner or last active (not to select, filter or sort by), `get_profile()` returns them and blanks them between blocked people in both directions, and everything that shows a name still reads it. | Nothing: it rolls back. |
| `phase10_slice6_suite.js` | Prints SQL. 61 checks: every text limit (the limit accepted, one more refused), every rate limit (the last allowed, the next refused, someone else and the service role unaffected), the daily message cap, the 50-file upload allowance, the counters closed to clients, and which notifications and stored files the cleanup jobs take. | Nothing: it rolls back. |
| `phase10_slice6_live.js` | 16 checks over the real API: the verification email's limit and that it leaves the earlier link working, a 26 MB video refused, 50 real uploads and the 51st refused in any bucket, the allowance back after deleting, the 11th comment in a minute as the app sees it. | A Room `zz-live6`, one Mailpit email, rate-limit counters. Clean up afterwards. |

`sqlsuite.js` is the shared builder for the SQL suites: `as('tobi')` to
become an account, `check`, `refused` (with the reason it must be refused
for) and `allowed`.

```bash
# from the repo root
node supabase/tests/phase10_slice2_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
node supabase/tests/phase10_slice2_live.js
node supabase/tests/phase10_slice3_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
node supabase/tests/phase10_slice3_live.js
node supabase/tests/phase10_slice4_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
node supabase/tests/phase10_slice5_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
node supabase/tests/phase10_slice6_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
node supabase/tests/phase10_slice6_live.js
```

**The live scripts are rate-limited like anyone else** (since slice 6).
They sign in as seed accounts and create Rooms, and a person can create 5
Rooms a day, so a third or fourth run in one day is refused with "You're
doing that too often." unless the counters are cleared first (the last
line of the cleanup below). The SQL suites aren't affected: their counts
roll back with their transaction.

A SQL suite's transaction has one `now()`, so everything in it falls in
the same minute, hour and day. That is what lets a suite reach "the 31st
message this minute" without waiting.

Cleaning up after the live scripts (as the database owner):

```sql
delete from rooms where slug like 'zz-live%';
delete from conversations where kind = 'dm' and dm_user_a = '22222222-2222-2222-2222-222222222222' and dm_user_b = '44444444-4444-4444-4444-444444444444';
delete from notifications where type in ('friend_request', 'friend_accept') and created_at > now() - interval '1 hour';
delete from rate_limit_counters;
```

Emails land in Mailpit (http://127.0.0.1:54324); delete them there. A
test file left in storage with nothing pointing at it is removed by the
daily `cleanup-unused-media` job once it is a day old.

A check prints `PASS` or `FAIL`. A refusal prints the reason it was
refused, because a refusal for the wrong reason is a failure that looks
like a pass.
