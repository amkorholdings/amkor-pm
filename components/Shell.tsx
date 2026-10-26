import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/properties', label: 'Properties' },
  { href: '/leases/new', label: 'New lease' },
  { href: '/deposits', label: 'Payments' },
  { href: '/import', label: 'Import' },
];

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Amkor PM</div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav-link">
            {n.label}
          </Link>
        ))}
        <form action="/auth/signout" method="post">
          <button type="submit" style={{ background: 'transparent', color: 'var(--sidebar-text)', padding: '9px 12px', textAlign: 'left', width: '100%' }}>
            Sign out
          </button>
        </form>
      </aside>
      <main className="content">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
