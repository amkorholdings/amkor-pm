import { createHmac, timingSafeEqual } from 'node:crypto';

// Minimal Stripe client over the REST API. Server only.

type Params = Record<string, unknown>;

// Stripe takes form-encoded bodies with bracketed keys: a[b][0]=c.
function encode(params: Params, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) =>
        typeof v === 'object' ? encode(v as Params, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(v)),
      );
    } else if (typeof value === 'object') {
      encode(value as Params, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

export async function stripeRequest<T = Record<string, unknown>>(
  path: string,
  params: Params = {},
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers,
    body: encode(params).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe error ${res.status}`);
  return json as T;
}

// Checks the Stripe-Signature header against the raw request body.
// Rejects events older than five minutes to block replays.
export function verifyStripeEvent(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) throw new Error('Missing webhook secret or signature');

  const parts = signatureHeader.split(',').map((p) => p.split('='));
  const timestamp = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!timestamp || signatures.length === 0) throw new Error('Malformed signature header');
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error('Signature too old');

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  const valid = signatures.some((s) => {
    const given = Buffer.from(s, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) throw new Error('Invalid signature');

  return JSON.parse(rawBody) as { id: string; type: string; data: { object: Record<string, unknown> } };
}
