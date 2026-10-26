import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkAgentToken } from '@/lib/agent-auth';
import { recordDeposit, type DepositMethod } from '@/lib/payments';

// POST /api/v1/deposits
// Body: { account_number, amount, method: "cash" | "money_order" | "cashiers_check",
//         received_date: "YYYY-MM-DD", reference?, location?, lease_id? }
// Records an in-person deposit by the tenant's deposit number and posts it to their ledger.
// The same (account_number, reference) can only be recorded once, so a bank feed can resend safely.
export async function POST(request: NextRequest) {
  const denied = checkAgentToken(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  try {
    const result = await recordDeposit(createAdminClient(), {
      account_number: String(body.account_number ?? ''),
      amount: Number(body.amount),
      method: String(body.method) as DepositMethod,
      received_date: String(body.received_date),
      reference: body.reference ? String(body.reference) : null,
      location: body.location ? String(body.location) : null,
      lease_id: body.lease_id ? String(body.lease_id) : null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
