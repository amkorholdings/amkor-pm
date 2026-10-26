# amkor-pm (Buildium Clone)

Property management system for Amkor Holdings: owner and tenant sides, built as a
web app on Next.js, Supabase (Postgres + auth + storage), and Vercel.

## Build order

1. **Core records** — owners, properties, units, tenants, leases. (`supabase/migrations/0001_core_schema.sql`)
2. **Tenant ledger** — append-only charges, payments, credits, and adjustments per lease.
3. **Buildium migration** — import from Buildium CSV exports (see `docs/migration.md`).
4. **Tenant portal** — ledger view, payment details, profile.
5. **Payments** — Stripe for card and ACH; in-person deposits by tenant deposit number at Truliant or CO-OP Shared Branch. (`supabase/migrations/0003_payments.sql`)
6. **Listings** — syndicate to Zillow, Rent.com, Zumper, Facebook, and other free sites.

## Local setup

```bash
cp .env.example .env.local   # fill in Supabase values
npm install
npm run dev
```

Apply the schema with the Supabase CLI or paste `supabase/migrations/*.sql` into the SQL editor.

## Layout

- `app/` — Next.js routes
- `lib/supabase/` — Supabase clients (browser and server)
- `supabase/migrations/` — schema, applied in order
- `docs/` — requirements and migration notes
