# Buildium CSV migration

Status: not started. Plan:

1. Export from Buildium: properties, units, tenants, leases, and the ledger (transactions).
2. Keep each source row's Buildium ID in the `buildium_id` columns. The schema makes these unique,
   so re-running an import is safe.
3. Load in dependency order: owners → properties → units → people → leases → lease_people → ledger_entries.
4. Ledger imports: keep the original transaction dates. Corrections in Buildium become `adjustment` rows
   that reference the entry they fix.
5. After each import, check that each lease balance in `lease_balances` matches the Buildium lease balance.
