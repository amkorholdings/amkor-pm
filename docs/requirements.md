# Requirements (from Eric's stated priorities)

- Replace Buildium, which currently has no API and whose next tier is too costly.
- Store of record for all property, unit, tenant, lease, and money data.
- Agents must be able to read and change all data through an API.
- Listing syndication to Zillow, Rent.com, Zumper, Facebook, and other free sites.
- Receive rent payments:
  - Card and ACH through Stripe (tenant portal → Stripe Checkout).
  - Cash, money order, or cashier's check deposited into the bank account of the tenant's unit. Every rentable
    unit has its own bank account, and its account number is the unit's deposit number. Deposits can be made at
    any Truliant Federal Credit Union branch or any CO-OP Shared Branch credit union.
  - Plaid pulls the unit accounts' deposits every morning at 5am (Charlotte time) and posts them to the ledger.
    Any bank Plaid supports works, so the unit accounts can move off Truliant later.
- Tenant ledger visible to tenants, plus an easy web UI for tenant profile and payment details.
- Owner and tenant sides.
- Evictions must be fully hands-off (handled by the eviction service, not this app's core).
- Existing data migrated from Buildium CSV exports.
