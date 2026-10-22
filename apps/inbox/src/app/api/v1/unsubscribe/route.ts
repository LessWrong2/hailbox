import { unsubscribeVisitor } from '@/server/chat';
import { HttpError } from '@/server/errors';
import { verifyUnsubscribe } from '@/server/tokens';

/**
 * Handles both our unsubscribe page and RFC 8058 one-click unsubscribes from mail clients,
 * which POST here directly (from their servers, so there's no Origin to check).
 */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const visitorId = params.get('v') ?? '';
  const signature = params.get('s') ?? '';
  try {
    if (!visitorId || !signature || !verifyUnsubscribe(visitorId, signature)) {
      throw new HttpError(400, 'This unsubscribe link is invalid.');
    }
    await unsubscribeVisitor(visitorId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error('[hailbox] unsubscribe failed:', err);
    return Response.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
