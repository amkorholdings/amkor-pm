import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { Shell } from '@/components/Shell';

export default async function PropertyPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireStaff();
  const { data: property } = await supabase
    .from('properties')
    .select('id, name, address_line1, city, state, postal_code')
    .eq('id', params.id)
    .maybeSingle();
  if (!property) notFound();

  const { data: units } = await supabase
    .from('units')
    .select('id, unit_number, bedrooms, bathrooms, market_rent, leases(id, status)')
    .eq('property_id', property.id)
    .order('unit_number');

  async function addUnit(formData: FormData) {
    'use server';
    const { supabase } = await requireStaff();
    const num = (k: string) => {
      const v = String(formData.get(k) ?? '').trim();
      return v === '' ? null : Number(v);
    };
    const { error } = await supabase.from('units').insert({
      property_id: params.id,
      unit_number: String(formData.get('unit_number') ?? '').trim(),
      bedrooms: num('bedrooms'),
      bathrooms: num('bathrooms'),
      market_rent: num('market_rent'),
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/properties/${params.id}`);
  }

  return (
    <Shell title={property.name}>
      <p>
        {property.address_line1}, {property.city}, {property.state} {property.postal_code}
      </p>

      <h2>Units</h2>
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Unit</th>
            <th>Bed / Bath</th>
            <th>Market rent</th>
            <th>Lease</th>
          </tr>
        </thead>
        <tbody>
          {(units ?? []).map((u) => {
            const active = (u.leases ?? []).find((l) => l.status === 'active');
            return (
              <tr key={u.id} style={{ borderTop: '1px solid #eee' }}>
                <td>{u.unit_number}</td>
                <td>
                  {u.bedrooms ?? '–'} / {u.bathrooms ?? '–'}
                </td>
                <td>{u.market_rent ? `$${u.market_rent}` : '–'}</td>
                <td>{active ? <Link href={`/leases/${active.id}`}>View lease</Link> : 'Vacant'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Add unit</h2>
      <form action={addUnit} style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
        <input name="unit_number" placeholder="Unit number" required />
        <input name="bedrooms" placeholder="Bedrooms" inputMode="decimal" />
        <input name="bathrooms" placeholder="Bathrooms" inputMode="decimal" />
        <input name="market_rent" placeholder="Market rent" inputMode="decimal" />
        <button type="submit">Add unit</button>
      </form>
    </Shell>
  );
}
