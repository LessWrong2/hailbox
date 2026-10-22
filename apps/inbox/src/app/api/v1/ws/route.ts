import { upgradeWebSocket } from '@vercel/functions';
import { isAllowedOrigin } from '@/server/http';
import { handleVisitorSocket } from '@/server/sockets';

export const dynamic = 'force-dynamic';
// Sockets close when the function hits its max duration and the widget reconnects.
// 300s is the Hobby maximum; Pro plans can raise this to 800.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade', { status: 426 });
  }
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return new Response('Origin not allowed', { status: 403 });
  }
  return upgradeWebSocket(handleVisitorSocket, { maxPayload: 16 * 1024 });
}
