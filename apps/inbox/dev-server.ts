/**
 * Local development server: `next dev` plus WebSocket support.
 *
 * On Vercel, the runtime gives each request a context that `upgradeWebSocket()` from
 * @vercel/functions uses to take over the socket. `next dev` has no equivalent (Vercel's docs
 * suggest `vercel dev`, which needs a linked project), so this server provides the same context
 * itself and routes upgrade requests through Next to the real route handlers. Production on
 * Vercel doesn't use this file.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { createServer, ServerResponse, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import next from 'next';

interface RequestContext {
  waitUntil: (promise: Promise<unknown>) => void;
  upgradeWebSocket?: () => { req: IncomingMessage; socket: Socket; head: Buffer };
}

const contexts = new AsyncLocalStorage<RequestContext>();
(globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] = {
  get: () => contexts.getStore(),
};

const waitUntil = (promise: Promise<unknown>) => {
  promise.catch((err) => console.error('[dev-server] waitUntil task failed:', err));
};

const port = Number(process.env.PORT ?? 3000);
// Not $HOSTNAME: Docker and many Linux shells export it, and this dev server lets anyone sign in.
const hostname = process.env.HAILBOX_DEV_HOST ?? 'localhost';
// Next attaches its own 'upgrade' listener to `httpServer` (on the first request). That listener
// serves hot reloading but ends any upgrade aimed at an app route, so instead of our real server
// it gets this stand-in, and we forward only Next's own upgrades to it.
const nextUpgrades = new EventEmitter();
const app = next({ dev: true, hostname, port, dir: import.meta.dirname, httpServer: nextUpgrades as unknown as Server });
await app.prepare();
const handle = app.getRequestHandler();

const server = createServer((req, res) => {
  void contexts.run({ waitUntil }, () => handle(req, res));
});

server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
  // Clients vanishing mid-handshake is normal; without a listener it would crash the server.
  socket.on('error', () => {});
  // Next's own sockets (hot reloading) go to Next's handler.
  if (req.url?.startsWith('/_next/')) {
    if (!nextUpgrades.emit('upgrade', req, socket, head)) socket.destroy();
    return;
  }
  // Anything else goes to the route handler, which accepts it by calling upgradeWebSocket()
  // or rejects it by returning an ordinary response.
  const res = new ServerResponse(req);
  res.assignSocket(socket);
  let upgraded = false;
  res.on('finish', () => {
    if (!upgraded) socket.end();
  });
  const context: RequestContext = {
    waitUntil,
    upgradeWebSocket: () => {
      upgraded = true;
      res.detachSocket(socket);
      return { req, socket, head };
    },
  };
  contexts.run(context, () => handle(req, res)).catch((err) => {
    console.error('[dev-server] upgrade failed:', err);
    socket.destroy();
  });
});

server.listen(port, hostname, () => {
  console.log(`> Hailbox inbox ready on http://${hostname}:${port}`);
});
