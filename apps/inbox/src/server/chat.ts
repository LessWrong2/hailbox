import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import {
  MAX_EMAIL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  type SendMessageResponse,
  type UpdateVisitorRequest,
  type VisitorServerFrame,
  type VisitorStateResponse,
  type WireMessage,
} from 'hailbox/protocol';
import type { InboxConversation, InboxServerFrame } from '@/lib/inbox-protocol';
import { background } from './background';
import { getBroker, type Channel } from './broker';
import { getDb, type Database } from './db';
import { conversations, messages, operators, visitors, type Conversation, type Operator, type Visitor } from './db/schema';
import { HttpError } from './errors';
import { scheduleReplyNotification } from './notify';
import {
  operatorDisplayName,
  toInboxConversation,
  toWireConversation,
  toWireMessage,
  toWireVisitor,
} from './serialize';
import { forwardMessageToSlack } from './slack';
import { hashToken, newToken } from './tokens';

const PREVIEW_LENGTH = 140;
const MESSAGE_LIMIT = 1000;
/** Visitor messages allowed per minute, across all of a visitor's tabs. */
const VISITOR_RATE_LIMIT = 20;
/** New visitors allowed per IP address per hour. */
const VISITORS_PER_IP_PER_HOUR = 20;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// ---------- input cleaning ----------

function cleanText(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  if (!email) return null;
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'Invalid email address');
  }
  return email;
}

function cleanUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

function messageBody(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'Message is empty');
  const body = value.trim();
  if (body.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, 'Message is too long');
  return body;
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ');
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

// ---------- realtime ----------

async function publish(channel: Channel, frame: VisitorServerFrame | InboxServerFrame) {
  try {
    await getBroker().publish(channel, frame);
  } catch (err) {
    // Clients re-sync from the database on reconnect, so a missed push isn't fatal.
    console.error('[hailbox] publish failed:', err);
  }
}

export async function publishConversation(conversationId: string) {
  const conversation = await getInboxConversation(conversationId);
  if (conversation) await publish('inbox', { type: 'conversation', conversation });
}

// ---------- visitors ----------

export interface RequestContext {
  userAgent?: string | null;
  location?: string | null;
  ip?: string | null;
}

function hashIp(ip: string): string {
  return createHash('sha256').update(`hailbox-ip:${process.env.HAILBOX_SECRET ?? ''}:${ip}`).digest('hex');
}

export async function createVisitor(
  input: { name?: string; email?: string; pageUrl?: string },
  context: RequestContext = {},
): Promise<{ visitor: Visitor; token: string }> {
  const ipHash = context.ip ? hashIp(context.ip) : null;
  if (ipHash) {
    const [recent] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(visitors)
      .where(and(eq(visitors.ipHash, ipHash), gt(visitors.createdAt, sql`now() - interval '1 hour'`)));
    if ((recent?.count ?? 0) >= VISITORS_PER_IP_PER_HOUR) {
      throw new HttpError(429, 'Too many new conversations from your network. Please try again later.');
    }
  }
  const token = newToken();
  let email: string | null = null;
  try {
    email = normalizeEmail(input.email);
  } catch {
    // A bad prefilled address from the host page shouldn't stop someone from chatting.
  }
  const [visitor] = await getDb()
    .insert(visitors)
    .values({
      tokenHash: hashToken(token),
      name: cleanText(input.name, MAX_NAME_LENGTH),
      email,
      userAgent: cleanText(context.userAgent, 500),
      location: cleanText(context.location, 200),
      lastPageUrl: cleanUrl(input.pageUrl),
      ipHash,
    })
    .returning();
  return { visitor: visitor!, token };
}

export async function authenticateVisitor(token: string | null | undefined): Promise<Visitor | null> {
  if (!token) return null;
  const [visitor] = await getDb().select().from(visitors).where(eq(visitors.tokenHash, hashToken(token)));
  return visitor ?? null;
}

export async function updateVisitor(visitor: Visitor, patch: UpdateVisitorRequest): Promise<Visitor> {
  const values: Partial<typeof visitors.$inferInsert> = {};
  if (patch.name !== undefined) values.name = cleanText(patch.name, MAX_NAME_LENGTH);
  if (patch.email !== undefined) {
    values.email = normalizeEmail(patch.email);
    // Giving us an email address is opting in, unless they say otherwise in the same request.
    if (values.email && values.email !== visitor.email) values.notifyByEmail = true;
  }
  if (patch.notifyByEmail !== undefined) values.notifyByEmail = patch.notifyByEmail;
  if (Object.keys(values).length === 0) return visitor;

  const [updated] = await getDb().update(visitors).set(values).where(eq(visitors.id, visitor.id)).returning();
  await publish(`visitor:${visitor.id}`, { type: 'visitor', visitor: toWireVisitor(updated!) });
  const conversation = await findConversation(visitor.id);
  if (conversation) await publishConversation(conversation.id);
  return updated!;
}

