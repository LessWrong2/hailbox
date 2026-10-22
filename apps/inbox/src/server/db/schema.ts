import { bigint, bigserial, boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const visitors = pgTable(
  'visitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the visitor's bearer token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    name: text('name'),
    email: text('email'),
    notifyByEmail: boolean('notify_by_email').notNull().default(true),
    userAgent: text('user_agent'),
    /** "City, Region, Country" from Vercel's geolocation headers, when available. */
    location: text('location'),
    lastPageUrl: text('last_page_url'),
    /** Salted hash of the creating IP, only for rate-limiting visitor creation. */
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('visitors_ip_hash_created_at_idx').on(t.ipHash, t.createdAt)],
);

export const operators = pgTable('operators', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: createdAt(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // One conversation per visitor for now; closed conversations reopen when the visitor writes again.
    visitorId: uuid('visitor_id')
      .notNull()
      .unique()
      .references(() => visitors.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    /** Page the conversation started on; notification emails link back here. */
    pageUrl: text('page_url'),
    createdAt: createdAt(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAuthor: text('last_message_author', { enum: ['visitor', 'operator'] }),
    lastMessagePreview: text('last_message_preview'),
    visitorLastReadMessageId: bigint('visitor_last_read_message_id', { mode: 'number' }),
    operatorLastReadMessageId: bigint('operator_last_read_message_id', { mode: 'number' }),
    /** Highest operator message id that the visitor has been emailed about. */
    lastNotifiedMessageId: bigint('last_notified_message_id', { mode: 'number' }),
    /** Slack thread for this conversation; "pending" while the parent message is being posted. */
    slackThreadTs: text('slack_thread_ts'),
  },
  (t) => [index('conversations_status_last_message_idx').on(t.status, t.lastMessageAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    author: text('author', { enum: ['visitor', 'operator'] }).notNull(),
    operatorId: uuid('operator_id').references(() => operators.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    /** For visitor messages: the page they were on when they sent it. */
    pageUrl: text('page_url'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation_id_idx').on(t.conversationId, t.id)],
);

export const loginTokens = pgTable('login_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  operatorId: uuid('operator_id')
    .notNull()
    .references(() => operators.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export type Visitor = typeof visitors.$inferSelect;
export type Operator = typeof operators.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
