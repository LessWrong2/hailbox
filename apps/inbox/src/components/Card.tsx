import type { ReactNode } from 'react';

/** Centered card used by the sign-in and unsubscribe pages. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-7 shadow-sm ring-1 ring-line">
        <h1 className="mb-1 text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
