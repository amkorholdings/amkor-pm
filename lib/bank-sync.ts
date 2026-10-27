import type { SupabaseClient } from '@supabase/supabase-js';
import { plaidRequest, type PlaidAccount, type PlaidTransaction } from './plaid';

type SyncPage = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  next_cursor: string;
  has_more: boolean;
};

export type SyncSummary = {
  institution: string | null;
  posted: number;
  returned: number;
  recorded: number;
  problems: number;
  error?: string;
};

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

// Pulls every new transaction for every connected bank. Money in posts to the unit's active lease. Money out
// that is a bounced deposit reverses the payment it bounced. Everything else is kept so every debit and credit
// can be seen. Transactions dated before the bank was connected are kept but not posted: those were already on
// the books.
export async function syncAllBanks(admin: SupabaseClient): Promise<SyncSummary[]> {
  const { data: items } = await admin.from('plaid_items').select('id, access_token, institution_name, cursor, created_at');
  const results: SyncSummary[] = [];
  await retryProblems(admin);
  for (const item of items ?? []) {
    const summary: SyncSummary = { institution: item.institution_name, posted: 0, returned: 0, recorded: 0, problems: 0 };
    try {
      const { transactions, cursor } = await pullTransactions(item.access_token, item.cursor);
      const since = String(item.created_at).slice(0, 10);
      for (const t of transactions) {
        if (t.pending) continue; // pending items come back settled, with a new id
        const outcome = await recordTransaction(admin, t, t.date < since);
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

// Tries again on transactions that couldn't be placed before (no linked unit, no active lease, no matching
// deposit), so they post on their own once the cause is fixed.
export async function retryProblems(admin: SupabaseClient) {
  const { data: rows } = await admin
    .from('bank_transactions')
    .select('id, plaid_transaction_id, plaid_account_id, posted_date, amount, description')
    .in('status', ['unmatched', 'error']);
  for (const r of rows ?? []) {
    await admin.from('bank_transactions').delete().eq('id', r.id);
    await recordTransaction(
      admin,
      {
        transaction_id: r.plaid_transaction_id,
        account_id: r.plaid_account_id,
        amount: -Number(r.amount),
        date: r.posted_date,
        name: r.description ?? '',
        pending: false,
      },
      false,
    );
  }
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

// Bank descriptions for a deposited item that bounced, and for bank fees. Fee is checked first so
// "Returned item fee" counts as a fee, not a second return.
const FEE = /\bfee\b|service charge/i;
const RETURN = /return|chargeback|\bnsf\b|insufficient|uncollected|\bunpaid\b|reversal|ret(urned)? (item|dep|chk)/i;
const TRANSFER = /transfer|xfer|sweep|to share|to checking|from share|from checking/i;

type Kind = 'deposit' | 'return' | 'fee' | 'transfer' | 'other';

// Unit accounts exist to take rent, so any money in is a deposit (a tenant's online transfer included),
// except a fee refund.
export function classify(amountIn: number, description: string): Kind {
  if (FEE.test(description)) return 'fee';
  if (amountIn > 0) return 'deposit';
  if (RETURN.test(description)) return 'return';
  if (TRANSFER.test(description)) return 'transfer';
  return 'other';
}

type Outcome = 'posted' | 'returned' | 'recorded' | 'problems';

async function recordTransaction(admin: SupabaseClient, t: PlaidTransaction, beforeConnection: boolean): Promise<Outcome | null> {
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

  const amountIn = -t.amount; // Plaid uses positive for money out
  const description = t.merchant_name || t.name;
  const kind = classify(amountIn, description);
  const row = {
    plaid_transaction_id: t.transaction_id,
    plaid_account_id: t.account_id,
    deposit_account_id: account?.id ?? null,
    posted_date: t.date,
    amount: amountIn,
    description,
    kind,
  };
  const save = async (status: string, extra: { payment_id?: string; error?: string } = {}) => {
    const { error } = await admin.from('bank_transactions').insert({ ...row, status, ...extra });
    if (error && error.code !== '23505') throw new Error(error.message);
  };

  if (beforeConnection) {
    await save('ignored', { error: 'Before the bank was connected' });
    return null;
  }
  if (kind !== 'deposit' && kind !== 'return') {
    await save('recorded');
    return 'recorded';
  }
  if (!account) {
    await save('unmatched', { error: 'This bank account is not linked to a unit' });
    return 'problems';
  }

  if (kind === 'deposit') {
    const { data: paymentId, error } = await admin.rpc('record_deposit', {
      p_account_number: account.account_number,
      p_amount: amountIn,
      p_method: 'branch_deposit',
      p_received_date: t.date,
      p_reference: t.transaction_id,
      p_location: null,
    });
    if (error?.code === '23505') {
      // Posted on an earlier run that stopped before saving this row.
      const { data: payment } = await admin
        .from('payments')
        .select('id')
        .eq('deposit_account_id', account.id)
        .eq('deposit_reference', t.transaction_id)
        .single();
      await save('posted', { payment_id: payment?.id });
      return 'posted';
    }
    if (error) {
      await save('error', { error: error.message });
      return 'problems';
    }
    await save('posted', { payment_id: paymentId as string });
    return 'posted';
  }

  // A bounced item: find the most recent payment into this account for the same amount, within 60 days.
  const earliest = new Date(new Date(t.date).getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
  const { data: bounced } = await admin
    .from('payments')
    .select('id')
    .eq('deposit_account_id', account.id)
    .eq('status', 'succeeded')
    .eq('amount', -amountIn)
    .gte('received_date', earliest)
    .lte('received_date', t.date)
    .order('received_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!bounced) {
    await save('error', { error: 'Returned item with no matching deposit in the last 60 days' });
    return 'problems';
  }
  const { error } = await admin.rpc('return_payment', {
    p_payment_id: bounced.id,
    p_entry_date: t.date,
    p_description: `Returned deposit: ${description}`,
  });
  if (error) {
    await save('error', { error: error.message });
    return 'problems';
  }
  await save('returned', { payment_id: bounced.id });
  return 'returned';
}
