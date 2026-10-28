# Buildium CSV migration

The importer reads Buildium's exports as downloaded. Do not rename columns.
Import in this order from the Import page (`/import`):

1. **properties**: Buildium "Properties" export (Id, Property name, Address 1, City/Locality, State/Province, Postal code).
2. **units**: Buildium "Rental units" export. The combined file or the per-property files both work (Id, Property name, Unit, Bedrooms, Bathrooms, Market rent).
3. **leases**: Buildium "Rent roll" export, all statuses (Account number, Unit, Status, Start date, End date, Rent).
4. **tenants**: Buildium "Tenants" export, all statuses (Id, LeaseId, First name, Last name, emails, phones). Creates people and links them to their leases.

Re-running an import is safe. Each row is upserted on its Buildium ID.

## Status mapping (leases)

| Buildium Status | Our lease status |
|---|---|
| Active | active |
| Future | pending |
| Past | ended |

## Known gaps

- **Ledger is not imported yet.** The Buildium "Transaction detail by account" export carries a `leaseId` on each line, so it can be linked. Before importing it, we need to decide which lines make up each tenant's balance, because the export is double-entry (each journal has two lines). Check the result against Buildium's lease balances.
- **Security deposits** are not in the rent roll export and are set to 0 for now.
- Lease-to-unit matching splits the rent roll's Unit column on the first " - ". Property names must not contain " - ".

## Checks after each import

Compare the number of units, leases and people with the Buildium exports. Import errors are listed on the Import page (first 10 are shown).
