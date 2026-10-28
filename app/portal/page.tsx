import { createClient } from '@/lib/supabase/server';
import { DEPOSIT_LOCATIONS } from '@/lib/payments';

const MESSAGES: Record<string, string> = {
  paid: 'Thanks. Your payment was received. Bank transfers can take a few business days to show as paid.',
  'no-lease': "We couldn't find one active lease on your account. Please contact the office.",
  payment: "The payment couldn't be started. Please try again or contact the office.",
};

// Tenant view. RLS limits every query to the signed-in tenant's own lease.
export default async function PortalPage({
  searchParams,
}: {
  searchParams: { paid?: string; error?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return <p>Sign in to see your account.</p>;
  }

  const { data: entries } = await supabase
    .from('ledger_entries')
    .select('id, entry_date, entry_type, description, amount')
    .order('entry_date')
    .order('created_at');

  const balance = (entries ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

  const { data: depositAccount } = await supabase
    .from('deposit_accounts')
    .select('institution, account_number')
    .eq('active', true)
    .maybeSingle();

  const message = searchParams.paid ? MESSAGES.paid : searchParams.error ? MESSAGES[searchParams.error] : null;

  return (
    <main style={{ padding: '2rem', maxWidth: 640 }}>
      <h1>Your account</h1>
      <h2>Balance: ${balance.toFixed(2)}</h2>
      {message && <p className={searchParams.error ? 'error' : 'muted'}>{message}</p>}

      <h2>Pay online</h2>
      <p>Pay by card or bank transfer (ACH). You'll finish on a secure Stripe page.</p>
      <form action="/portal/pay" method="post" style={{ display: 'flex', gap: '0.75rem', maxWidth: 420 }}>
        <input
          name="amount"
          inputMode="decimal"
          required
          placeholder="Amount"
          defaultValue={balance > 0 ? balance.toFixed(2) : ''}
        />
        <button type="submit">Pay</button>
      </form>

      <h2>Pay in person</h2>
      {depositAccount ? (
        <p>
          Deposit cash, a money order, or a cashier's check at {DEPOSIT_LOCATIONS}. Tell the teller it's a
          deposit to {depositAccount.institution}, account number{' '}
          <strong>{depositAccount.account_number}</strong>. Keep your receipt.
        </p>
      ) : (
        <p className="muted">Your deposit number hasn't been set up yet. Please contact the office.</p>
      )}

      <h2>History</h2>
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Date</th>
            <th>Description</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(entries ?? []).map((e) => (
            <tr key={e.id} style={{ borderTop: '1px solid #eee' }}>
              <td>{e.entry_date}</td>
              <td>{e.description ?? e.entry_type}</td>
              <td style={{ textAlign: 'right' }}>{Number(e.amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
