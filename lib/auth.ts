import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

// Use in every staff page and server action. Redirects anyone who is not staff.
export async function requireStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!staff) redirect('/login?error=not-staff');

  return { supabase, user };
}
