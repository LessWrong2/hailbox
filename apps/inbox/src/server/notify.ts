import { and, asc, eq, gt, isNull, lt, max, or } from 'drizzle-orm';
import { background } from './background';
import { getDb } from './db';
import { conversations, messages, operators, visitors, type Conversation, type Visitor } from './db/schema';
import { emailButton, emailLayout, escapeHtml, sendEmail, type OutgoingEmail } from './email';
import { allowedOrigins, inboxUrl, notifyDelayMs, siteName } from './env';
import { operatorDisplayName } from './serialize';
import { signUnsubscribe } from './tokens';

/**
 * After an operator replies, wait a bit and email the visitor if they still haven't seen it.
 * The wait doubles as a debounce: if the operator sends several messages in a row, only the
 * check for the last one sends an email, and it includes all of them.
 */
export function scheduleReplyNotification(conversationId: string, messageId: number): void {
  background(async () => {
    const delay = notifyDelayMs();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    await sendReplyNotificationIfUnread(conversationId, messageId);
  });
}

export type NotifyOutcome = 'sent' | 'not-sent' | 'no-email' | 'read' | 'superseded' | 'already-notified' | 'missing';

export async function sendReplyNotificationIfUnread(
  conversationId: string,
  messageId: number,
): Promise<NotifyOutcome> {
  const db = getDb();
  const [row] = await db
    .select({ conversation: conversations, visitor: visitors })
    .from(conversations)
    .innerJoin(visitors, eq(visitors.id, conversations.visitorId))
    .where(eq(conversations.id, conversationId));
  if (!row) return 'missing';
  const { conversation, visitor } = row;
  if (!visitor.email || !visitor.notifyByEmail) return 'no-email';
  const lastRead = conversation.visitorLastReadMessageId ?? 0;
  if (lastRead >= messageId) return 'read';

  const [latest] = await db
    .select({ id: max(messages.id) })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.author, 'operator')));
  if ((latest?.id ?? 0) > messageId) return 'superseded';

  const previous = conversation.lastNotifiedMessageId ?? 0;
  if (previous >= messageId) return 'already-notified';
  // Claim this notification so concurrent checks (or retried functions) can't double-send.
  const claimed = await db
    .update(conversations)
    .set({ lastNotifiedMessageId: messageId })
    .where(
      and(
        eq(conversations.id, conversationId),
        or(isNull(conversations.lastNotifiedMessageId), lt(conversations.lastNotifiedMessageId, messageId)),
      ),
    )
    .returning({ id: conversations.id });
  if (claimed.length === 0) return 'already-notified';

  const unread = await db
    .select({ body: messages.body, operator: operators })
    .from(messages)
    .leftJoin(operators, eq(operators.id, messages.operatorId))
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.author, 'operator'),
        gt(messages.id, Math.max(previous, lastRead)),
      ),
    )
    .orderBy(asc(messages.id));

  try {
    const delivered = await sendEmail(
      replyNotificationEmail(
        visitor as Visitor & { email: string },
        conversation,
        unread.map((m) => ({ body: m.body, authorName: m.operator ? operatorDisplayName(m.operator) : null })),
      ),
    );
    return delivered ? 'sent' : 'not-sent';
  } catch (err) {
    // Release the claim so the next reply's check can try again.
    await db
      .update(conversations)
      .set({ lastNotifiedMessageId: conversation.lastNotifiedMessageId })
      .where(and(eq(conversations.id, conversationId), eq(conversations.lastNotifiedMessageId, messageId)));
    throw err;
  }
}

/**
 * The page the conversation started on, with a flag that makes the widget open itself.
 *
 * Visitors report pageUrl themselves, so it could point anywhere; linking to it from an email
 * sent by your domain would be a phishing vector. We only link to pages on the origins listed
 * in HAILBOX_ALLOWED_ORIGINS (so with the default "*", emails carry no link).
 */
export function conversationPageLink(pageUrl: string | null): string | null {
  if (!pageUrl) return null;
  try {
    const url = new URL(pageUrl);
    if (!allowedOrigins().includes(url.origin)) return null;
    url.searchParams.set('hailbox', 'open');
    return url.toString();
  } catch {
    return null;
  }
}

export function unsubscribeLinks(visitorId: string) {
  const query = `v=${encodeURIComponent(visitorId)}&s=${signUnsubscribe(visitorId)}`;
  return {
    page: `${inboxUrl()}/unsubscribe?${query}`,
    oneClick: `${inboxUrl()}/api/v1/unsubscribe?${query}`,
  };
}

export function replyNotificationEmail(
  visitor: Visitor & { email: string },
  conversation: Conversation,
  replies: { body: string; authorName: string | null }[],
): OutgoingEmail {
  const site = siteName();
  const names = [...new Set(replies.map((r) => r.authorName).filter(Boolean))];
  const who = names.length === 1 ? `${names[0]} from ${site}` : site;
  const link = conversationPageLink(conversation.pageUrl);
  const unsubscribe = unsubscribeLinks(visitor.id);
  const replyWord = replies.length === 1 ? 'a reply' : `${replies.length} replies`;

  const text = [
    `${who} sent you ${replyWord}:`,
    '',
    ...replies.map((r) => r.body.replace(/^/gm, '> ')),
    '',
    link ? `Continue the conversation: ${link}` : `Visit ${site} to continue the conversation.`,
    '',
    `Don't want these emails? ${unsubscribe.page}`,
  ].join('\n');

  const quoted = replies
    .map(
      (r) =>
        `<div style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:#f1f2f6;white-space:pre-wrap;">${escapeHtml(r.body)}</div>`,
    )
    .join('');
  const html = emailLayout(
    `<p style="margin:0 0 16px;">${escapeHtml(who)} sent you ${replyWord}:</p>
${quoted}
<p style="margin:20px 0 0;">${link ? emailButton(link, 'Continue the conversation') : `Visit ${escapeHtml(site)} to continue the conversation.`}</p>`,
    `You're getting this because you asked to be notified about replies to your message to ${escapeHtml(site)}. <a href="${escapeHtml(unsubscribe.page)}" style="color:#6b7280;">Unsubscribe</a>`,
  );

  return {
    to: visitor.email,
    subject: `New reply from ${site}`,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${unsubscribe.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
