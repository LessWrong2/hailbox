import type { WebSocket } from 'ws';
import type { VisitorClientFrame, VisitorServerFrame } from 'hailbox/protocol';
import type { InboxServerFrame } from '@/lib/inbox-protocol';
import { operatorFromSessionToken } from './auth';
import { getBroker } from './broker';
import { authenticateVisitor } from './chat';

/**
 * Matches CLOSE_UNAUTHORIZED in the widget: the token was rejected, so the client discards it
 * and stops reconnecting. Only send it for a definite rejection, never for slowness or errors.
 */
const CLOSE_UNAUTHORIZED = 4001;
/** The client never sent its auth frame; it should simply reconnect. */
const CLOSE_AUTH_TIMEOUT = 4000;
const AUTH_TIMEOUT_MS = 10_000;
/** How often an operator socket re-checks that its session is still valid. */
const SESSION_RECHECK_MS = 60_000;

function parseFrame(data: unknown): { type?: unknown; [key: string]: unknown } | null {
  try {
    const frame: unknown = JSON.parse(String(data));
    return frame && typeof frame === 'object' ? (frame as { type?: unknown }) : null;
  } catch {
    return null;
  }
}

function sender<Frame>(ws: WebSocket) {
  return (frame: Frame) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };
}

/**
 * Visitor sockets authenticate with their first frame rather than the URL, so the token
 * never shows up in request logs.
 */
export function handleVisitorSocket(ws: WebSocket): void {
  const send = sender<VisitorServerFrame>(ws);
  let state: 'awaiting-auth' | 'authenticating' | 'ready' | 'closed' = 'awaiting-auth';
  let unsubscribe: (() => void) | null = null;

  // Only waits for the auth frame to arrive; a slow lookup after that isn't the client's fault.
  const authTimer = setTimeout(() => {
    if (state === 'awaiting-auth') ws.close(CLOSE_AUTH_TIMEOUT, 'auth timeout');
  }, AUTH_TIMEOUT_MS);

  ws.on('message', async (data) => {
    const frame = parseFrame(data) as VisitorClientFrame | null;
    if (!frame) return;
    if (frame.type === 'ping') {
      send({ type: 'pong' });
      return;
    }
    if (frame.type !== 'auth' || state !== 'awaiting-auth') return;
    state = 'authenticating';
    clearTimeout(authTimer);
    try {
      const visitor = await authenticateVisitor(typeof frame.token === 'string' ? frame.token : null);
      if (!visitor) {
        ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
      const off = await getBroker().subscribe(`visitor:${visitor.id}`, (payload) =>
        send(payload as VisitorServerFrame),
      );
      // The socket may have closed while we were subscribing.
      if (ws.readyState !== ws.OPEN) {
        off();
        return;
      }
      unsubscribe = off;
      state = 'ready';
      send({ type: 'ready' });
    } catch (err) {
      console.error('[hailbox] visitor socket auth failed:', err);
      ws.close(1011, 'server error');
    }
  });

  ws.on('close', () => {
    state = 'closed';
    clearTimeout(authTimer);
    unsubscribe?.();
  });
  ws.on('error', (err) => console.error('[hailbox] visitor socket error:', err.message));
}

/**
 * Operator sockets are authenticated by session cookie before the upgrade, then re-checked
 * periodically so signing out (or being removed from OPERATOR_EMAILS) cuts the feed.
 */
export function handleInboxSocket(ws: WebSocket, sessionToken: string): void {
  const send = sender<InboxServerFrame>(ws);
  let closed = false;
  let unsubscribe: (() => void) | null = null;

  const recheck = setInterval(() => {
    operatorFromSessionToken(sessionToken)
      .then((operator) => {
        if (!operator) ws.close(CLOSE_UNAUTHORIZED, 'session ended');
      })
      .catch(() => {});
  }, SESSION_RECHECK_MS);

  ws.on('message', (data) => {
    if (parseFrame(data)?.type === 'ping') send({ type: 'pong' });
  });
  ws.on('close', () => {
    closed = true;
    clearInterval(recheck);
    unsubscribe?.();
  });
  ws.on('error', (err) => console.error('[hailbox] inbox socket error:', err.message));

  getBroker()
    .subscribe('inbox', (payload) => send(payload as InboxServerFrame))
    .then((off) => {
      if (closed) {
        off();
        return;
      }
      unsubscribe = off;
      send({ type: 'ready' });
    })
    .catch((err) => {
      console.error('[hailbox] inbox socket subscribe failed:', err);
      ws.close(1011, 'server error');
    });
}
