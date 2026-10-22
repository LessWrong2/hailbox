import type { AddressInfo } from 'node:net';
import type { VisitorServerFrame } from 'hailbox/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createVisitor, postOperatorMessage, postVisitorMessage } from '@/server/chat';
import { handleVisitorSocket } from '@/server/sockets';
import { createOperator } from './helpers';

let server: WebSocketServer | null = null;

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve(null));
  server = null;
});

/** A bare ws server running the same handler the /api/v1/ws route hands sockets to. */
async function startServer(): Promise<string> {
  server = new WebSocketServer({ port: 0 });
  server.on('connection', (ws) => handleVisitorSocket(ws));
  await new Promise((resolve) => server!.once('listening', resolve));
  return `ws://localhost:${(server.address() as AddressInfo).port}`;
}

function connect(url: string) {
  const ws = new WebSocket(url);
  const frames: VisitorServerFrame[] = [];
  const waiters: { predicate: (f: VisitorServerFrame) => boolean; resolve: (f: VisitorServerFrame) => void }[] = [];
  ws.on('message', (data) => {
    const frame = JSON.parse(String(data)) as VisitorServerFrame;
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(frame)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(frame);
      }
    }
  });
  const next = (predicate: (f: VisitorServerFrame) => boolean) =>
    new Promise<VisitorServerFrame>((resolve) => {
      const existing = frames.find(predicate);
      if (existing) resolve(existing);
      else waiters.push({ predicate, resolve });
    });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const opened = new Promise((resolve) => ws.on('open', resolve));
  return { ws, frames, next, closed, opened };
}

describe('visitor socket', () => {
  it('authenticates, then delivers operator replies live', async () => {
    const url = await startServer();
    const operator = await createOperator();
    const { visitor, token } = await createVisitor({});
    const { conversation } = await postVisitorMessage(visitor, { body: 'hello' });

    const client = connect(url);
    await client.opened;
    client.ws.send(JSON.stringify({ type: 'auth', token }));
    await client.next((f) => f.type === 'ready');

    client.ws.send(JSON.stringify({ type: 'ping' }));
    await client.next((f) => f.type === 'pong');

    await postOperatorMessage(operator, conversation.id, { body: 'live reply' });
    const frame = await client.next((f) => f.type === 'message');
    expect(frame).toMatchObject({ type: 'message', message: { body: 'live reply', author: 'operator' } });
    client.ws.close();
  });

  it('closes with 4001 for a bad token so the client stops retrying', async () => {
    const url = await startServer();
    const client = connect(url);
    await client.opened;
    client.ws.send(JSON.stringify({ type: 'auth', token: 'bogus' }));
    expect(await client.closed).toBe(4001);
  });

  it('ignores garbage frames', async () => {
    const url = await startServer();
    const { token } = await createVisitor({});
    const client = connect(url);
    await client.opened;
    client.ws.send('not json');
    client.ws.send(JSON.stringify({ type: 'auth', token }));
    await client.next((f) => f.type === 'ready');
    client.ws.close();
  });
});
