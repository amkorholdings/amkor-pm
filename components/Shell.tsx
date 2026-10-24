import Link from 'next/link';
import type { ReactNode } from 'react';

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <nav style={{ display: 'flex', gap: '1rem', padding: '1rem 2rem', borderBottom: '1px solid #ddd' }}>
        <strong>Amkor PM</strong>
        <Link href="/properties">Properties</Link>
        <Link href="/leases/new">New lease</Link>
        <Link href="/import">Import</Link>
        <form action="/auth/signout" method="post" style={{ marginLeft: 'auto' }}>
          <button type="submit">Sign out</button>
        </form>
      </nav>
      <main style={{ padding: '2rem' }}>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
