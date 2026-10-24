import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { Shell } from '@/components/Shell';

export default async function NewLeasePage() {
  const { supabase } = await requireStaff();
  const { data: units } = await supabase
    .from('units')
    .select('id, unit_number, properties(name)')
    .order('unit_number');

  async function createLease(formData: FormData) {
    'use server';
    const { supabase } = await requireStaff();
    const str = (k: string) => String(formData.get(k) ?? '').trim();

    const { data: person, error: pErr } = await supabase
      .from('people')
      .insert({
        first_name: str('first_name'),
        last_name: str('last_name'),
        email: str('email') || null,
        phone: str('phone') || null,
      })
      .select('id')
      .single();
    if (pErr) throw new Error(pErr.message);

    const { data: lease, error: lErr } = await supabase
      .from('leases')
      .insert({
        unit_id: str('unit_id'),
        start_date: str('start_date'),
        end_date: str('end_date') || null,
        monthly_rent: Number(str('monthly_rent')),
        security_deposit: Number(str('security_deposit') || 0),
        status: 'active',
      })
      .select('id')
      .single();
    if (lErr) throw new Error(lErr.message);

    const { error: lpErr } = await supabase
      .from('lease_people')
      .insert({ lease_id: lease.id, person_id: person.id, role: 'tenant' });
    if (lpErr) throw new Error(lpErr.message);

    redirect(`/leases/${lease.id}`);
  }

  return (
    <Shell title="New lease">
      <form action={createLease} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
        <select name="unit_id" required defaultValue="">
          <option value="" disabled>
            Choose a unit
          </option>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {(u.properties as unknown as { name: string } | null)?.name} · Unit {u.unit_number}
            </option>
          ))}
        </select>
        <input name="first_name" placeholder="Tenant first name" required />
        <input name="last_name" placeholder="Tenant last name" required />
        <input name="email" type="email" placeholder="Email" />
        <input name="phone" placeholder="Phone" />
        <label>
          Start date <input name="start_date" type="date" required />
        </label>
        <label>
          End date <input name="end_date" type="date" />
        </label>
        <input name="monthly_rent" placeholder="Monthly rent" inputMode="decimal" required />
        <input name="security_deposit" placeholder="Security deposit" inputMode="decimal" />
        <button type="submit">Create lease</button>
      </form>
    </Shell>
  );
}
