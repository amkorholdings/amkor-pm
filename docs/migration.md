# Buildium CSV migration

Import in this order, from the Import page (`/import`): properties → units → people → leases → ledger.
Every row needs a `buildium_id`, so re-running an import is safe. Ledger rows are never updated.
Existing rows are skipped.

## Expected headers (our canonical names)

| File | Required headers | Optional headers |
|---|---|---|
| properties | buildium_id, name, address_line1, city, state, postal_code | address_line2 |
| units | buildium_id, property_buildium_id, unit_number | bedrooms, bathrooms, market_rent |
| people | buildium_id, first_name, last_name | email, phone |
| leases | buildium_id, unit_buildium_id, start_date, monthly_rent | end_date, security_deposit, status, person_buildium_ids |
| ledger | buildium_id, lease_buildium_id, entry_date, entry_type, amount | description |

- `person_buildium_ids` is a semicolon-separated list, for example `1001;1002`.
- `entry_type` must be one of: charge, payment, credit, adjustment, deposit, refund.
- Ledger amounts are signed: positive means the tenant owes, negative means paid or credited.
- Dates may be `YYYY-MM-DD` or `MM/DD/YYYY`.

## Open item

Buildium's real export headers are not yet mapped. Send one sample export per type, and we'll add a
header map so the files import without edits.

## Checks after each import

Compare each lease's balance (`lease_balances` view, or the lease page) with the Buildium lease balance.
Any difference means a row was skipped or mis-linked. Import errors are listed on the Import page.
