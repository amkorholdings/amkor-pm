import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { IMPORT_TYPES, runImport, type ImportType } from '@/lib/import/run';
import { Shell } from '@/components/Shell';

// Import order matters: properties → units → people → leases → ledger.
export default async function ImportPage({
  searchParams,
}: {
  searchParams: { type?: string; imported?: string; errors?: string };
}) {
  async function importCsv(formData: FormData) {
    'use server';
    const { supabase } = await requireStaff();
    const type = String(formData.get('type')) as ImportType;
    const file = formData.get('file');
    if (!IMPORT_TYPES.includes(type)) throw new Error('Unknown import type');
    if (!(file instanceof File)) throw new Error('Choose a CSV file');
    const result = await runImport(supabase, type, await file.text());
    const params = new URLSearchParams({
      type,
      imported: String(result.imported),
      errors: result.errors.slice(0, 10).join(' | '),
    });
    redirect(`/import?${params.toString()}`);
  }

  return (
    <Shell title="Import from Buildium CSV">
      {searchParams.imported !== undefined && (
        <div style={{ marginBottom: '1rem' }}>
          <p>
            Imported {searchParams.imported} {searchParams.type} row(s).
          </p>
          {searchParams.errors && <p style={{ color: 'crimson' }}>{searchParams.errors}</p>}
        </div>
      )}
      <p>
        Import the Buildium CSV exports as downloaded, in this order: properties, units, leases,
        tenants. See <code>docs/migration.md</code>.
      </p>
      <form action={importCsv} style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
        <select name="type" defaultValue="properties">
          {IMPORT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input name="file" type="file" accept=".csv,text/csv" required />
        <button type="submit">Import</button>
      </form>
    </Shell>
  );
}
