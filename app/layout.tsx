import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Amkor PM',
  description: 'Property management for Amkor Holdings',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
