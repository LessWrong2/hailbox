import { upgradeWebSocket } from '@vercel/functions';
import { cookies } from 'next/headers';
import { operatorFromSessionToken, SESSION_COOKIE } from '@/server/auth';
import { isSameOrigin } from '@/server/http';
import { handleInboxSocket } from '@/server/sockets';

export const dynamic = 'force-dynamic';
// See the note in /api/v1/ws: the client reconnects when this limit closes the socket.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade', { status: 426 });
  }
  // Browsers send cookies on cross-site WebSocket handshakes in some cases, so check Origin.
  if (!request.headers.get('origin') || !isSameOrigin(request)) {
    return new Response('Cross-origin request', { status: 403 });
  }
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session || !(await operatorFromSessionToken(session))) return new Response('Not signed in', { status: 401 });
  return upgradeWebSocket((ws) => handleInboxSocket(ws, session));
}
