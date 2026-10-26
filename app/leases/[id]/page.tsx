import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { addLedgerEntry, ENTRY_TYPES, type EntryType } from '@/lib/ledger';
import { Shell } from '@/components/Shell';

export default async function LeasePage({ params }: { params: { id: string } }) {
  const { supabase } = await requireStaff();
  const { data: lease } = await supabase
    .from('leases')
    .select(
      'id, start_date, end_date, monthly_rent, security_deposit, status, units(unit_number, properties(name)), lease_people(role, people(first_name, last_name))',
    )
    .eq('id', params.id)
    .maybeSingle();
  if (!lease) notFound();

  const { data: entries } = await supabase
    .from('ledger_entries')
    .select('id, entry_date, entry_type, description, amount')
    .eq('lease_id', params.id)
    .order('entry_date')
    .order('created_at');

  const balance = (entries ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
  const unit = lease.units as unknown as { unit_number: string; properties: { name: string } };
  const tenants = (lease.lease_people ?? []).map(
    (lp) => {
      const p = lp.people as unknown as { first_name: string; last_name: string };
      return `${p.first_name} ${p.last_name}`;
    },
  );

  async function addEntry(formData: FormData) {
    'use server';
    const { supabase } = await requireStaff();
    await addLedgerEntry(supabase, {
      lease_id: params.id,
      entry_date: String(formData.get('entry_date')),
      entry_type: String(formData.get('entry_type')) as EntryType,
      description: String(formData.get('description') ?? '') || null,
      amount: Number(formData.get('amount')),
    });
    revalidatePath(`/leases/${params.id}`);
  }

  return (
    <Shell title={`${unit.properties.name} · Unit ${unit.unit_number}`}>
      <p>
        Tenant{tenants.length > 1 ? 's' : ''}: {tenants.join(', ')} · Rent ${lease.monthly_rent} ·{' '}
        {lease.start_date} to {lease.end_date ?? 'month to month'} · {lease.status}
      </p>
      <h2>Balance: ${balance.toFixed(2)} {balance > 0 ? '(owed)' : balance < 0 ? '(credit)' : ''}</h2>

      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Date</th>
            <th>Type</th>
            <th>Description</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(entries ?? []).map((e) => (
            <tr key={e.id} style={{ borderTop: '1px solid #eee' }}>
              <td>{e.entry_date}</td>
              <td>{e.entry_type}</td>
              <td>{e.description}</td>
              <td style={{ textAlign: 'right' }}>{Number(e.amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Add ledger entry</h2>
      <p style={{ fontSize: '0.9em' }}>
        Enter charges, payments, and credits as positive amounts. The system applies the sign. Use
        adjustment to correct a mistake. Ledger rows can't be edited or deleted.
      </p>
      <form action={addEntry} style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
        <input name="entry_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
        <select name="entry_type" defaultValue="charge">
          {ENTRY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input name="description" placeholder="Description" />
        <input name="amount" placeholder="Amount" inputMode="decimal" required />
        <button type="submit">Post entry</button>
      </form>
    </Shell>
  );
}
