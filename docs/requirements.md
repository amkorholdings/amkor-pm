# Requirements (from Eric's stated priorities)

- Replace Buildium, which currently has no API and whose next tier is too costly.
- Store of record for all property, unit, tenant, lease, and money data.
- Agents must be able to read and change all data through an API.
- Listing syndication to Zillow, Rent.com, Zumper, Facebook, and other free sites.
- Receive rent payments:
  - Card and ACH through Stripe (tenant portal → Stripe Checkout).
  - Cash, money order, or cashier's check deposited into a bank account tied to the tenant's profile. That
    account number is the tenant's deposit number. Deposits can be made at any Truliant Federal Credit Union
    branch or any CO-OP Shared Branch credit union.
- Tenant ledger visible to tenants, plus an easy web UI for tenant profile and payment details.
- Owner and tenant sides.
- Evictions must be fully hands-off (handled by the eviction service, not this app's core).
- Existing data migrated from Buildium CSV exports.
