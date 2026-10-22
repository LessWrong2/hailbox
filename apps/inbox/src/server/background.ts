import { waitUntil } from '@vercel/functions';

const pending = new Set<Promise<unknown>>();

/**
 * Run work after the response is sent (Slack forwarding, delayed email notifications).
 * On Vercel, waitUntil keeps the function alive until it settles; elsewhere it just runs.
 */
export function background(task: () => Promise<unknown>): void {
  const promise: Promise<unknown> = task()
    .catch((err) => console.error('[hailbox] background task failed:', err))
    .finally(() => pending.delete(promise));
  pending.add(promise);
  waitUntil(promise);
}

/** For tests: wait for all background work, including work it schedules. */
export async function flushBackground(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
