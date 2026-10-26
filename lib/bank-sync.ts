import type { SupabaseClient } from '@supabase/supabase-js';
import { plaidRequest, type PlaidAccount, type PlaidTransaction } from './plaid';

type SyncPage = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  next_cursor: string;
  has_more: boolean;
};

export type SyncSummary = { institution: string | null; posted: number; unmatched: number; errors: number; error?: string };

// Saves a newly connected bank login and maps its accounts to unit deposit accounts where the
// last four digits match exactly one deposit number.
export async function saveConnection(admin: SupabaseClient, publicToken: string, institutionName: string | null) {
  const { access_token, item_id } = await plaidRequest<{ access_token: string; item_id: string }>(
    'item/public_token/exchange',
    { public_token: publicToken },
  );
  const { data: item, error } = await admin
    .from('plaid_items')
    .upsert({ item_id, access_token, institution_name: institutionName }, { onConflict: 'item_id' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  const { accounts } = await plaidRequest<{ accounts: PlaidAccount[] }>('accounts/get', { access_token });
  await admin
    .from('plaid_accounts')
    .upsert(accounts.map((a) => ({ account_id: a.account_id, plaid_item_id: item.id, name: a.name, mask: a.mask })));

  const { data: deposits } = await admin.from('deposit_accounts').select('id, account_number').is('plaid_account_id', null);
  for (const a of accounts) {
    if (!a.mask) continue;
    const matches = (deposits ?? []).filter((d) => d.account_number.endsWith(a.mask!));
    if (matches.length === 1) {
      await admin.from('deposit_accounts').update({ plaid_account_id: a.account_id }).eq('id', matches[0].id);
    }
  }
}

// Pulls new transactions for every connected bank and posts incoming deposits to the unit's active lease.
// Deposits dated before the bank was connected are skipped: those were already on the books.
export async function syncAllBanks(admin: SupabaseClient): Promise<SyncSummary[]> {
  const { data: items } = await admin.from('plaid_items').select('id, access_token, institution_name, cursor, created_at');
  const results: SyncSummary[] = [];
  for (const item of items ?? []) {
    const summary: SyncSummary = { institution: item.institution_name, posted: 0, unmatched: 0, errors: 0 };
    try {
      const { transactions, cursor } = await pullTransactions(item.access_token, item.cursor);
      const since = String(item.created_at).slice(0, 10);
      for (const t of transactions) {
        if (t.pending || t.amount >= 0) continue; // only settled money in
        const outcome = await postDeposit(admin, t, t.date < since);
        if (outcome) summary[outcome] += 1;
      }
      await admin
        .from('plaid_items')
        .update({ cursor, last_synced_at: new Date().toISOString(), last_error: null })
        .eq('id', item.id);
    } catch (e) {
      summary.error = (e as Error).message;
      await admin.from('plaid_items').update({ last_error: summary.error }).eq('id', item.id);
    }
    results.push(summary);
  }
  return results;
}

// Follows /transactions/sync to the end. If the data changes mid-way, Plaid asks us to restart from the
// original cursor, which is safe because each transaction is only recorded once.
async function pullTransactions(accessToken: string, startCursor: string | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = startCursor ?? undefined;
    const transactions: PlaidTransaction[] = [];
    try {
      let hasMore = true;
      while (hasMore) {
        const page = await plaidRequest<SyncPage>('transactions/sync', { access_token: accessToken, cursor, count: 500 });
        transactions.push(...page.added, ...page.modified);
        cursor = page.next_cursor;
        hasMore = page.has_more;
      }
      return { transactions, cursor };
    } catch (e) {
      if ((e as { code?: string }).code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') throw e;
    }
  }
  throw new Error('Plaid data kept changing during sync; will retry next run');
}

async function postDeposit(
  admin: SupabaseClient,
  t: PlaidTransaction,
  beforeConnection: boolean,
): Promise<'posted' | 'unmatched' | 'errors' | null> {
  const { data: existing } = await admin
    .from('bank_transactions')
    .select('id')
    .eq('plaid_transaction_id', t.transaction_id)
    .maybeSingle();
  if (existing) return null;

  const { data: account } = await admin
    .from('deposit_accounts')
    .select('id, account_number')
    .eq('plaid_account_id', t.account_id)
    .maybeSingle();

  const row = {
    plaid_transaction_id: t.transaction_id,
    plaid_account_id: t.account_id,
    deposit_account_id: account?.id ?? null,
    posted_date: t.date,
    amount: -t.amount,
    description: t.merchant_name || t.name,
  };

  if (beforeConnection) {
    await admin.from('bank_transactions').insert({ ...row, status: 'ignored', error: 'Before the bank was connected' });
    return null;
  }
  if (!account) {
    await admin.from('bank_transactions').insert({ ...row, status: 'unmatched' });
    return 'unmatched';
  }

  const { data: paymentId, error } = await admin.rpc('record_deposit', {
    p_account_number: account.account_number,
    p_amount: -t.amount,
    p_method: 'branch_deposit',
    p_received_date: t.date,
    p_reference: t.transaction_id,
    p_location: null,
  });
  if (error) {
    await admin.from('bank_transactions').insert({ ...row, status: 'error', error: error.message });
    return 'errors';
  }
  await admin.from('bank_transactions').insert({ ...row, status: 'posted', payment_id: paymentId });
  return 'posted';
}
