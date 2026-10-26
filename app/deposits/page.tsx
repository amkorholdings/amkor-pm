import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { DEPOSIT_METHODS, METHOD_LABELS, recordDeposit, type DepositMethod } from '@/lib/payments';
import { Shell } from '@/components/Shell';

// Record cash, money order, and cashier's check deposits by the unit's deposit number,
// and see recent payments from every channel.
export default async function DepositsPage({ searchParams }: { searchParams: { error?: string } }) {
  const { supabase } = await requireStaff();

  const { data: payments } = await supabase
    .from('payments')
    .select(
      'id, lease_id, method, amount, status, received_date, deposit_reference, deposit_location, created_at, people(first_name, last_name)',
    )
    .order('created_at', { ascending: false })
    .limit(50);

  async function addDeposit(formData: FormData) {
    'use server';
    const { supabase } = await requireStaff();
    try {
      await recordDeposit(supabase, {
        account_number: String(formData.get('account_number') ?? ''),
        amount: Number(formData.get('amount')),
        method: String(formData.get('method')) as DepositMethod,
        received_date: String(formData.get('received_date')),
        reference: String(formData.get('reference') ?? ''),
        location: String(formData.get('location') ?? ''),
      });
    } catch (e) {
      redirect(`/deposits?error=${encodeURIComponent((e as Error).message)}`);
    }
    revalidatePath('/deposits');
    redirect('/deposits');
  }

  return (
    <Shell title="Payments">
      <h2>Record an in-person deposit</h2>
      <p className="muted">
        For cash, money orders, and cashier's checks deposited at Truliant or a CO-OP Shared Branch credit union.
        The deposit number is the unit's bank account number. The payment posts to the unit's active lease. Deposits
        the 5am bank feed picks up are posted automatically and don't need to be entered here.
      </p>
      {searchParams.error && <p className="error">{searchParams.error}</p>}
      <form action={addDeposit} style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
        <input name="account_number" placeholder="Unit deposit number (account number)" required />
        <input name="amount" placeholder="Amount" inputMode="decimal" required />
        <select name="method" defaultValue="money_order">
          {DEPOSIT_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>
        <input name="received_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
        <input name="reference" placeholder="Bank transaction id or money order / check number" />
        <input name="location" placeholder="Where deposited (e.g. Truliant, or the shared branch name)" />
        <button type="submit">Record deposit</button>
      </form>

      <h2>Recent payments</h2>
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Date</th>
            <th>Tenant</th>
            <th>Method</th>
            <th>Reference</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(payments ?? []).map((p) => {
            const person = p.people as unknown as { first_name: string; last_name: string } | null;
            return (
              <tr key={p.id}>
                <td>{p.received_date ?? p.created_at.slice(0, 10)}</td>
                <td>
                  <Link href={`/leases/${p.lease_id}`}>
                    {person ? `${person.first_name} ${person.last_name}` : 'Lease'}
                  </Link>
                </td>
                <td>{METHOD_LABELS[p.method] ?? p.method}</td>
                <td>{[p.deposit_location, p.deposit_reference].filter(Boolean).join(' · ')}</td>
                <td>{p.status}</td>
                <td style={{ textAlign: 'right' }}>{Number(p.amount).toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Shell>
  );
}
