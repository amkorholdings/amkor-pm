import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { startCheckout } from '@/lib/payments';

// POST /portal/pay (form: amount). Sends the signed-in tenant to Stripe Checkout for card or ACH.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url), 303);

  // RLS scopes these reads to the tenant's own records.
  const { data: person } = await supabase.from('people').select('id').eq('auth_user_id', user.id).maybeSingle();
  const { data: leases } = await supabase.from('leases').select('id').eq('status', 'active');
  if (!person || !leases || leases.length !== 1) {
    return NextResponse.redirect(new URL('/portal?error=no-lease', request.url), 303);
  }

  const form = await request.formData();
  try {
    const url = await startCheckout(createAdminClient(), {
      person_id: person.id,
      lease_id: leases[0].id,
      amount: Number(form.get('amount')),
      site_url: process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin,
    });
    return NextResponse.redirect(url, 303);
  } catch {
    return NextResponse.redirect(new URL('/portal?error=payment', request.url), 303);
  }
}
