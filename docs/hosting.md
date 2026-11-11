# Chasien — hosting runbook

How the backend goes from `supabase start` on this laptop to a hosted
Supabase project, step by step, so it can be done again from nothing.
Written in Phase 11 (roadmap) and filled in as each step is done for real;
a step marked *(not yet done)* hasn't been run against the hosted project.

**The project:** `Chasien`, ref **`bihcnyzempsvwhklegkl`**
(`https://bihcnyzempsvwhklegkl.supabase.co`), **Singapore
(`ap-southeast-1`)**, free plan, created 2026-11-11. One project,
production, no staging (decided 2026-11-10). Mumbai was the plan for
testers in Sri Lanka and India; Singapore is the next closest and is what
was created. A first attempt landed in Sydney by mistake and was deleted
while still empty: a project's region can't be changed afterwards.

**Never run `seed.sql` on it,** or the security re-check (`run.js`, which
creates and deletes test accounts). Every seeded account's password is
`password123`. `db push` lists the seeds it would run (`"seeds": []`);
it runs none unless told to (`--include-seed`).

---

## What only Thenuja can do

1. Create the supabase.com account and the project. Keep the **database
   password** in a password manager; it can't be shown again.
2. Log the CLI in, from a real terminal (see "The CLI" below).
3. Put the database password in `supabase/.env.hosted` (gitignored) as
   `SUPABASE_DB_PASSWORD=…`.
4. Anything in the dashboard the CLI can't do (step 2's Database Webhooks,
   step 5's rate limits).
5. The Resend account, and the DNS records at Namecheap (step 7).

Secrets never go in the chat or in git. They go in `supabase/.env.hosted`
and are read from there into the CLI's environment without being printed.

## The CLI (3.1.0), and what's different about it

- **Agent detection.** When it sees an AI agent's environment (`AI_AGENT`,
  `CLAUDECODE`), it answers in JSON and never prompts. `supabase login`
  then refuses to run at all. Logging in worked from a terminal window with
  those variables cleared and `--agent no`. Its login is stored for this
  Windows account, so later commands from anywhere use it.
- **`--remote`.** Commands that can target either stack (`db push`,
  `db query`, `functions deploy`, …) default to the **local** one. Hosted
  needs `--remote`.
