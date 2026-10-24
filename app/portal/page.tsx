import { createClient } from '@/lib/supabase/server';

// Tenant view. RLS limits every query to the signed-in tenant's own lease.
export default async function PortalPage() {
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

  return (
    <main style={{ padding: '2rem', maxWidth: 640 }}>
      <h1>Your account</h1>
      <h2>Balance: ${balance.toFixed(2)}</h2>
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
