import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkAgentToken } from '@/lib/agent-auth';
import { addLedgerEntry, ENTRY_TYPES, type EntryType } from '@/lib/ledger';

// POST /api/v1/ledger
// Body: { lease_id, entry_date: "YYYY-MM-DD", entry_type, amount, description? }
// Amounts are positive for charges, payments, credits, deposits, and refunds. Adjustments take sign as given.
export async function POST(request: NextRequest) {
  const denied = checkAgentToken(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  if (!ENTRY_TYPES.includes(body.entry_type as EntryType)) {
    return NextResponse.json({ error: `entry_type must be one of ${ENTRY_TYPES.join(', ')}` }, { status: 400 });
  }

  try {
    const entry = await addLedgerEntry(createAdminClient(), {
      lease_id: String(body.lease_id),
      entry_date: String(body.entry_date),
      entry_type: body.entry_type as EntryType,
      amount: Number(body.amount),
      description: body.description ? String(body.description) : null,
    });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
