import type { CreateVisitorResponse, SendMessageResponse, VisitorStateResponse } from 'hailbox/protocol';
import { describe, expect, it } from 'vitest';
import * as messagesRoute from '@/app/api/v1/messages/route';
import * as unsubscribeRoute from '@/app/api/v1/unsubscribe/route';
import * as visitorRoute from '@/app/api/v1/visitor/route';
import * as visitorsRoute from '@/app/api/v1/visitors/route';
import { authenticateVisitor } from '@/server/chat';
import { signUnsubscribe } from '@/server/tokens';

const BASE = 'https://inbox.test';

function request(path: string, init: RequestInit & { token?: string; origin?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (init.origin) headers.set('Origin', init.origin);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(BASE + path, { ...init, headers });
}

async function newVisitor(): Promise<CreateVisitorResponse> {
  const res = await visitorsRoute.POST(
    request('/api/v1/visitors', { method: 'POST', body: JSON.stringify({ pageUrl: 'https://acme.test/' }) }),
  );
  expect(res.status).toBe(200);
  return res.json();
}

describe('visitor API', () => {
  it('runs the create → send → fetch flow', async () => {
    const { token, visitor } = await newVisitor();
    const sent = await messagesRoute.POST(
      request('/api/v1/messages', { method: 'POST', token, body: JSON.stringify({ body: 'Hi', clientId: 'x1' }) }),
    );
    expect(sent.status).toBe(200);
    const { message, conversation } = (await sent.json()) as SendMessageResponse;
    expect(message).toMatchObject({ body: 'Hi', clientId: 'x1', author: 'visitor' });

    const state = (await (await visitorRoute.GET(request('/api/v1/visitor', { token }))).json()) as VisitorStateResponse;
    expect(state.visitor.id).toBe(visitor.id);
    expect(state.conversation?.id).toBe(conversation.id);
    expect(state.messages.map((m) => m.body)).toEqual(['Hi']);
  });

  it('requires a valid token', async () => {
    const res = await visitorRoute.GET(request('/api/v1/visitor', { token: 'bogus' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unknown visitor' });
  });

  it('validates input', async () => {
    const { token } = await newVisitor();
    const res = await messagesRoute.POST(
      request('/api/v1/messages', { method: 'POST', token, body: JSON.stringify({ text: 'wrong field' }) }),
    );
    expect(res.status).toBe(400);
    const bad = await visitorRoute.GET(request('/api/v1/visitor?after=-1', { token }));
    expect(bad.status).toBe(400);
  });

  it('answers CORS preflights for allowed origins only', async () => {
    process.env.HAILBOX_ALLOWED_ORIGINS = 'https://acme.test';
    const ok = visitorRoute.OPTIONS(request('/api/v1/visitor', { method: 'OPTIONS', origin: 'https://acme.test' }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://acme.test');
    expect(ok.headers.get('access-control-allow-headers')).toContain('Authorization');

    const denied = visitorRoute.OPTIONS(request('/api/v1/visitor', { method: 'OPTIONS', origin: 'https://evil.test' }));
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();

    const write = await visitorsRoute.POST(
      request('/api/v1/visitors', { method: 'POST', origin: 'https://evil.test', body: '{}' }),
    );
    expect(write.status).toBe(403);
  });

  it('unsubscribes with a signed link only', async () => {
    const { visitor } = await newVisitor();
    const bad = await unsubscribeRoute.POST(request(`/api/v1/unsubscribe?v=${visitor.id}&s=forged`, { method: 'POST' }));
    expect(bad.status).toBe(400);
    const good = await unsubscribeRoute.POST(
      request(`/api/v1/unsubscribe?v=${visitor.id}&s=${signUnsubscribe(visitor.id)}`, { method: 'POST' }),
    );
    expect(good.status).toBe(200);
  });

  it('turns off notifications on unsubscribe', async () => {
    const { token, visitor } = await newVisitor();
    await visitorRoute.PATCH(
      request('/api/v1/visitor', { method: 'PATCH', token, body: JSON.stringify({ email: 'ada@example.com' }) }),
    );
    expect((await authenticateVisitor(token))?.notifyByEmail).toBe(true);
    await unsubscribeRoute.POST(
      request(`/api/v1/unsubscribe?v=${visitor.id}&s=${signUnsubscribe(visitor.id)}`, { method: 'POST' }),
    );
    expect((await authenticateVisitor(token))?.notifyByEmail).toBe(false);
  });
});
