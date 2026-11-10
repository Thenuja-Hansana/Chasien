# Chasien — hosting runbook

How the backend goes from `supabase start` on this laptop to a hosted
Supabase project, step by step, so it can be done again from nothing.
Written in Phase 11 (roadmap) and filled in as each step is done for real;
a step marked *(not yet done)* hasn't been run against the hosted project.

**One project, production** (decided 2026-11-10): no separate staging
project. Testers are in Sri Lanka and India, so the region is **Mumbai
(`ap-south-1`)**. Free plan.

**Never run `seed.sql` on it.** Every seeded account's password is
`password123`, and the anon key that reaches them ships inside the app.
`supabase db push` doesn't run seeds unless told to (`--include-seed`);
don't tell it to.

---

## What only Thenuja can do

These need an account or a password, so they're done by hand:
1. Create the supabase.com account and the project (name `chasien`,
   region Mumbai, free plan). Keep the **database password** somewhere
   safe; it's asked for when linking and can't be shown again.
2. Run `npx supabase login` once on this laptop. It opens a browser and
   stores an access token locally.
3. Later: the Resend account, and the DNS records at Namecheap (step 7).

Secrets never go in the chat or in git. They go in
`supabase/.env.hosted` (gitignored), and the CLI reads them from there.

---

## 1. Link this repo to the project *(not yet done)*

```bash
npx supabase link --project-ref <project-ref>
```
The project ref is the `xxxx` in `https://xxxx.supabase.co`. It asks for
the database password. Linking writes only to `supabase/.temp/`, which is
gitignored.

## 2. Push the migrations *(not yet done)*

```bash
npx supabase db push
```
All 90 migrations, in order, exactly as they ran locally. If one fails,
stop and read why before changing anything: a hosted project isn't
guaranteed to behave like `supabase start`. Two to watch:
- `20260815002723` and `20260902100200` created their triggers with
  `supabase_functions.http_request` (Database Webhooks). If that schema
  doesn't exist on the hosted project, enable Database Webhooks in the
  dashboard (Integrations) and push again. `20261110100000` replaces both
  triggers, so nothing depends on it afterwards.
- `pg_cron` and `pg_net` are created by the migrations themselves.

## 3. Tell the database where its Edge Functions are *(not yet done)*

The push triggers and the cleanup jobs read two Vault secrets
(`20261110100000`). In the dashboard's SQL editor:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'edge_functions_url');
select vault.create_secret('<the anon key>', 'edge_functions_key');
```
Use the project's **anon key in its JWT form** (`eyJ…`, under API keys →
legacy keys). The newer `sb_publishable_…` keys aren't JWTs, and the
gateway's JWT check in front of the functions would refuse them; confirm
this when the project exists. Until both are set, pushes and cleanups
only log a warning (`call_edge_function`).

## 4. Deploy the Edge Functions and their secrets *(not yet done)*

```bash
npx supabase functions deploy
npx supabase secrets set --env-file supabase/.env.hosted
```
`deploy` reads `config.toml`, so `verify-room-email` goes up without a
JWT check, like locally, and the other eight keep it. The project supplies
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` itself.
`supabase/.env.hosted` holds the rest:

```
PUBLIC_FUNCTIONS_URL=https://<project-ref>.supabase.co/functions/v1
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<Resend API key>
SMTP_FROM=Chasien <noreply@chasien.com>
```
Port **465** with `SMTP_SECURE=true`: hosted Edge Functions can't open
port 587 (or 25). `PUBLIC_FUNCTIONS_URL` is what domain-verification
emails link to; without it they'd link to `127.0.0.1`.

Then open one real emailed verification link from a mail app with no key
attached. `verify-room-email` answers in plain text, because the hosted
default domain serves an Edge Function's HTML as text.

## 5. Auth settings *(not yet done)*

Auth is configured from `config.toml` (`npx supabase config push`), with
the hosted project's differences in its `[remotes]` block once it exists:
- **Codes, not links** (decided 2026-11-10): signup confirmation and
  password reset send a 6-digit code typed into the app, so there's no
  redirect URL to host and no web page to keep up.
- **Rate limits:** start from the local values. 30 sign-ins or sign-ups
  per 5 minutes per IP, 30 code verifications, 150 refreshes. The emails
  per hour follow the SMTP provider's allowance.
- **Minimum password length** stays 6 (decided 2026-11-10).
- **No signup captcha** for the private beta; revisit before the public
  Play release.

## 6. Make yourself an app admin *(not yet done)*

Sign up in the app against the hosted project, then in the SQL editor:
```sql
insert into app_admins (user_id) select id from auth.users where email = '<your email>';
```
Without this, reports reach nobody.

## 7. Real email: Resend *(not yet done)*

Resend's free plan: 3,000 emails a month, 100 a day (checked
2026-10-08; check again at sign-up). Both kinds of email (Auth's codes and
the domain verification) draw on the same allowance.
1. Create the account, add the domain `chasien.com`.
2. Resend shows DNS records (a DKIM `TXT`, an SPF `TXT` and an `MX` on a
   sending subdomain). Add each in Namecheap → Domain List → `chasien.com`
   → Advanced DNS, exactly as shown, then verify in Resend.
3. Create an API key; put it in `supabase/.env.hosted` as `SMTP_PASS`,
   and in the Auth SMTP settings.

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
  at production.
- Against the hosted project: Phase 2's auth checks by hand (sign up →
  code → log in → refresh → log out → a tampered token refused), a push
  arriving on the phone, a domain-verification email arriving and its
  link joining, and the cleanup jobs' runs in `cron.job_run_details`.
