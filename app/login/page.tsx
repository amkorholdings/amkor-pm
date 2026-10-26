import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { sent?: string; error?: string };
}) {
  async function sendLink(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const origin =
      (await headers()).get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const supabase = await createClient();
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
  }

  return (
    <main className="login">
      <h1>Sign in</h1>
      {searchParams.error === 'not-staff' && (
        <p className="error">This account is not set up for staff access.</p>
      )}
      {searchParams.sent ? (
        <p>Check your email for the sign-in link.</p>
      ) : (
        <form action={sendLink} style={{ display: 'grid', gap: 12 }}>
          <label>
            Email
            <input name="email" type="email" required style={{ marginTop: 6 }} />
          </label>
          <button type="submit">Send sign-in link</button>
        </form>
      )}
    </main>
  );
}
