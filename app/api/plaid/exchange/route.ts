import { NextResponse, type NextRequest } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { saveConnection } from '@/lib/bank-sync';

// POST /api/plaid/exchange  Body: { public_token, institution_name }. Staff only.
export async function POST(request: NextRequest) {
  await requireStaff();
  const body = await request.json().catch(() => ({}));
  if (!body.public_token) return NextResponse.json({ error: 'public_token is required' }, { status: 400 });
  try {
    await saveConnection(createAdminClient(), String(body.public_token), body.institution_name ? String(body.institution_name) : null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
