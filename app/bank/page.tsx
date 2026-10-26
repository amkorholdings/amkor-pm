import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncAllBanks } from '@/lib/bank-sync';
import { PlaidConnect } from '@/components/PlaidConnect';
import { Shell } from '@/components/Shell';

// Bank feed: connected banks, which bank account belongs to which unit, and deposits that need a look.
export default async function BankPage() {
  const { supabase } = await requireStaff();
  // plaid_items holds access tokens, so it's read with the service role and only safe columns are selected.
  const { data: items } = await createAdminClient()
    .from('plaid_items')
    .select('id, institution_name, last_synced_at, last_error')
    .order('created_at');

  const { data: accounts } = await supabase.from('plaid_accounts').select('account_id, name, mask').order('name');
  const { data: deposits } = await supabase
    .from('deposit_accounts')
    .select('id, account_number, plaid_account_id, units(unit_number, properties(name))')
    .order('account_number');
  const { data: problems } = await supabase
    .from('bank_transactions')
    .select('id, posted_date, amount, description, status, error, plaid_account_id')
    .in('status', ['unmatched', 'error'])
    .order('posted_date', { ascending: false })
    .limit(100);

  const unitLabel = (d: { units: unknown }) => {
    const u = d.units as { unit_number: string; properties: { name: string } } | null;
    return u ? `${u.properties.name} · Unit ${u.unit_number}` : '';
  };
  const byPlaid = new Map((deposits ?? []).filter((d) => d.plaid_account_id).map((d) => [d.plaid_account_id, d]));
  const accountName = new Map((accounts ?? []).map((a) => [a.account_id, `${a.name} ••${a.mask ?? ''}`]));

  async function syncNow() {
    'use server';
    await requireStaff();
    await syncAllBanks(createAdminClient());
    revalidatePath('/bank');
  }

  async function mapAccount(formData: FormData) {
    'use server';
    const { supabase } = await requireStaff();
    const plaidAccountId = String(formData.get('plaid_account_id'));
    const depositId = String(formData.get('deposit_account_id') ?? '');
    await supabase.from('deposit_accounts').update({ plaid_account_id: null }).eq('plaid_account_id', plaidAccountId);
    if (depositId) {
      const { error } = await supabase
        .from('deposit_accounts')
        .update({ plaid_account_id: plaidAccountId })
        .eq('id', depositId);
      if (error) throw new Error(error.message);
    }
    revalidatePath('/bank');
  }

  return (
    <Shell title="Bank feed">
      <p className="muted">
        Every morning at 5am, deposits into the unit bank accounts are pulled through Plaid and posted to each
        unit's active lease. Deposits from before a bank was connected are skipped.
      </p>

      <h2>Connected banks</h2>
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Bank</th>
            <th>Last synced</th>
            <th>Problem</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((i) => (
            <tr key={i.id}>
              <td>{i.institution_name ?? 'Bank'}</td>
              <td>{i.last_synced_at ? new Date(i.last_synced_at).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'Not yet'}</td>
              <td className={i.last_error ? 'error' : undefined}>{i.last_error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
        <PlaidConnect />
        <form action={syncNow}>
          <button type="submit">Sync now</button>
        </form>
      </div>

      <h2>Bank accounts and units</h2>
      <p className="muted">Accounts are matched to units automatically when the last four digits match one deposit number.</p>
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Bank account</th>
            <th>Unit deposit number</th>
          </tr>
        </thead>
        <tbody>
          {(accounts ?? []).map((a) => {
            const current = byPlaid.get(a.account_id);
            return (
              <tr key={a.account_id}>
                <td>{accountName.get(a.account_id)}</td>
                <td>
                  <form action={mapAccount} style={{ display: 'flex', gap: '0.5rem' }}>
                    <input type="hidden" name="plaid_account_id" value={a.account_id} />
                    <select name="deposit_account_id" defaultValue={current?.id ?? ''}>
                      <option value="">Not a unit account</option>
                      {(deposits ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.account_number} · {unitLabel(d)}
                        </option>
                      ))}
                    </select>
                    <button type="submit">Save</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Deposits that need a look</h2>
      <p className="muted">
        Unmatched: the bank account isn't linked to a unit. Error: the unit has no single active lease. Record these by
        hand under Payments.
      </p>
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Date</th>
            <th>Account</th>
            <th>Description</th>
            <th>Problem</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(problems ?? []).map((t) => (
            <tr key={t.id}>
              <td>{t.posted_date}</td>
              <td>{accountName.get(t.plaid_account_id) ?? t.plaid_account_id}</td>
              <td>{t.description}</td>
              <td>{t.status === 'unmatched' ? 'No unit linked' : t.error}</td>
              <td style={{ textAlign: 'right' }}>{Number(t.amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}