export async function unsubscribeVisitor(visitorId: string): Promise<boolean> {
  const updated = await getDb()
    .update(visitors)
    .set({ notifyByEmail: false })
    .where(eq(visitors.id, visitorId))
    .returning({ id: visitors.id });
  if (updated.length === 0) return false;
  const conversation = await findConversation(visitorId);
  if (conversation) await publishConversation(conversation.id);
  return true;
}

// ---------- conversations: visitor side ----------

async function findConversation(visitorId: string): Promise<Conversation | null> {
  const [conversation] = await getDb()
    .select()
    .from(conversations)
    .where(eq(conversations.visitorId, visitorId));
  return conversation ?? null;
}

/**
 * Messages joined with their operator's display name. Ascending by id; with `after`, only newer
 * ones. Without it, the most recent MESSAGE_LIMIT.
 */
async function loadMessages(conversationId: string, after?: number): Promise<WireMessage[]> {
  const db = getDb();
  const where = after
    ? and(eq(messages.conversationId, conversationId), gt(messages.id, after))
    : eq(messages.conversationId, conversationId);
  const rows = await db
    .select({ message: messages, operator: operators })
    .from(messages)
    .leftJoin(operators, eq(operators.id, messages.operatorId))
    .where(where)
    .orderBy(after ? asc(messages.id) : desc(messages.id))
    .limit(MESSAGE_LIMIT);
  if (!after) rows.reverse();
  return rows.map(({ message, operator }) =>
    toWireMessage(message, operator ? operatorDisplayName(operator) : 'Support'),
  );
}

export async function getVisitorState(visitor: Visitor, after?: number): Promise<VisitorStateResponse> {
  const db = getDb();
  await db.update(visitors).set({ lastSeenAt: new Date() }).where(eq(visitors.id, visitor.id));
  const conversation = await findConversation(visitor.id);
  if (!conversation) {
    return { visitor: toWireVisitor(visitor), conversation: null, messages: [], unreadCount: 0 };
  }
  const [unread] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.author, 'operator'),
        gt(messages.id, conversation.visitorLastReadMessageId ?? 0),
      ),
    );
  return {
    visitor: toWireVisitor(visitor),
    conversation: toWireConversation(conversation),
    messages: await loadMessages(conversation.id, after),
    unreadCount: unread?.count ?? 0,
  };
}

/**
 * Locks the conversation row for the rest of the transaction, creating it if needed. Taking
 * the lock before inserting a message means message ids within a conversation are committed
 * in order, so clients can safely use "after <id>" as a cursor.
 */
async function lockVisitorConversation(tx: Tx, visitorId: string, pageUrl: string | null): Promise<Conversation> {
  const [created] = await tx
    .insert(conversations)
    .values({ visitorId, pageUrl })
    .onConflictDoNothing({ target: conversations.visitorId })
    .returning();
  if (created) return created;
  const [existing] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.visitorId, visitorId))
    .for('update');
  return existing!;
}

/** Runs inside the posting transaction, after the conversation lock, so bursts can't race it. */
async function enforceVisitorRateLimit(tx: Tx, visitorId: string) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.visitorId, visitorId),
        eq(messages.author, 'visitor'),
        gt(messages.createdAt, sql`now() - interval '1 minute'`),
      ),
    );
  if ((row?.count ?? 0) >= VISITOR_RATE_LIMIT) {
    throw new HttpError(429, 'You’re sending messages too quickly. Please wait a moment.');
  }
}

export async function postVisitorMessage(
  visitor: Visitor,
  input: { body: unknown; clientId?: string; pageUrl?: string },
): Promise<SendMessageResponse> {
  const body = messageBody(input.body);
  const pageUrl = cleanUrl(input.pageUrl);
  const clientId = typeof input.clientId === 'string' ? input.clientId.slice(0, 100) : undefined;

  const db = getDb();
  const { conversation, message } = await db.transaction(async (tx) => {
    const locked = await lockVisitorConversation(tx, visitor.id, pageUrl);
    await enforceVisitorRateLimit(tx, visitor.id);
    const [message] = await tx
      .insert(messages)
      .values({ conversationId: locked.id, author: 'visitor', body, pageUrl })
      .returning();
    const [conversation] = await tx
      .update(conversations)
      .set({
        status: 'open',
        lastMessageAt: message!.createdAt,
        lastMessageAuthor: 'visitor',
        lastMessagePreview: preview(body),
      })
      .where(eq(conversations.id, locked.id))
      .returning();
    return { conversation: conversation!, message: message! };
  });

  await db
    .update(visitors)
    .set({ lastSeenAt: new Date(), ...(pageUrl ? { lastPageUrl: pageUrl } : {}) })
    .where(eq(visitors.id, visitor.id));

  const wire = toWireMessage(message, null);
  await publish(`visitor:${visitor.id}`, { type: 'message', message: { ...wire, clientId } });
  await publish('inbox', { type: 'message', message: wire });
  await publishConversation(conversation.id);
  background(() => forwardMessageToSlack(message.id));

  return { message: { ...wire, clientId }, conversation: toWireConversation(conversation) };
}

