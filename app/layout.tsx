import type { ReactNode } from 'react';

export const metadata = {
  title: 'Amkor PM',
  description: 'Property management for Amkor Holdings',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>{children}</body>
    </html>
  );
}
