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
      'id, start_date, end_date, monthly_rent, security_deposit, status, units(unit_number, properties(name)), lease_people(role, people(id, first_name, last_name, deposit_accounts(account_number, institution)))',
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
  type Person = {
    id: string;
    first_name: string;
    last_name: string;
    deposit_accounts: { account_number: string; institution: string } | null;
  };
  const people = (lease.lease_people ?? []).map((lp) => lp.people as unknown as Person);
  const tenants = people.map((p) => `${p.first_name} ${p.last_name}`);

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

  // The deposit number is the account number of the bank account tied to the tenant's profile.
  async function setDepositNumber(formData: FormData) {
    'use server';
    const { supabase } = await requireStaff();
    const accountNumber = String(formData.get('account_number') ?? '').trim();
    if (!accountNumber) return;
    const { error } = await supabase.from('deposit_accounts').upsert(
      {
        person_id: String(formData.get('person_id')),
        account_number: accountNumber,
        institution: String(formData.get('institution') ?? '').trim() || 'Truliant Federal Credit Union',
        active: true,
      },
      { onConflict: 'person_id' },
    );
    if (error) throw new Error(error.message);
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

      <h2>Deposit numbers</h2>
      <p style={{ fontSize: '0.9em' }}>
        Tenants deposit cash, money orders, and cashier's checks at Truliant or any CO-OP Shared Branch credit
        union using this account number. Record those deposits under Payments.
      </p>
      {people.map((p) => (
        <form key={p.id} action={setDepositNumber} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <input type="hidden" name="person_id" value={p.id} />
          <span style={{ minWidth: 160, alignSelf: 'center' }}>
            {p.first_name} {p.last_name}
          </span>
          <input name="account_number" placeholder="Account number" defaultValue={p.deposit_accounts?.account_number ?? ''} />
          <input name="institution" placeholder="Truliant Federal Credit Union" defaultValue={p.deposit_accounts?.institution ?? ''} />
          <button type="submit">Save</button>
        </form>
      ))}

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
