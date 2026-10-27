import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { retryProblems, syncAllBanks } from '@/lib/bank-sync';
import { PlaidConnect } from '@/components/PlaidConnect';
import { Shell } from '@/components/Shell';

const KIND_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  return: 'Bounced item',
  fee: 'Bank fee',
  transfer: 'Transfer',
  other: 'Other',
};
const STATUS_LABELS: Record<string, string> = {
  posted: 'Posted to lease',
  returned: 'Taken back off lease',
  recorded: 'Recorded',
  ignored: 'Before bank was connected',
  unmatched: 'Needs a look',
  error: 'Needs a look',
};

// Bank feed: connected banks, which bank account belongs to which unit, and every debit and credit.
export default async function BankPage({ searchParams }: { searchParams: { account?: string } }) {
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

  let txQuery = supabase
    .from('bank_transactions')
    .select('id, posted_date, amount, description, kind, status, plaid_account_id')
    .order('posted_date', { ascending: false })
    .limit(300);
  if (searchParams.account) txQuery = txQuery.eq('plaid_account_id', searchParams.account);
  const { data: transactions } = await txQuery;

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

  async function retryNow() {
    'use server';
    await requireStaff();
    await retryProblems(createAdminClient());
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
        Every morning at 5am, every transaction on the connected accounts is pulled through Plaid. Deposits post to
        the unit's active lease. A bounced check or money order is taken back off the lease it was credited to. Fees
        and transfers are recorded. Transactions from before a bank was connected are recorded but not posted.
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

      <h2>Needs a look</h2>
      <p className="muted">
        Transactions the app couldn't place. Fix the reason shown (for example, link the bank account to its unit or
        add the unit's lease) and they post on their own at the next sync, or press Retry.
      </p>
      <form action={retryNow} style={{ marginBottom: '0.75rem' }}>
        <button type="submit">Retry</button>
      </form>
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
              <td>{t.error}</td>
              <td style={{ textAlign: 'right' }}>{Number(t.amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>All transactions</h2>
      <form method="get" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <select name="account" defaultValue={searchParams.account ?? ''}>
          <option value="">All accounts</option>
          {(accounts ?? []).map((a) => (
            <option key={a.account_id} value={a.account_id}>
              {accountName.get(a.account_id)}
              {byPlaid.get(a.account_id) ? ` · ${unitLabel(byPlaid.get(a.account_id)!)}` : ''}
            </option>
          ))}
        </select>
        <button type="submit">Show</button>
      </form>
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Date</th>
            <th>Account</th>
            <th>Description</th>
            <th>Type</th>
            <th>What happened</th>
            <th style={{ textAlign: 'right' }}>Money in</th>
            <th style={{ textAlign: 'right' }}>Money out</th>
          </tr>
        </thead>
        <tbody>
          {(transactions ?? []).map((t) => {
            const amount = Number(t.amount);
            return (
              <tr key={t.id}>
                <td>{t.posted_date}</td>
                <td>{accountName.get(t.plaid_account_id) ?? t.plaid_account_id}</td>
                <td>{t.description}</td>
                <td>{KIND_LABELS[t.kind] ?? t.kind}</td>
                <td>{STATUS_LABELS[t.status] ?? t.status}</td>
                <td style={{ textAlign: 'right' }}>{amount > 0 ? amount.toFixed(2) : ''}</td>
                <td style={{ textAlign: 'right' }}>{amount < 0 ? (-amount).toFixed(2) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Shell>
  );
}