- **Writes to production need consent.** In agent mode a hosted write is
  refused unless run with `--yes`, and the CLI asks the agent to ask the
  person first. Read-only SQL runs with `db query --remote --read-only`,
  which needs no consent (and isn't allowed to decrypt Vault).
- **`link` overwrites the local version pins** in `supabase/.temp/` with
  the hosted project's (running-locally.md, gotcha 9): back them up
  before linking and put them back after, or the next local
  `supabase start` downloads new images.

## 1. Link this repo to the project — done 2026-11-11

```bash
export SUPABASE_DB_PASSWORD="$(grep '^SUPABASE_DB_PASSWORD=' supabase/.env.hosted | cut -d= -f2-)"
npx supabase link --project-ref bihcnyzempsvwhklegkl --yes
```
Writes only to `supabase/.temp/` (gitignored). The hosted stack isn't the
local one: Postgres 17.11.0.018 (local 17.6.1.165), PostgREST **v14.18**
(local v16.1, so older), Storage v1.89.13 (local v1.70.3), Auth v2.197.0
(local v2.196.0). Everything was tested against the local versions.

## 2. Push the migrations — done 2026-11-11

```bash
npx supabase db push --remote --dry-run   # lists the 90, and "seeds": []
npx supabase db push --remote --yes
```
It stopped at `20260815002723`: `schema "supabase_functions" does not
exist`. That schema comes with **Database Webhooks**, which a new project
doesn't have: dashboard → Integrations → Database Webhooks → **Install
integration**. The push then resumed from that migration; all 90 applied.
(`20261110100000` replaces the two triggers that needed it.)

Checked read-only afterwards: 90 migrations recorded; both push triggers
call `push_row_to_edge_function`; the four `cron` jobs active; the five
buckets private with their limits (25 MB posts and stories, 10 MB chat,
5 MB pictures); no users.

`npx supabase db advisors --remote`: no errors. Warnings: the 24 + 1
SECURITY DEFINER functions granted on purpose (Phase 10 slice 2); 51
`auth_rls_initplan` and 4 `multiple_permissive_policies` performance
hints; and 4 SECURITY INVOKER functions without a fixed `search_path`
(`set_updated_at`, `validate_polymorphic_content_target`,
`enforce_single_level_comment_replies`, `vote_poll`), a small follow-up.

## 3. Tell the database where its Edge Functions are — done 2026-11-11

The push triggers and the cleanup jobs read two Vault secrets
(`20261110100000`): the functions' URL and the anon key.
```sql
select vault.create_secret('https://bihcnyzempsvwhklegkl.supabase.co/functions/v1', 'edge_functions_url');
select vault.create_secret('<the legacy anon key>', 'edge_functions_key');
```
Run with `db query --remote --yes`, the key fetched with
`npx supabase projects api-keys` straight into the statement. Use the
**legacy anon key** (a JWT, `eyJ…`): the project also has
`sb_publishable_…`/`sb_secret_…` keys, which aren't JWTs, and the
functions' gateway check wants one.

## 4. Deploy the Edge Functions and their secrets — done 2026-11-11 (mail secrets: step 7)

```bash
npx supabase functions deploy --use-api --remote --yes
npx supabase secrets set PUBLIC_FUNCTIONS_URL=https://bihcnyzempsvwhklegkl.supabase.co/functions/v1 --remote --yes
```
`--use-api` bundles on Supabase's side, so Docker isn't needed. All nine
are active; only `verify-room-email` skips the JWT check, from
`config.toml`. Checked over HTTPS: a call to `room-membership` with no key
gets 401, and a bad verification link gets `text/plain` "This
verification link is invalid." The project supplies `SUPABASE_URL` and
its keys itself.

The mail secrets come with Resend (step 7):
```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<Resend API key>
SMTP_FROM=Chasien <noreply@chasien.com>
```
Port **465** with `SMTP_SECURE=true`: hosted Edge Functions can't open
587 (or 25). Set them by name, not with `--env-file supabase/.env.hosted`,
which also holds `SUPABASE_DB_PASSWORD` (names starting `SUPABASE_` are
the platform's own).

## 5. Auth settings *(not yet done: needs step 7 first)*

```bash
npx supabase config diff            # preview
npx supabase config push --yes
```
`config.toml` holds the local settings; its `[remotes.production]` block
(`project_id = "bihcnyzempsvwhklegkl"`) replaces the ones that must
differ on production. Without it, a push would have set a 1-second gap
between emails, a `127.0.0.1` site URL, the local pooler's sizes, and
vector storage. With it, the diff is: the 6-digit code (the project
started at **8**, which the app's code screen doesn't take), the email
subjects and templates, the site URL `https://chasien.com`, and MFA and
SMS confirmations off (the app uses neither).

**Refused on 2026-11-11:** "Email template modification is not available
for free tier projects using the default email provider." Custom
templates need a custom SMTP provider on the free plan, and the push is
all-or-nothing, so nothing in it applied. It goes after step 7. Until
then, a signup would get Supabase's default email (a link, and an
8-digit code), so nobody signs up yet.

Not managed by `config push`, set in the dashboard (Authentication → Rate
Limits) once SMTP is in place: 30 sign-ins or sign-ups per 5 minutes per
IP, 30 code verifications, 150 refreshes, and emails per hour within
Resend's allowance. Minimum password length stays 6; no signup captcha
for the private beta.

## 6. Make yourself an app admin *(not yet done: after step 5)*

Sign up in the app against the hosted project, then:
```sql
insert into app_admins (user_id) select id from auth.users where email = '<your email>';
```
Without this, reports reach nobody.

## 7. Real email: Resend *(not yet done)*

Resend's free plan: 3,000 emails a month, 100 a day (checked
2026-10-08; check again at sign-up). Auth's codes and the domain
verification draw on the same allowance.
1. Create the account, add the domain `chasien.com`.
2. Resend shows DNS records (a DKIM `TXT`, an SPF `TXT` and an `MX` on a
   sending subdomain). Add each in Namecheap → Domain List → `chasien.com`
   → Advanced DNS, exactly as shown, then verify in Resend.
3. Create an API key. It goes in `supabase/.env.hosted`, then into the
   Auth SMTP settings and the function secrets (step 4).

## 8. Point the app at it *(not yet done)*

The app reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
For builds they're EAS environment variables (APK Beta Phase); for a dev
session against the hosted project, a gitignored `mobile/.env` with the
hosted values. Then the phone talks to the hosted project over the real
internet, with no `adb reverse` for `54321`.

## 9. Keeping it alive, and backed up *(not yet done)*

- A free project pauses after about a week without activity. A scheduled
  GitHub Action that makes one request a day keeps it awake.
- Free-tier backups are limited: take a `supabase db dump` regularly once
  real data exists, and keep it off this laptop.

---

## Checking it

- The security re-check, `node supabase/tests/run.js --live`, runs against
  the local stack only; it seeds and deletes test accounts. Don't point it
  at production. On production, use read-only queries and
  `supabase db advisors --remote`.
- Against the hosted project, by hand: Phase 2's auth checks (sign up →
  code → log in → refresh → log out → a tampered token refused), a push
  arriving on the phone, a domain-verification email arriving and its link
  joining, and the cleanup jobs' runs in `cron.job_run_details`.
