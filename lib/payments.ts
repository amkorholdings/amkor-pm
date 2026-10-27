import type { SupabaseClient } from '@supabase/supabase-js';
import { stripeRequest } from './stripe';

export const DEPOSIT_METHODS = ['cash', 'money_order', 'cashiers_check'] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

export const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  ach: 'Bank transfer (ACH)',
  cash: 'Cash',
  money_order: 'Money order',
  cashiers_check: "Cashier's check",
  branch_deposit: 'Bank deposit',
};

// Where tenants can make in-person deposits.
export const DEPOSIT_LOCATIONS =
  'any Truliant Federal Credit Union branch, or any CO-OP Shared Branch credit union';

export type NewDeposit = {
  account_number: string;
  amount: number;
  method: DepositMethod;
  received_date: string; // YYYY-MM-DD
  reference?: string | null; // bank transaction id, money order number, or check number
  location?: string | null;
  lease_id?: string | null; // only when the unit has more than one active lease
};

// Records an in-person deposit by the unit's deposit number and posts it to the unit's active lease
// in one transaction.
export async function recordDeposit(supabase: SupabaseClient, d: NewDeposit) {
  if (!(DEPOSIT_METHODS as readonly string[]).includes(d.method)) {
    throw new Error(`method must be one of ${DEPOSIT_METHODS.join(', ')}`);
  }
  if (!Number.isFinite(d.amount) || d.amount <= 0) throw new Error('Amount must be a positive number');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.received_date)) throw new Error('Date must be YYYY-MM-DD');

  // Accounts on the bank feed post their deposits automatically; entering one here too would count it twice.
  const { data: account } = await supabase
    .from('deposit_accounts')
    .select('plaid_account_id')
    .eq('account_number', d.account_number.trim())
    .maybeSingle();
  if (account?.plaid_account_id) {
    throw new Error('This deposit number is on the bank feed. Its deposits post automatically each morning.');
  }

  const { data, error } = await supabase.rpc('record_deposit', {
    p_account_number: d.account_number.trim(),
    p_amount: d.amount,
    p_method: d.method,
    p_received_date: d.received_date,
    p_reference: d.reference?.trim() || null,
    p_location: d.location?.trim() || null,
    p_lease_id: d.lease_id || null,
  });
  if (error) {
    if (error.code === '23505') throw new Error('That deposit reference was already recorded for this account');
    throw new Error(error.message);
  }
  return { payment_id: data as string };
}

// Starts a Stripe Checkout session (card or ACH) for a tenant's lease and returns the URL to send them to.
// Needs the service role client: tenants can't write payments or their own Stripe customer id.
export async function startCheckout(
  admin: SupabaseClient,
  opts: { person_id: string; lease_id: string; amount: number; site_url: string },
) {
  if (!Number.isFinite(opts.amount) || opts.amount < 1) throw new Error('Amount must be at least $1.00');
  const cents = Math.round(opts.amount * 100);

  const { data: person, error } = await admin
    .from('people')
    .select('id, first_name, last_name, email, stripe_customer_id')
    .eq('id', opts.person_id)
    .single();
  if (error) throw new Error(error.message);

  let customer = person.stripe_customer_id as string | null;
  if (!customer) {
    const created = await stripeRequest<{ id: string }>(
      'customers',
      { name: `${person.first_name} ${person.last_name}`, email: person.email, metadata: { person_id: person.id } },
      { idempotencyKey: `customer-${person.id}` },
    );
    customer = created.id;
    await admin.from('people').update({ stripe_customer_id: customer }).eq('id', person.id);
  }

  const { data: payment, error: insertError } = await admin
    .from('payments')
    .insert({ lease_id: opts.lease_id, person_id: person.id, method: 'card', amount: cents / 100 })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);

  const session = await stripeRequest<{ id: string; url: string }>('checkout/sessions', {
    mode: 'payment',
    customer,
    payment_method_types: ['card', 'us_bank_account'],
    line_items: [
      { quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: 'Rent payment' } } },
    ],
    metadata: { payment_id: payment.id },
    payment_intent_data: { metadata: { payment_id: payment.id, lease_id: opts.lease_id } },
    success_url: `${opts.site_url}/portal?paid=1`,
    cancel_url: `${opts.site_url}/portal`,
  });

  await admin.from('payments').update({ stripe_checkout_session_id: session.id }).eq('id', payment.id);
  return session.url;
}
