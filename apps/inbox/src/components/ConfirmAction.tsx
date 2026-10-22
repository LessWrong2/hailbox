'use client';

import { useState } from 'react';
import { inboxApi } from '@/lib/inbox-api';
import { useHydrated } from '@/lib/use-hydrated';
import { Button } from './ui';

/**
 * A button that POSTs once clicked. Email links land on pages with one of these rather than
 * acting on GET, because mail scanners prefetch links.
 */
export function ConfirmAction({
  endpoint,
  json,
  label,
  done,
  redirectTo,
}: {
  endpoint: string;
  json?: unknown;
  label: string;
  done?: string;
  redirectTo?: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();

  const run = async () => {
    setState('busy');
    setError(null);
    try {
      await inboxApi(endpoint, { method: 'POST', json: json ?? {} });
      if (redirectTo) window.location.assign(redirectTo);
      else setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setState('idle');
    }
  };

  if (state === 'done') return <p className="text-sm text-muted">{done}</p>;
  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button variant="primary" className="w-full py-2" onClick={run} disabled={!hydrated || state === 'busy'}>
        {state === 'busy' ? 'One moment…' : label}
      </Button>
    </div>
  );
}
