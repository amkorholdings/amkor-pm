import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkAgentToken } from '@/lib/agent-auth';

// GET /api/v1/leases?status=active
// Lists leases with the current balance. Used by agents to read the store of record.
export async function GET(request: NextRequest) {
  const denied = checkAgentToken(request);
  if (denied) return denied;

  const supabase = createAdminClient();
  const status = request.nextUrl.searchParams.get('status');

  let query = supabase
    .from('leases')
    .select('id, monthly_rent, start_date, end_date, status, units(unit_number, properties(name))');
  if (status) query = query.eq('status', status);

  const { data: leases, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: balances } = await supabase.from('lease_balances').select('lease_id, balance');
  const byLease = new Map((balances ?? []).map((b) => [b.lease_id, Number(b.balance)]));

  return NextResponse.json({
    leases: (leases ?? []).map((l) => ({ ...l, balance: byLease.get(l.id) ?? 0 })),
  });
}
