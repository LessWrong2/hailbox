import { describe, expect, it } from 'vitest';
import { socketUrl } from './api';
import type { WireMessage } from './protocol';
import {
  initialWidgetState,
  sessionForUser,
  toDisplayMessages,
  widgetReducer,
  type WidgetAction,
  type WidgetState,
} from './useHailbox';

function message(id: number, overrides: Partial<WireMessage> = {}): WireMessage {
  return {
    id,
    conversationId: 'c1',
    author: 'visitor',
    authorName: null,
    body: `message ${id}`,
    createdAt: new Date(2026, 0, 1, 12, id).toISOString(),
    ...overrides,
  };
}

function run(...actions: WidgetAction[]): WidgetState {
  return actions.reduce(widgetReducer, initialWidgetState);
}

describe('widgetReducer', () => {
  it('replaces an optimistic message with the confirmed one, whichever arrives first', () => {
    const viaResponse = run(
      { type: 'pending', clientId: 'a', body: 'hi' },
      { type: 'confirmed', clientId: 'a', message: message(1, { body: 'hi' }) },
    );
    // The socket echo can beat the HTTP response.
    const viaSocket = run(
      { type: 'pending', clientId: 'a', body: 'hi' },
      { type: 'merge', messages: [message(1, { body: 'hi', clientId: 'a' })] },
      { type: 'confirmed', clientId: 'a', message: message(1, { body: 'hi' }) },
    );
    for (const state of [viaResponse, viaSocket]) {
      expect(state.pending).toEqual([]);
      expect(toDisplayMessages(state).map((m) => [m.body, m.status])).toEqual([['hi', 'sent']]);
    }
  });

  it('keeps messages ordered and deduplicated across merges', () => {
    const state = run({ type: 'merge', messages: [message(3), message(1)] }, { type: 'merge', messages: [message(2), message(3)] });
    expect(state.messages.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('marks failed sends and lets them be retried', () => {
    let state = run({ type: 'pending', clientId: 'a', body: 'hi' }, { type: 'pendingFailed', clientId: 'a' });
    expect(toDisplayMessages(state)[0]?.status).toBe('failed');
    state = widgetReducer(state, { type: 'pendingRetry', clientId: 'a' });
    expect(toDisplayMessages(state)[0]?.status).toBe('sending');
  });

  it('never moves the read marker backwards', () => {
    const state = run({ type: 'read', lastMessageId: 5 }, { type: 'read', lastMessageId: 3 });
    expect(state.lastReadId).toBe(5);
  });

  it('applies incremental state on top of what it already has', () => {
    const visitor = { id: 'v', name: null, email: null, notifyByEmail: true };
    const conversation = { id: 'c1', status: 'open' as const, visitorLastReadMessageId: 2 };
    const state = run(
      { type: 'state', incremental: false, response: { visitor, conversation, messages: [message(1), message(2)], unreadCount: 0 } },
      { type: 'state', incremental: true, response: { visitor, conversation, messages: [message(3)], unreadCount: 0 } },
    );
    expect(state.messages.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(state.lastReadId).toBe(2);
  });
});

describe('socketUrl', () => {
  it('maps http(s) to ws(s) and tolerates trailing slashes', () => {
    expect(socketUrl('https://inbox.example.com/', '/api/v1/ws')).toBe('wss://inbox.example.com/api/v1/ws');
    expect(socketUrl('http://localhost:3000', '/api/v1/ws')).toBe('ws://localhost:3000/api/v1/ws');
  });
});

describe('sessionForUser', () => {
  const anonymous = { visitorId: 'v', token: 't' };
  const alices = { visitorId: 'v', token: 't', userEmail: 'alice@example.com' };

  it("keeps a signed-in user's conversation from the next person on the same browser", () => {
    expect(sessionForUser(alices, 'bob@example.com')).toBeNull();
    expect(sessionForUser(alices, null)).toBeNull(); // Alice signed out
    expect(sessionForUser(alices, 'alice@example.com')).toBe(alices);
  });

  it("doesn't discard anything while the host can't say who is signed in", () => {
    expect(sessionForUser(alices, undefined)).toBe(alices);
    expect(sessionForUser(anonymous, undefined)).toBe(anonymous);
  });

  it('lets an anonymous visitor keep their conversation when they sign in', () => {
    expect(sessionForUser(anonymous, 'alice@example.com')).toEqual(alices);
    expect(sessionForUser(anonymous, null)).toBe(anonymous);
  });
});
