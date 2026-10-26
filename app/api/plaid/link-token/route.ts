import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { plaidRequest } from '@/lib/plaid';

// POST /api/plaid/link-token. Staff only. Starts Plaid Link so staff can connect a bank login.
export async function POST() {
  const { user } = await requireStaff();
  try {
    const { link_token } = await plaidRequest<{ link_token: string }>('link/token/create', {
      user: { client_user_id: user.id },
      client_name: 'Amkor PM',
      products: ['transactions'],
      transactions: { days_requested: 30 },
      country_codes: ['US'],
      language: 'en',
    });
    return NextResponse.json({ link_token });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
