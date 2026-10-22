import { vi } from 'vitest';
import { getDb } from '@/server/db';
import { operators, type Operator } from '@/server/db/schema';

export async function createOperator(email = 'op@example.com', name: string | null = 'Olivia'): Promise<Operator> {
  const [operator] = await getDb().insert(operators).values({ email, name }).returning();
  return operator!;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/**
 * Replaces global fetch (used for Mailgun and Slack) with a recorder. `respond` decides the
 * response for each request; by default every call succeeds.
 */
export function recordFetch(respond?: (request: RecordedRequest, index: number) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // keep as text
      }
    } else if (body instanceof FormData) {
      body = Object.fromEntries(body.entries());
    }
    const request = { url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body };
    requests.push(request);
    if (respond) return respond(request, requests.length - 1);
    return Response.json({ ok: true, ts: `ts-${requests.length}` });
  });
  vi.stubGlobal('fetch', mock);
  return requests;
}
