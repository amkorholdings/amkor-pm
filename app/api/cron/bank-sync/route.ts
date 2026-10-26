import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncAllBanks } from '@/lib/bank-sync';

// POST /api/cron/bank-sync   Authorization: Bearer <CRON_SECRET>
// Called by the Supabase scheduler at 09:00 and 10:00 UTC. Only the call that lands at 5am in Charlotte
// (America/New_York) runs, so the sync stays at 5am through daylight saving changes. ?force=1 runs it now.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(
    new Date(),
  );
  if (request.nextUrl.searchParams.get('force') !== '1' && Number(hour) !== 5) {
    return NextResponse.json({ skipped: `It is ${hour}:00 in Charlotte; the sync runs at 5:00` });
  }

  const results = await syncAllBanks(createAdminClient());
  return NextResponse.json({ results });
}
