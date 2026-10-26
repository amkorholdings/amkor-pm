// Minimal Plaid client over the REST API. Server only.
// PLAID_ENV is "sandbox" for testing and "production" for real bank data.

export async function plaidRequest<T = Record<string, unknown>>(path: string, body: Record<string, unknown> = {}) {
  const env = process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox';
  const res = await fetch(`https://${env}.plaid.com/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error_message ?? `Plaid error ${res.status}`) as Error & { code?: string };
    err.code = json?.error_code;
    throw err;
  }
  return json as T;
}

export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number; // Plaid sign: positive = money out, negative = money in
  date: string; // YYYY-MM-DD
  name: string;
  merchant_name?: string | null;
  pending: boolean;
};

export type PlaidAccount = { account_id: string; name: string; mask: string | null };
