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
| `phase10_slice2_live.js` | 17 checks over the real API for what a transaction can't cover: signup, the `room-membership` and `delete-account` Edge Functions, storage signing. | A Room `zz-live2` and one Mailpit email. Delete both afterwards. |

```bash
# from the repo root
node supabase/tests/phase10_slice2_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
node supabase/tests/phase10_slice2_live.js
```

A check prints `PASS` or `FAIL`. A refusal prints the reason it was
refused, because a refusal for the wrong reason is a failure that looks
like a pass.
