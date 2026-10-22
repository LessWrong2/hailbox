'use client';

import { useState, type SubmitEvent } from 'react';
import { inboxApi } from '@/lib/inbox-api';
import { useHydrated } from '@/lib/use-hydrated';
import { Button } from './ui';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setState('sending');
    setError(null);
    try {
      const res = await inboxApi<{ devLink?: string }>('/api/auth/login', { method: 'POST', json: { email } });
      setDevLink(res.devLink ?? null);
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setState('idle');
    }
  };

  if (state === 'sent') {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          If <span className="font-medium text-fg">{email}</span> is allowed to use this inbox, we&rsquo;ve emailed it a
          sign-in link. It expires in 15 minutes.
        </p>
        {devLink && (
          <p className="rounded-lg bg-hover p-3">
            Mailgun isn&rsquo;t configured, so here&rsquo;s the link (development only):{' '}
            <a href={devLink} className="font-medium text-accent hover:underline">
              Sign in
            </a>
          </p>
        )}
        <button type="button" className="text-accent hover:underline" onClick={() => setState('idle')}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted">We&rsquo;ll email you a link to sign in.</p>
      <label htmlFor="email" className="sr-only">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoFocus
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full py-2" disabled={!hydrated || state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
    </form>
  );
}
