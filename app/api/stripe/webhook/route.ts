import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyStripeEvent } from '@/lib/stripe';

const today = () => new Date().toISOString().slice(0, 10);

// POST /api/stripe/webhook
// In the Stripe dashboard, send these events here: checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
// checkout.session.expired, charge.dispute.created.
export async function POST(request: NextRequest) {
  let event;
  try {
    event = verifyStripeEvent(await request.text(), request.headers.get('stripe-signature'));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const admin = createAdminClient();
  const obj = event.data.object;
  const paymentId = (obj.metadata as Record<string, string> | undefined)?.payment_id;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        if (!paymentId) break;
        // Card payments are paid at once. ACH settles days later and arrives as async_payment_succeeded.
        const paid = obj.payment_status === 'paid';
        await admin
          .from('payments')
          .update({ method: paid ? 'card' : 'ach', stripe_payment_intent_id: obj.payment_intent })
          .eq('id', paymentId);
        if (paid) await post(admin, paymentId, 'Card payment');
        break;
      }
      case 'checkout.session.async_payment_succeeded':
        if (paymentId) await post(admin, paymentId, 'ACH payment');
        break;
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        if (paymentId) await admin.from('payments').update({ status: 'failed' }).eq('id', paymentId).eq('status', 'pending');
        break;
      case 'charge.dispute.created': {
        const { data: payment } = await admin
          .from('payments')
          .select('id')
          .eq('stripe_payment_intent_id', String(obj.payment_intent))
          .maybeSingle();
        if (payment) {
          const { error } = await admin.rpc('return_payment', {
            p_payment_id: payment.id,
            p_entry_date: today(),
            p_description: `Payment disputed (${obj.reason ?? 'no reason given'})`,
          });
          if (error) throw new Error(error.message);
        }
        break;
      }
    }
  } catch (e) {
    // A 500 makes Stripe retry. The posting functions are safe to run twice.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function post(admin: ReturnType<typeof createAdminClient>, paymentId: string, description: string) {
  const { error } = await admin.rpc('post_payment', {
    p_payment_id: paymentId,
    p_entry_date: today(),
    p_description: description,
  });
  if (error) throw new Error(error.message);
}
