import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCsv } from '@/lib/csv';

// Imports Buildium's own CSV exports as downloaded. No edits to the files are needed.
//
// Import order: properties → units → leases → tenants.
//   properties  Buildium "Properties" export (Id, Property name, Address 1, ...)
//   units       Buildium "Rental units" export, one file or per-property files (Id, Property name, Unit, ...)
//   leases      Buildium "Rent roll" export (Account number, Tenants, Unit, Status, Start date, ...)
//   tenants     Buildium "Tenants" export (Id, LeaseId, First name, Last name, ...). Creates people and links them to leases.
//
// Re-running an import is safe: rows are upserted on Buildium IDs.
// Ledger import is not included yet (see docs/migration.md).
export const IMPORT_TYPES = ['properties', 'units', 'leases', 'tenants'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

type Row = Record<string, string>;
export type ImportResult = { imported: number; errors: string[] };

const CHUNK = 500;

function num(v: string | undefined): number | null {
  const cleaned = (v ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Buildium shows counts like "2 Bed" or "1.5 Bath". Returns the number, or null.
function leadingNumber(v: string | undefined): number | null {
  const m = (v ?? '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Accepts M/D/YYYY (Buildium) or YYYY-MM-DD. Returns ISO YYYY-MM-DD or null.
function date(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function parseBuildium(csvText: string): Row[] {
  return parseCsv(csvText.replace(/^﻿/, ''));
}

async function writeChunks(
  records: Record<string, unknown>[],
  write: (chunk: Record<string, unknown>[]) => PromiseLike<{ error: { message: string } | null }>,
) {
  for (let i = 0; i < records.length; i += CHUNK) {
    const { error } = await write(records.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }
}

async function loadAll<T>(supabase: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function runImport(
  supabase: SupabaseClient,
  type: ImportType,
  csvText: string,
): Promise<ImportResult> {
  const rows = parseBuildium(csvText);
  const errors: string[] = [];
  if (rows.length === 0) return { imported: 0, errors: ['The file has no data rows.'] };
  const rowRef = (i: number) => `row ${i + 2}`; // header is line 1
  let imported = 0;

  if (type === 'properties') {
    const records: Record<string, unknown>[] = [];
    rows.forEach((r, i) => {
      if (!r.Id || !r['Property name'] || !r['Address 1'] || !r['City/Locality'] || !r['State/Province'] || !r['Postal code']) {
        errors.push(`${rowRef(i)}: missing Id, Property name, Address 1, City, State or Postal code`);
        return;
      }
      records.push({
        buildium_id: r.Id,
        name: r['Property name'],
        address_line1: r['Address 1'],
        address_line2: r['Address 2'] || null,
        city: r['City/Locality'],
        state: r['State/Province'],
        postal_code: r['Postal code'],
      });
    });
    await writeChunks(records, (c) => supabase.from('properties').upsert(c, { onConflict: 'buildium_id' }));
    imported = records.length;
  }

  if (type === 'units') {
    const props = await loadAll<{ id: string; name: string }>(supabase, 'properties', 'id, name');
    const propByName = new Map(props.map((p) => [p.name, p.id]));
    const records: Record<string, unknown>[] = [];
    rows.forEach((r, i) => {
      const propertyId = propByName.get(r['Property name']);
      if (!r.Id || !r.Unit || !propertyId) {
        errors.push(`${rowRef(i)}: missing Id or Unit, or Property name not found (import properties first)`);
        return;
      }
      records.push({
        buildium_id: r.Id,
        property_id: propertyId,
        unit_number: r.Unit,
        bedrooms: leadingNumber(r.Bedrooms),
        bathrooms: leadingNumber(r.Bathrooms),
        market_rent: num(r['Market rent']),
      });
    });
    await writeChunks(records, (c) => supabase.from('units').upsert(c, { onConflict: 'buildium_id' }));
    imported = records.length;
  }

  if (type === 'leases') {
    const props = await loadAll<{ id: string; name: string }>(supabase, 'properties', 'id, name');
    const propByName = new Map(props.map((p) => [p.name, p.id]));
    const units = await loadAll<{ id: string; property_id: string; unit_number: string }>(
      supabase,
      'units',
      'id, property_id, unit_number',
    );
    const unitByKey = new Map(units.map((u) => [`${u.property_id}|${u.unit_number}`, u.id]));
    const statusMap: Record<string, string> = { Active: 'active', Future: 'pending', Past: 'ended' };
    const records: Record<string, unknown>[] = [];
    rows.forEach((r, i) => {
      // The Unit column reads "Property name - Unit". Split on the first " - " only.
      const sep = (r.Unit ?? '').indexOf(' - ');
      const propName = sep >= 0 ? r.Unit.slice(0, sep) : '';
      const unitNum = sep >= 0 ? r.Unit.slice(sep + 3) : '';
      const propertyId = propByName.get(propName);
      const unitId = propertyId ? unitByKey.get(`${propertyId}|${unitNum}`) : undefined;
      const start = date(r['Start date']);
      const status = statusMap[r.Status];
      if (!r['Account number'] || !unitId || !start || !status) {
        errors.push(`${rowRef(i)}: missing Account number, unknown unit "${r.Unit}", bad Start date, or unknown Status "${r.Status}"`);
        return;
      }
      records.push({
        buildium_id: r['Account number'],
        unit_id: unitId,
        start_date: start,
        end_date: date(r['End date']),
        monthly_rent: num(r.Rent) ?? 0,
        security_deposit: 0, // not in the rent roll export; set when known
        status,
      });
    });
    await writeChunks(records, (c) => supabase.from('leases').upsert(c, { onConflict: 'buildium_id' }));
    imported = records.length;
  }

  if (type === 'tenants') {
    // One person per Buildium tenant Id. The same person can appear on several leases.
    const people = new Map<string, Record<string, unknown>>();
    rows.forEach((r, i) => {
      if (!r.Id || !r['First name'] || !r['Last name']) {
        errors.push(`${rowRef(i)}: missing Id, First name or Last name`);
        return;
      }
      if (!people.has(r.Id)) {
        people.set(r.Id, {
          buildium_id: r.Id,
          first_name: r['First name'],
          last_name: r['Last name'],
          email: r['Login email'] || r['Alternate email'] || null,
          phone: r.Mobile || r['Home phone'] || null,
        });
      }
    });
    await writeChunks([...people.values()], (c) => supabase.from('people').upsert(c, { onConflict: 'buildium_id' }));

    // Link each person to their lease. LeaseId is Buildium's lease ID (matches Account number in the rent roll).
    const leases = await loadAll<{ id: string; buildium_id: string }>(supabase, 'leases', 'id, buildium_id');
    const leaseByBuildium = new Map(leases.map((l) => [l.buildium_id, l.id]));
    const personRows = await loadAll<{ id: string; buildium_id: string }>(supabase, 'people', 'id, buildium_id');
    const personByBuildium = new Map(personRows.map((p) => [p.buildium_id, p.id]));
    const links: Record<string, unknown>[] = [];
    rows.forEach((r, i) => {
      if (!r.Id || !r.LeaseId) return;
      const leaseId = leaseByBuildium.get(r.LeaseId);
      const personId = personByBuildium.get(r.Id);
      if (!leaseId || !personId) {
        errors.push(`${rowRef(i)}: lease ${r.LeaseId} not found (import leases first)`);
        return;
      }
      links.push({ lease_id: leaseId, person_id: personId, role: 'tenant' });
    });
    await writeChunks(links, (c) =>
      supabase.from('lease_people').upsert(c, { onConflict: 'lease_id,person_id', ignoreDuplicates: true }),
    );
    imported = people.size;
  }

  return { imported, errors: errors.slice(0, 50) };
}
