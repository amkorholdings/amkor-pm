import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCsv } from '@/lib/csv';

// Each import type expects these CSV headers. Every row carries a buildium_id so re-imports are safe.
// Foreign keys are Buildium IDs (for example property_buildium_id) and are resolved to our UUIDs.
//
// NOTE: These header names are our canonical names. Buildium's export headers may differ.
// Once we have a sample export from Buildium, add a header map here.
export const IMPORT_TYPES = ['properties', 'units', 'people', 'leases', 'ledger'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

type Row = Record<string, string>;
export type ImportResult = { imported: number; errors: string[] };

const CHUNK = 500;

function num(v: string): number | null {
  const cleaned = v.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Accepts YYYY-MM-DD or MM/DD/YYYY. Returns null if neither matches.
function date(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

async function lookup(supabase: SupabaseClient, table: string, ids: string[]) {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await supabase
      .from(table)
      .select('id, buildium_id')
      .in('buildium_id', unique.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: string; buildium_id: string }[]) {
      map.set(r.buildium_id, r.id);
    }
  }
  return map;
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

export async function runImport(
  supabase: SupabaseClient,
  type: ImportType,
  csvText: string,
): Promise<ImportResult> {
  const rows: Row[] = parseCsv(csvText);
  const errors: string[] = [];
  if (rows.length === 0) return { imported: 0, errors: ['The file has no data rows.'] };

  // Records are built row by row. Rows that fail validation are reported and skipped.
  const records: Record<string, unknown>[] = [];
  const rowRef = (i: number) => `row ${i + 2}`; // +2: header is line 1, rows are 1-based

  if (type === 'properties') {
    rows.forEach((r, i) => {
      if (!r.buildium_id || !r.name || !r.address_line1 || !r.city || !r.state || !r.postal_code) {
        errors.push(`${rowRef(i)}: missing required field`);
        return;
      }
      records.push({
        buildium_id: r.buildium_id,
        name: r.name,
        address_line1: r.address_line1,
        address_line2: r.address_line2 || null,
        city: r.city,
        state: r.state,
        postal_code: r.postal_code,
      });
    });
    await writeChunks(records, (c) =>
      supabase.from('properties').upsert(c, { onConflict: 'buildium_id' }),
    );
  }

  if (type === 'units') {
    const props = await lookup(supabase, 'properties', rows.map((r) => r.property_buildium_id));
    rows.forEach((r, i) => {
      const propertyId = props.get(r.property_buildium_id);
      if (!r.buildium_id || !r.unit_number || !propertyId) {
        errors.push(`${rowRef(i)}: missing buildium_id, unit_number, or a known property_buildium_id`);
        return;
      }
      records.push({
        buildium_id: r.buildium_id,
        property_id: propertyId,
        unit_number: r.unit_number,
        bedrooms: num(r.bedrooms),
        bathrooms: num(r.bathrooms),
        market_rent: num(r.market_rent),
      });
    });
    await writeChunks(records, (c) => supabase.from('units').upsert(c, { onConflict: 'buildium_id' }));
  }

  if (type === 'people') {
    rows.forEach((r, i) => {
      if (!r.buildium_id || !r.first_name || !r.last_name) {
        errors.push(`${rowRef(i)}: missing buildium_id, first_name, or last_name`);
        return;
      }
      records.push({
        buildium_id: r.buildium_id,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email || null,
        phone: r.phone || null,
      });
    });
    await writeChunks(records, (c) => supabase.from('people').upsert(c, { onConflict: 'buildium_id' }));
  }

  if (type === 'leases') {
    const units = await lookup(supabase, 'units', rows.map((r) => r.unit_buildium_id));
    rows.forEach((r, i) => {
      const unitId = units.get(r.unit_buildium_id);
      const start = date(r.start_date);
      const rent = num(r.monthly_rent);
      if (!r.buildium_id || !unitId || !start || rent === null) {
        errors.push(`${rowRef(i)}: missing buildium_id, known unit_buildium_id, valid start_date, or monthly_rent`);
        return;
      }
      records.push({
        buildium_id: r.buildium_id,
        unit_id: unitId,
        start_date: start,
        end_date: date(r.end_date ?? '') ?? null,
        monthly_rent: rent,
        security_deposit: num(r.security_deposit ?? '') ?? 0,
        status: ['pending', 'active', 'ended'].includes(r.status) ? r.status : 'active',
      });
    });
    await writeChunks(records, (c) => supabase.from('leases').upsert(c, { onConflict: 'buildium_id' }));

    // Link tenants. person_buildium_ids is a semicolon-separated list.
    const leaseIds = await lookup(supabase, 'leases', rows.map((r) => r.buildium_id));
    const allPersonIds = rows.flatMap((r) => (r.person_buildium_ids ?? '').split(';').map((s) => s.trim()));
    const people = await lookup(supabase, 'people', allPersonIds);
    const links: Record<string, unknown>[] = [];
    rows.forEach((r, i) => {
      const leaseId = leaseIds.get(r.buildium_id);
      if (!leaseId) return;
      for (const pid of (r.person_buildium_ids ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
        const personId = people.get(pid);
        if (!personId) {
          errors.push(`${rowRef(i)}: unknown person ${pid}`);
          continue;
        }
        links.push({ lease_id: leaseId, person_id: personId, role: 'tenant' });
      }
    });
    await writeChunks(links, (c) =>
      supabase.from('lease_people').upsert(c, { onConflict: 'lease_id,person_id', ignoreDuplicates: true }),
    );
  }

  if (type === 'ledger') {
    const leases = await lookup(supabase, 'leases', rows.map((r) => r.lease_buildium_id));
    rows.forEach((r, i) => {
      const leaseId = leases.get(r.lease_buildium_id);
      const entryDate = date(r.entry_date);
      const amount = num(r.amount);
      if (!r.buildium_id || !leaseId || !entryDate || amount === null) {
        errors.push(`${rowRef(i)}: missing buildium_id, known lease_buildium_id, valid entry_date, or amount`);
        return;
      }
      if (!['charge', 'payment', 'credit', 'adjustment', 'deposit', 'refund'].includes(r.entry_type)) {
        errors.push(`${rowRef(i)}: unknown entry_type "${r.entry_type}"`);
        return;
      }
      // Amounts from Buildium are already signed (positive = owed), so they are stored as-is.
      records.push({
        buildium_id: r.buildium_id,
        lease_id: leaseId,
        entry_date: entryDate,
        entry_type: r.entry_type,
        description: r.description || null,
        amount,
      });
    });
    // The ledger is append-only: existing rows are skipped, never updated.
    await writeChunks(records, (c) =>
      supabase.from('ledger_entries').upsert(c, { onConflict: 'buildium_id', ignoreDuplicates: true }),
    );
  }

  return { imported: records.length, errors: errors.slice(0, 50) };
}
