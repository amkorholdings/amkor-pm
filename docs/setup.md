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
3. Deploy.

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

- **Payments:** Which processor will take rent payments (ACH and card), and under which merchant account?
  The ledger already records payments. The processor integration needs that decision first.
- **Listing syndication:** Zillow, Rent.com, Zumper, and Facebook don't offer one free API for every
  site. Choose a syndication provider or plan to hit all of them. This is not built.
- **Owner-side statements and tenant notices:** not built.
