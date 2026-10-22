import { describe, expect, it } from 'vitest';
import { getBroker } from '@/server/broker';
import {
  authenticateVisitor,
  createVisitor,
  getVisitorState,
  listConversations,
  markOperatorRead,
  markVisitorRead,
  postOperatorMessage,
  postVisitorMessage,
  setConversationStatus,
  updateVisitor,
} from '@/server/chat';
import { HttpError } from '@/server/errors';
import { createOperator } from './helpers';

describe('visitors', () => {
  it('authenticates by token and never stores the token itself', async () => {
    const { visitor, token } = await createVisitor({ name: ' Ada ', pageUrl: 'https://example.com/pricing' });
    expect(visitor.name).toBe('Ada');
    expect(visitor.tokenHash).not.toContain(token);
    expect((await authenticateVisitor(token))?.id).toBe(visitor.id);
    expect(await authenticateVisitor('wrong')).toBeNull();
    expect(await authenticateVisitor(null)).toBeNull();
  });

  it('ignores an invalid prefilled email rather than failing', async () => {
    const { visitor } = await createVisitor({ email: 'not an email' });
    expect(visitor.email).toBeNull();
  });

  it('limits how many visitors one IP address can create', async () => {
    for (let i = 0; i < 20; i++) await createVisitor({}, { ip: '203.0.113.7' });
    await expect(createVisitor({}, { ip: '203.0.113.7' })).rejects.toMatchObject({ status: 429 });
    await expect(createVisitor({}, { ip: '203.0.113.8' })).resolves.toBeDefined();
  });

  it('opts in to notifications when an email is added', async () => {
    const { visitor } = await createVisitor({});
    const withEmail = await updateVisitor({ ...visitor, notifyByEmail: false }, { email: 'Ada@Example.com' });
    expect(withEmail.email).toBe('ada@example.com');
    expect(withEmail.notifyByEmail).toBe(true);
    await expect(updateVisitor(visitor, { email: 'nope' })).rejects.toThrow(HttpError);
  });
});

