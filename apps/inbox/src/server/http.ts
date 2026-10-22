import { geolocation, ipAddress } from '@vercel/functions';
import { cookies } from 'next/headers';
import type { z } from 'zod';
import { operatorFromSessionToken, SESSION_COOKIE } from './auth';
import { authenticateVisitor, type RequestContext } from './chat';
import type { Operator, Visitor } from './db/schema';
import { allowedOrigins } from './env';
import { HttpError } from './errors';

export { HttpError };

function errorResponse(err: unknown, headers?: Headers): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status, headers });
  }
  console.error('[hailbox] request failed:', err);
  return Response.json({ error: 'Something went wrong' }, { status: 500, headers });
}

function toResponse(result: unknown, headers?: Headers): Response {
  if (result instanceof Response) {
    headers?.forEach((value, key) => result.headers.set(key, value));
    return result;
  }
  return Response.json(result ?? { ok: true }, { headers });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request');
  }
  return result.data;
}

// ---------- visitor API (cross-origin, bearer token) ----------

export function isAllowedOrigin(origin: string | null): boolean {
  const allowed = allowedOrigins();
  if (allowed.includes('*')) return true;
  return origin !== null && allowed.includes(origin);
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  const origin = request.headers.get('origin');
  if (origin && isAllowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** Who's asking, for the inbox's visitor details panel. Location comes from Vercel's edge. */
export function requestContext(request: Request): RequestContext {
  const geo = geolocation(request);
  const location = [geo.city, geo.countryRegion, geo.country].filter(Boolean).join(', ') || null;
  return { userAgent: request.headers.get('user-agent'), location, ip: ipAddress(request) ?? null };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** A visitor API route: CORS, JSON errors, and (unless `auth: false`) bearer-token auth. */
export function visitorRoute(handler: (request: Request, visitor: Visitor) => Promise<unknown>) {
  return async (request: Request): Promise<Response> => {
    const headers = corsHeaders(request);
    try {
      // Browsers enforce CORS on reads; refusing here also stops writes from disallowed sites.
      const origin = request.headers.get('origin');
      if (origin && !isAllowedOrigin(origin)) throw new HttpError(403, 'Origin not allowed');
      const visitor = await authenticateVisitor(bearerToken(request));
      if (!visitor) throw new HttpError(401, 'Unknown visitor');
      return toResponse(await handler(request, visitor), headers);
    } catch (err) {
      return errorResponse(err, headers);
    }
  };
}

export function publicVisitorRoute(handler: (request: Request) => Promise<unknown>) {
  return async (request: Request): Promise<Response> => {
    const headers = corsHeaders(request);
    try {
      const origin = request.headers.get('origin');
      if (origin && !isAllowedOrigin(origin)) throw new HttpError(403, 'Origin not allowed');
      return toResponse(await handler(request), headers);
    } catch (err) {
      return errorResponse(err, headers);
    }
  };
}

// ---------- inbox API (same-origin, session cookie) ----------

/** True when the request's Origin (if any) is this inbox itself. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function currentOperator(): Promise<Operator | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? operatorFromSessionToken(token) : null;
}

type RouteContext<P> = { params: Promise<P> };

/** An inbox API route: requires a signed-in operator, and same-origin for anything but GET. */
export function operatorRoute<P = Record<string, never>>(
  handler: (request: Request, operator: Operator, params: P) => Promise<unknown>,
) {
  return async (request: Request, context: RouteContext<P>): Promise<Response> => {
    try {
      if (request.method !== 'GET' && !isSameOrigin(request)) throw new HttpError(403, 'Cross-origin request');
      const operator = await currentOperator();
      if (!operator) throw new HttpError(401, 'Not signed in');
      return toResponse(await handler(request, operator, await context.params));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** A same-origin route that doesn't need a session (sign-in, unsubscribe). */
export function formRoute(handler: (request: Request) => Promise<unknown>) {
  return async (request: Request): Promise<Response> => {
    try {
      if (!isSameOrigin(request)) throw new HttpError(403, 'Cross-origin request');
      return toResponse(await handler(request));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are untrusted; a malformed id is just a conversation that doesn't exist. */
export function parseConversationId(id: string): string {
  if (!UUID_PATTERN.test(id)) throw new HttpError(404, 'Conversation not found');
  return id;
}
