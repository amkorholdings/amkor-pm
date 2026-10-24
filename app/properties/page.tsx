import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { Shell } from '@/components/Shell';

export default async function PropertiesPage() {
  const { supabase } = await requireStaff();
  const { data: properties, error } = await supabase
    .from('properties')
    .select('id, name, address_line1, city, state, units(id)')
    .order('name');

  return (
    <Shell title="Properties">
      <p>
        <Link href="/properties/new">Add property</Link>
      </p>
      {error && <p style={{ color: 'crimson' }}>{error.message}</p>}
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Name</th>
            <th>Address</th>
            <th>Units</th>
          </tr>
        </thead>
        <tbody>
          {(properties ?? []).map((p) => (
            <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
              <td>
                <Link href={`/properties/${p.id}`}>{p.name}</Link>
              </td>
              <td>
                {p.address_line1}, {p.city}, {p.state}
              </td>
              <td>{(p.units ?? []).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}
