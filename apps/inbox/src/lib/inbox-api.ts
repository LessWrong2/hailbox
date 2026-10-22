/** Fetch wrapper for the inbox's own API; sends the operator to sign in when their session ends. */
export async function inboxApi<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.json === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  if (res.status === 401) {
    window.location.assign('/login');
    throw new Error('Signed out');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}