/** Never let a client claim to have read past the newest message that actually exists. */
function clampedReadMark(column: AnyPgColumn, conversationId: string, lastMessageId: number) {
  return sql`greatest(coalesce(${column}, 0), least(${lastMessageId}, (select coalesce(max(${messages.id}), 0) from ${messages} where ${messages.conversationId} = ${conversationId})))`;
}

export async function markVisitorRead(visitor: Visitor, lastMessageId: number): Promise<void> {
  const conversation = await findConversation(visitor.id);
  if (!conversation) return;
  const [updated] = await getDb()
    .update(conversations)
    .set({
      visitorLastReadMessageId: clampedReadMark(
        conversations.visitorLastReadMessageId,
        conversation.id,
        lastMessageId,
      ),
    })
    .where(eq(conversations.id, conversation.id))
    .returning();
  const readId = updated?.visitorLastReadMessageId ?? 0;
  if (readId > (conversation.visitorLastReadMessageId ?? 0)) {
    await publish(`visitor:${visitor.id}`, { type: 'read', lastMessageId: readId });
    await publishConversation(conversation.id);
  }
}

// ---------- conversations: operator side ----------

function unreadCountSql() {
  return sql<number>`(
    select count(*)::int from ${messages}
    where ${messages.conversationId} = ${conversations.id}
      and ${messages.author} = 'visitor'
      and ${messages.id} > coalesce(${conversations.operatorLastReadMessageId}, 0)
  )`;
}

export async function listConversations(options: {
  status: 'open' | 'closed';
  before?: Date;
  limit?: number;
}): Promise<InboxConversation[]> {
  const rows = await getDb()
    .select({ conversation: conversations, visitor: visitors, unreadCount: unreadCountSql() })
    .from(conversations)
    .innerJoin(visitors, eq(visitors.id, conversations.visitorId))
    .where(
      and(
        eq(conversations.status, options.status),
        options.before ? lt(conversations.lastMessageAt, options.before) : undefined,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(Math.min(options.limit ?? 50, 200));
  return rows.map((r) => toInboxConversation(r.conversation, r.visitor, r.unreadCount));
}

export async function getInboxConversation(conversationId: string): Promise<InboxConversation | null> {
  const [row] = await getDb()
    .select({ conversation: conversations, visitor: visitors, unreadCount: unreadCountSql() })
    .from(conversations)
    .innerJoin(visitors, eq(visitors.id, conversations.visitorId))
    .where(eq(conversations.id, conversationId));
  return row ? toInboxConversation(row.conversation, row.visitor, row.unreadCount) : null;
}

export async function getConversationDetail(conversationId: string) {
  const conversation = await getInboxConversation(conversationId);
  if (!conversation) return null;
  return { conversation, messages: await loadMessages(conversationId) };
}

export async function postOperatorMessage(
  operator: Operator,
  conversationId: string,
  input: { body: unknown },
): Promise<WireMessage> {
  const body = messageBody(input.body);
  const { conversation, message } = await getDb().transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update');
    if (!locked) throw new HttpError(404, 'Conversation not found');
    const [message] = await tx
      .insert(messages)
      .values({ conversationId, author: 'operator', operatorId: operator.id, body })
      .returning();
    const [conversation] = await tx
      .update(conversations)
      .set({
        lastMessageAt: message!.createdAt,
        lastMessageAuthor: 'operator',
        lastMessagePreview: preview(body),
        // Replying implies having read everything before the reply.
        operatorLastReadMessageId: message!.id,
      })
      .where(eq(conversations.id, conversationId))
      .returning();
    return { conversation: conversation!, message: message! };
  });

  const wire = toWireMessage(message, operatorDisplayName(operator));
  await publish(`visitor:${conversation.visitorId}`, { type: 'message', message: wire });
  await publish('inbox', { type: 'message', message: wire });
  await publishConversation(conversation.id);
  background(() => forwardMessageToSlack(message.id));
  scheduleReplyNotification(conversation.id, message.id);
  return wire;
}

export async function markOperatorRead(conversationId: string, lastMessageId: number): Promise<void> {
  const db = getDb();
  const [before] = await db
    .select({ readId: conversations.operatorLastReadMessageId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!before) throw new HttpError(404, 'Conversation not found');
  const [after] = await db
    .update(conversations)
    .set({
      operatorLastReadMessageId: clampedReadMark(
        conversations.operatorLastReadMessageId,
        conversationId,
        lastMessageId,
      ),
    })
    .where(eq(conversations.id, conversationId))
    .returning({ readId: conversations.operatorLastReadMessageId });
  // Only broadcast real changes; re-sending the same mark shouldn't wake every operator's inbox.
  if ((after?.readId ?? 0) > (before.readId ?? 0)) await publishConversation(conversationId);
}

export async function setConversationStatus(
  conversationId: string,
  status: 'open' | 'closed',
): Promise<InboxConversation> {
  const updated = await getDb()
    .update(conversations)
    .set({ status })
    .where(eq(conversations.id, conversationId))
    .returning({ id: conversations.id });
  if (updated.length === 0) throw new HttpError(404, 'Conversation not found');
  const conversation = await getInboxConversation(conversationId);
  await publish('inbox', { type: 'conversation', conversation: conversation! });
  return conversation!;
}
