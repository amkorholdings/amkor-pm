import type { SupabaseClient } from '@supabase/supabase-js';

export const ENTRY_TYPES = ['charge', 'payment', 'credit', 'adjustment', 'deposit', 'refund'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

// The ledger stores signed amounts. Positive = tenant owes. Negative = tenant has paid or been credited.
// Callers pass the amount as a plain positive number for every type except adjustment,
// where the sign is taken as entered.
export function signedAmount(type: EntryType, entered: number): number {
  switch (type) {
    case 'charge':
    case 'deposit':
    case 'refund':
      return Math.abs(entered);
    case 'payment':
    case 'credit':
      return -Math.abs(entered);
    case 'adjustment':
      return entered;
  }
}

export type NewEntry = {
  lease_id: string;
  entry_date: string; // YYYY-MM-DD
  entry_type: EntryType;
  description?: string | null;
  amount: number; // as entered, see signedAmount
};

export async function addLedgerEntry(supabase: SupabaseClient, entry: NewEntry) {
  if (!(ENTRY_TYPES as readonly string[]).includes(entry.entry_type)) {
    throw new Error(`Unknown entry type: ${entry.entry_type}`);
  }
  if (!Number.isFinite(entry.amount)) throw new Error('Amount must be a number');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.entry_date)) throw new Error('Date must be YYYY-MM-DD');

  const { data, error } = await supabase
    .from('ledger_entries')
    .insert({
      lease_id: entry.lease_id,
      entry_date: entry.entry_date,
      entry_type: entry.entry_type,
      description: entry.description ?? null,
      amount: signedAmount(entry.entry_type, entry.amount),
    })
    .select('id, amount')
    .single();
  if (error) throw new Error(error.message);
  return data;
}
