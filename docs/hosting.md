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
4. Anything in the dashboard the CLI can't do (step 2's Database
   Webhooks).
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

## 4. Deploy the Edge Functions and their secrets — done 2026-11-11

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

The mail secrets, set 2026-11-11 once Resend had verified the domain
(step 7):
```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<Resend API key>
SMTP_FROM=Chasien <noreply@chasien.com>
```
Port **465** with `SMTP_SECURE=true`: hosted Edge Functions can't open
587 (or 25). Not with `--env-file supabase/.env.hosted`, which also holds
`SUPABASE_DB_PASSWORD` (names starting `SUPABASE_` are the platform's
own): they went in through a temporary file outside the repo holding only
these six, deleted straight after (`secrets set --env-file <it> --remote
--yes`). Not yet checked with a real domain-verification email.

## 5. Auth settings — done 2026-11-11

```bash
export RESEND_API_KEY="$(grep '^RESEND_API_KEY=' supabase/.env.hosted | cut -d= -f2-)"
npx supabase config diff            # preview
npx supabase config push --yes
```
`config.toml` holds the local settings; its `[remotes.production]` block
(`project_id = "bihcnyzempsvwhklegkl"`) replaces the ones that must
differ on production. Without it, a push would have set a 1-second gap
between emails, a `127.0.0.1` site URL, the local pooler's sizes, and
vector storage. It also holds production's SMTP (Resend:
`smtp.resend.com`, port 465, user `resend`, password
`env(RESEND_API_KEY)`, from "Chasien \<noreply@chasien.com\>") and its
emails-per-hour limit. The local stack keeps Mailpit.

The first push, before step 7, was refused: "Email template modification
is not available for free tier projects using the default email
provider." On the free plan custom templates need custom SMTP, and the
push is all-or-nothing.

With SMTP in, the diff was 15 changes: SMTP on; the 6-digit code (the
project started at 8, which the app's code screen doesn't take); the
subjects and the code templates; the site URL `https://chasien.com`;
MFA and SMS confirmations off (the app uses neither); no password rules
beyond the length; 30 emails an hour. After the push, `config diff`
showed no differences. (The SMTP password is masked by the API, so the
diff can't compare it.)

**Rate limits go up with `config push` too** (this runbook used to say
they were dashboard-only). Production already had the local values: 30
sign-ins or sign-ups per 5 minutes per IP, 30 code checks, 150 refreshes.
The emails-per-hour limit only counts once custom SMTP is on, and would
have gone up as the local file's **2**, so
`[remotes.production.auth.rate_limit]` sets 30. Resend caps a day at 100
by itself.

Minimum password length stays 6; no signup captcha for the private beta.

## 6. Make yourself an app admin *(not yet done)*

Sign up in the app against the hosted project (done 2026-11-11: handle
`thenu`, the only account), then:
```sql
insert into app_admins (user_id) select id from auth.users where email = '<your email>';
```
Without this, reports reach nobody.

## 7. Real email: Resend — done 2026-11-11

Resend's free plan: 3,000 emails a month, 100 a day (checked
2026-10-08). Auth's codes and the domain verification draw on the same
allowance.
1. The account, and the domain `chasien.com`, region Tokyo
   (`ap-northeast-1`).
2. The DNS records, in Namecheap → Domain List → `chasien.com` → Advanced
   DNS. Resend's page showed these, not the TXT SPF and MX this runbook
   expected from older docs; copy whatever its page shows:

   | Type | Host | Value |
   |---|---|---|
   | TXT | `resend._domainkey` | the DKIM key (`p=MIGf…`) |
   | CNAME | `send` | `send.forge.rmta.net` |
   | CNAME | `rsend` | `rsend-apne1.forge.rmta.net` |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` |

   Keep the records already there: Namecheap's mail-forwarding MX at the
   root, the GitHub Pages `A` records and the `www` CNAME. **Turn "Enable
   receiving" off** in Resend. It wants an MX at the root, which would
   take mail for chasien.com away from Namecheap's forwarding, and
   nothing in Chasien receives email.

   Check each row against Resend's before saving: on the first try the
   DMARC value went into the DKIM row, and `rsend` was typed `resend`.
   Namecheap's own nameserver (`dns1.registrar-servers.com`) has them at
   once; public resolvers kept a cached "not found" for a while (Google's
   cleared first), and Resend verified within about half an hour.
3. An API key, into `supabase/.env.hosted` as `RESEND_API_KEY=…`. It's
   the SMTP password for Auth (step 5) and for the function (step 4).

Checked: Thenuja signed up on the hosted project with a real Gmail
address; "Your Chasien code" arrived from `noreply@chasien.com`, and the
code confirmed the account.

`noreply@chasien.com` has no inbox. A reply goes to Namecheap's
forwarding, and arrives only if a forwarding rule (`noreply`, or a
catch-all) sends it on, for example to `info.chasien@gmail.com`.

## 8. Point the app at it — a dev session, 2026-11-11 (builds: APK Beta Phase)

The app reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
For builds they're EAS environment variables (APK Beta Phase). For a dev
session against the hosted project: `mobile/.env.development.local`
(gitignored by `.env*.local`) with the hosted URL and the **legacy anon
key**. Expo loads it ahead of `.env.local` (Metro prints `env: load
.env.development.local .env.local`), so deleting it goes back to the
local stack. Start Metro with `--clear` after switching: the values are
baked into the bundle. The phone then reaches the project over its own
internet, so it needs Wi-Fi or data; `adb reverse` is only for Metro's
8081.

## 9. Keeping it alive, and backed up *(keep-alive written 2026-11-26; secrets and backups not yet done)*

- A free project pauses after about a week without activity.
  `.github/workflows/keep-alive.yml` makes one request a day (03:17 UTC):
  it calls `rpc/text_is_allowed`, the one function open without a
  session, so the request reaches the database. If the project doesn't
  answer, the run fails and GitHub emails the repository's owner. To set
  it up:
  1. In GitHub, go to Settings → Secrets and variables → Actions and add
     two repository secrets:
     - `HOSTED_SUPABASE_URL`: `https://bihcnyzempsvwhklegkl.supabase.co`
     - `HOSTED_SUPABASE_ANON_KEY`: the **legacy anon key** (Project
       Settings → API keys), the same one the app uses
  2. Actions → keep-alive → **Run workflow** once. It should log
     `text_is_allowed answered: true`.

  The repository is public, so GitHub turns off scheduled workflows
  after 60 days without a commit. It emails first; turn the workflow
  back on from the Actions tab.
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
