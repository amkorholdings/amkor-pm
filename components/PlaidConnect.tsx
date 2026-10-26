'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type PlaidHandler = { open: () => void };
declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void;
        onExit: () => void;
      }) => PlaidHandler;
    };
  }
}

function loadPlaidScript(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Plaid'));
    document.body.appendChild(s);
  });
}

// Opens Plaid Link to connect a bank login, then saves it on the server.
export function PlaidConnect() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);

  async function connect() {
    setStatus('Opening Plaid…');
    try {
      await loadPlaidScript();
      const res = await fetch('/api/plaid/link-token', { method: 'POST' });
      const { link_token, error } = await res.json();
      if (!link_token) throw new Error(error ?? 'Could not start Plaid');

      window.Plaid!.create({
        token: link_token,
        onSuccess: async (publicToken, metadata) => {
          setStatus('Saving…');
          const saved = await fetch('/api/plaid/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token: publicToken, institution_name: metadata.institution?.name ?? null }),
          });
          const json = await saved.json();
          setStatus(saved.ok ? null : json.error ?? 'Could not save the connection');
          router.refresh();
        },
        onExit: () => setStatus(null),
      }).open();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <div>
      <button type="button" onClick={connect}>
        Connect a bank
      </button>
      {status && <p className="muted">{status}</p>}
    </div>
  );
}
