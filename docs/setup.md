# Setup

Things only the account owner can do. Steps in order.

## 1. GitHub access

- Install the Claude GitHub App on the `amkorholdings` org, or reconnect GitHub in claude.ai settings,
  so pushes to `amkorholdings/amkor-pm` are allowed.

## 2. Supabase

1. Create a project (free tier is enough to start). Choose a region near Charlotte, NC.
2. Open Project Settings → API. Copy the project URL, anon key, and service role key into the
   environment settings below.
3. Apply the migrations in order in the SQL editor:
   - `supabase/migrations/0001_core_schema.sql`
   - `supabase/migrations/0002_staff_and_policies.sql`
   - `supabase/migrations/0003_payments.sql`
   - `supabase/migrations/0004_bank_feed.sql`
4. Create the first staff user: sign in once through the app (magic link), then in the SQL editor run:
   ```sql
   insert into staff (auth_user_id, name)
   select id, 'Eric' from auth.users where email = 'YOUR_EMAIL';
   ```
   Repeat for anyone else who should have staff access.
5. In Authentication → URL configuration, set the site URL to the Vercel URL and add
   `<site-url>/auth/callback` to the redirect list.

## 3. Vercel

1. Import the GitHub repo `amkorholdings/amkor-pm`.
2. Add environment variables from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AGENT_API_TOKEN` (a long random string; store it in your password manager)
   - `NEXT_PUBLIC_SITE_URL` (the production URL)
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
   - `CRON_SECRET` (a long random string)
3. Deploy.

## 3a. Stripe

1. In Stripe → Settings → Payment methods, turn on Cards and ACH Direct Debit (US bank account).
2. Developers → Webhooks → add an endpoint at `<site-url>/api/stripe/webhook` with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.dispute.created`.
3. Copy the secret key and the webhook signing secret into Vercel (above).

## 3b. Unit bank accounts and Plaid

1. Open one bank account per rentable unit. On each property page, enter each unit's account number as its
   deposit number. Tenants see it in the portal.
2. Create a Plaid account and request Production access with the Transactions product. Put the keys in Vercel.
3. In the app, go to **Bank feed** → **Connect a bank** and sign in to the bank. Accounts whose last four digits
   match one deposit number link to their unit automatically; link the rest by hand on the same page.
4. Schedule the 5am sync in the Supabase SQL editor (enable the `pg_cron` and `pg_net` extensions first). It runs
   at 09:00 and 10:00 UTC; the app only acts on the run that lands at 5am in Charlotte, so daylight saving time
   doesn't move it.
   ```sql
   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
   select cron.schedule('bank-sync', '0 9,10 * * *', $$
     select net.http_post(
       url := '<site-url>/api/cron/bank-sync',
       headers := jsonb_build_object('Authorization',
         'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
       timeout_milliseconds := 120000);
   $$);
   ```
5. To move to another bank later: connect it on **Bank feed**, update the units' deposit numbers, and link
   the new accounts.

## 4. Local run (optional)

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev
```

## 5. Buildium data

Export from Buildium: properties, units, people (tenants), leases, and the ledger. Send a sample of each
export so the header map can be matched to Buildium's columns.

## Still to decide

- **Returned deposits:** a bounced check or money order shows up in the bank feed as money out. The feed
  only posts money in, so record those returns by hand for now.
- **Listing syndication:** Zillow, Rent.com, Zumper, and Facebook don't offer one free API for every
  site. Choose a syndication provider or plan to hit all of them. This is not built.
- **Owner-side statements and tenant notices:** not built.
