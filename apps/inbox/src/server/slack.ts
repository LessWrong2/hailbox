import { and, eq, isNull } from 'drizzle-orm';
import { visitorLabel } from '@/lib/inbox-protocol';
import { getDb } from './db';
import { conversations, messages, operators, visitors, type Message, type Visitor } from './db/schema';
import { inboxUrl, slackConfig, type SlackConfig } from './env';
import { operatorDisplayName } from './serialize';

/** Marks a conversation whose Slack parent message is being posted right now. */
const PENDING = 'pending';

export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function quote(text: string): string {
  return escapeSlack(text)
    .split('\n')
    .map((line) => `>${line}`)
    .join('\n');
}

function pageLink(pageUrl: string | null): string {
  if (!pageUrl) return '';
  try {
    const url = new URL(pageUrl);
    // "|" separates a Slack link's URL from its label, and URLs may legally contain it.
    const href = url.toString().replace(/\|/g, '%7C');
    const label = escapeSlack(url.host + url.pathname).replace(/\|/g, '¦');
    return ` on <${href}|${label}>`;
  } catch {
    return '';
  }
}

/** Slack sometimes hangs; don't let one call hold a function (and a thread claim) for minutes. */
const SLACK_TIMEOUT_MS = 10_000;

async function postToSlack(config: SlackConfig, payload: Record<string, unknown>): Promise<string | null> {
  if (config.kind === 'webhook') {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Slack webhook responded ${res.status}: ${await res.text()}`);
    return null;
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ channel: config.channel, unfurl_links: false, unfurl_media: false, ...payload }),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; ts?: string; error?: string } | null;
  if (!res.ok || !data?.ok) throw new Error(`Slack chat.postMessage failed: ${data?.error ?? res.status}`);
  return data.ts ?? null;
}

interface MessageContext {
  message: Message;
  visitor: Visitor;
  operatorName: string | null;
  conversationId: string;
  pageUrl: string | null;
}

function threadReplyText({ message, visitor, operatorName }: MessageContext): string {
  return message.author === 'visitor'
    ? `*${escapeSlack(visitorLabel(visitor))}:*\n${escapeSlack(message.body)}`
    : `:leftwards_arrow_with_hook: *${escapeSlack(operatorName ?? 'Support')}* replied:\n${escapeSlack(message.body)}`;
}

function parentText({ message, visitor, conversationId, pageUrl, operatorName }: MessageContext): string {
  const who = escapeSlack(visitorLabel(visitor));
  const opener =
    message.author === 'visitor'
      ? `:speech_balloon: *${who}* started a conversation${pageLink(pageUrl)}`
      : `:speech_balloon: Conversation with *${who}* (${escapeSlack(operatorName ?? 'Support')} replied)`;
  return `${opener}\n${quote(message.body)}\n<${inboxUrl()}/?c=${conversationId}|Open in inbox>`;
}

/**
 * Finds (or creates, by posting the parent message) the Slack thread for a conversation.
 * Returns the thread ts and whether creating it already posted `context.message`.
 */
async function ensureThread(
  config: SlackConfig & { kind: 'bot' },
  context: MessageContext,
): Promise<{ ts: string; postedMessage: boolean } | null> {
  const db = getDb();
  for (let attempt = 0; attempt < 40; attempt++) {
    const [row] = await db
      .select({ ts: conversations.slackThreadTs })
      .from(conversations)
      .where(eq(conversations.id, context.conversationId));
    if (!row) return null;
    if (row.ts && row.ts !== PENDING) return { ts: row.ts, postedMessage: false };
    if (!row.ts) {
      const claimed = await db
        .update(conversations)
        .set({ slackThreadTs: PENDING })
        .where(and(eq(conversations.id, context.conversationId), isNull(conversations.slackThreadTs)))
        .returning({ id: conversations.id });
      if (claimed.length > 0) {
        try {
          const ts = await postToSlack(config, { text: parentText(context) });
          if (!ts) throw new Error('Slack did not return a message ts');
          await db.update(conversations).set({ slackThreadTs: ts }).where(eq(conversations.id, context.conversationId));
          return { ts, postedMessage: true };
        } catch (err) {
          await db
            .update(conversations)
            .set({ slackThreadTs: null })
            .where(and(eq(conversations.id, context.conversationId), eq(conversations.slackThreadTs, PENDING)));
          throw err;
        }
      }
    }
    // Someone else is posting the parent message; wait for its ts.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export async function forwardMessageToSlack(messageId: number): Promise<void> {
  const config = slackConfig();
  if (!config) return;

  const [row] = await getDb()
    .select({ message: messages, conversation: conversations, visitor: visitors, operator: operators })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(visitors, eq(visitors.id, conversations.visitorId))
    .leftJoin(operators, eq(operators.id, messages.operatorId))
    .where(eq(messages.id, messageId));
  if (!row) return;

  const context: MessageContext = {
    message: row.message,
    visitor: row.visitor,
    operatorName: row.operator ? operatorDisplayName(row.operator) : null,
    conversationId: row.conversation.id,
    pageUrl: row.conversation.pageUrl,
  };

  if (config.kind === 'webhook') {
    // Webhooks can't thread, so each message stands alone with a link back to the inbox.
    const link = `<${inboxUrl()}/?c=${context.conversationId}|Open in inbox>`;
    await postToSlack(config, { text: `${threadReplyText(context)}\n${link}` });
    return;
  }

  const thread = await ensureThread(config, context);
  if (thread?.postedMessage) return;
  await postToSlack(config, { text: threadReplyText(context), ...(thread ? { thread_ts: thread.ts } : {}) });
}