describe('conversations', () => {
  it('creates one conversation per visitor and tracks unread replies', async () => {
    const operator = await createOperator();
    const { visitor } = await createVisitor({});

    const first = await postVisitorMessage(visitor, { body: ' Hello? ', clientId: 'c1', pageUrl: 'https://example.com/a' });
    expect(first.message).toMatchObject({ body: 'Hello?', author: 'visitor', clientId: 'c1' });
    const second = await postVisitorMessage(visitor, { body: 'Anyone there?' });
    expect(second.conversation.id).toBe(first.conversation.id);
    expect(second.message.id).toBeGreaterThan(first.message.id);

    const reply = await postOperatorMessage(operator, first.conversation.id, { body: 'Hi! How can I help?' });
    expect(reply.authorName).toBe('Olivia');

    let state = await getVisitorState(visitor);
    expect(state.messages.map((m) => m.body)).toEqual(['Hello?', 'Anyone there?', 'Hi! How can I help?']);
    expect(state.unreadCount).toBe(1);

    const since = await getVisitorState(visitor, second.message.id);
    expect(since.messages.map((m) => m.id)).toEqual([reply.id]);

    await markVisitorRead(visitor, reply.id);
    state = await getVisitorState(visitor);
    expect(state.unreadCount).toBe(0);
    expect(state.conversation?.visitorLastReadMessageId).toBe(reply.id);
  });

  it("won't let a visitor mark messages read that don't exist yet", async () => {
    const operator = await createOperator();
    const { visitor } = await createVisitor({});
    const { conversation } = await postVisitorMessage(visitor, { body: 'hi' });
    await markVisitorRead(visitor, 10_000);
    const reply = await postOperatorMessage(operator, conversation.id, { body: 'hello' });
    const state = await getVisitorState(visitor);
    expect(state.unreadCount).toBe(1);
    expect(state.conversation!.visitorLastReadMessageId).toBeLessThan(reply.id);
  });

  it('creates a single conversation when first messages race', async () => {
    const { visitor } = await createVisitor({});
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => postVisitorMessage(visitor, { body: `message ${i}` })),
    );
    expect(new Set(results.map((r) => r.conversation.id)).size).toBe(1);
    const state = await getVisitorState(visitor);
    expect(state.messages).toHaveLength(5);
  });

  it('rejects empty, oversized, and too-frequent messages', async () => {
    const { visitor } = await createVisitor({});
    await expect(postVisitorMessage(visitor, { body: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(postVisitorMessage(visitor, { body: 'x'.repeat(4001) })).rejects.toMatchObject({ status: 400 });
    for (let i = 0; i < 20; i++) await postVisitorMessage(visitor, { body: `spam ${i}` });
    await expect(postVisitorMessage(visitor, { body: 'one more' })).rejects.toMatchObject({ status: 429 });
  });

  it('reopens a closed conversation when the visitor writes again', async () => {
    const { visitor } = await createVisitor({});
    const { conversation } = await postVisitorMessage(visitor, { body: 'question' });
    await setConversationStatus(conversation.id, 'closed');
    expect(await listConversations({ status: 'open' })).toHaveLength(0);
    await postVisitorMessage(visitor, { body: 'follow-up' });
    const open = await listConversations({ status: 'open' });
    expect(open.map((c) => c.id)).toEqual([conversation.id]);
  });

  it('counts unread visitor messages for operators', async () => {
    const operator = await createOperator();
    const { visitor } = await createVisitor({ email: 'ada@example.com' });
    const { conversation, message } = await postVisitorMessage(visitor, { body: 'one' });
    await postVisitorMessage(visitor, { body: 'two' });
    let [summary] = await listConversations({ status: 'open' });
    expect(summary).toMatchObject({ unreadCount: 2, lastMessagePreview: 'two', lastMessageAuthor: 'visitor' });
    expect(summary!.visitor.email).toBe('ada@example.com');

    await markOperatorRead(conversation.id, message.id);
    [summary] = await listConversations({ status: 'open' });
    expect(summary!.unreadCount).toBe(1);

    await postOperatorMessage(operator, conversation.id, { body: 'reply' });
    [summary] = await listConversations({ status: 'open' });
    expect(summary).toMatchObject({ unreadCount: 0, lastMessageAuthor: 'operator' });
  });

  it('only broadcasts operator read marks that change something', async () => {
    const { visitor } = await createVisitor({});
    const { conversation, message } = await postVisitorMessage(visitor, { body: 'one' });
    const frames: unknown[] = [];
    const off = await getBroker().subscribe('inbox', (f) => frames.push(f));
    await markOperatorRead(conversation.id, message.id);
    await markOperatorRead(conversation.id, message.id);
    await markOperatorRead(conversation.id, message.id - 1);
    off();
    expect(frames).toHaveLength(1);
  });

  it('404s for operator replies to unknown conversations', async () => {
    const operator = await createOperator();
    await expect(
      postOperatorMessage(operator, '00000000-0000-0000-0000-000000000000', { body: 'hi' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('realtime fan-out', () => {
  it('pushes operator replies to the visitor and visitor messages to the inbox', async () => {
    const operator = await createOperator();
    const { visitor } = await createVisitor({});
    const visitorFrames: unknown[] = [];
    const inboxFrames: unknown[] = [];
    const offVisitor = await getBroker().subscribe(`visitor:${visitor.id}`, (f) => visitorFrames.push(f));
    const offInbox = await getBroker().subscribe('inbox', (f) => inboxFrames.push(f));

    const { conversation } = await postVisitorMessage(visitor, { body: 'hello', clientId: 'abc' });
    await postOperatorMessage(operator, conversation.id, { body: 'hi there' });
    offVisitor();
    offInbox();

    expect(visitorFrames).toEqual([
      { type: 'message', message: expect.objectContaining({ body: 'hello', clientId: 'abc' }) },
      { type: 'message', message: expect.objectContaining({ body: 'hi there', authorName: 'Olivia' }) },
    ]);
    expect(inboxFrames).toContainEqual({ type: 'message', message: expect.objectContaining({ body: 'hello' }) });
    expect(inboxFrames).toContainEqual({
      type: 'conversation',
      conversation: expect.objectContaining({ id: conversation.id, lastMessagePreview: 'hi there' }),
    });
  });
});
