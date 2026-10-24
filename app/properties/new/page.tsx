import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { Shell } from '@/components/Shell';

export default function NewPropertyPage() {
  async function createProperty(formData: FormData) {
    'use server';
    const { supabase } = await requireStaff();
    const str = (k: string) => String(formData.get(k) ?? '').trim() || null;
    const { data, error } = await supabase
      .from('properties')
      .insert({
        name: str('name'),
        address_line1: str('address_line1'),
        address_line2: str('address_line2'),
        city: str('city'),
        state: str('state'),
        postal_code: str('postal_code'),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    redirect(`/properties/${data.id}`);
  }

  return (
    <Shell title="Add property">
      <form action={createProperty} style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
        <input name="name" placeholder="Property name" required />
        <input name="address_line1" placeholder="Address line 1" required />
        <input name="address_line2" placeholder="Address line 2" />
        <input name="city" placeholder="City" required />
        <input name="state" placeholder="State" required />
        <input name="postal_code" placeholder="ZIP" required />
        <button type="submit">Save property</button>
      </form>
    </Shell>
  );
}
