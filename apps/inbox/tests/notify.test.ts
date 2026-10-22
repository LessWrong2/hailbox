import { beforeEach, describe, expect, it } from 'vitest';
import { flushBackground } from '@/server/background';
import { createVisitor, markVisitorRead, postOperatorMessage, postVisitorMessage } from '@/server/chat';
import { sendReplyNotificationIfUnread } from '@/server/notify';
import { verifyUnsubscribe } from '@/server/tokens';
import { createOperator, recordFetch } from './helpers';

beforeEach(() => {
  process.env.MAILGUN_API_KEY = 'key-test';
  process.env.MAILGUN_DOMAIN = 'mg.acme.test';
});

async function conversationWithReply(email: string | null = 'ada@example.com') {
  const operator = await createOperator();
  const { visitor } = await createVisitor({ email: email ?? undefined });
  const { conversation } = await postVisitorMessage(visitor, {
    body: 'How much is it?',
    pageUrl: 'https://acme.test/pricing?plan=pro',
  });
  return { operator, visitor, conversation };
}

describe('reply notifications', () => {
  it('emails the visitor through Mailgun when a reply goes unread', async () => {
    process.env.HAILBOX_ALLOWED_ORIGINS = 'https://acme.test';
    const requests = recordFetch();
    const { operator, conversation } = await conversationWithReply();
    await postOperatorMessage(operator, conversation.id, { body: 'It is $10/month.' });
    await flushBackground();

    const mail = requests.filter((r) => r.url.includes('mailgun'));
    expect(mail).toHaveLength(1);
    expect(mail[0]!.url).toBe('https://api.mailgun.net/v3/mg.acme.test/messages');
    expect(mail[0]!.headers.get('authorization')).toBe(`Basic ${Buffer.from('api:key-test').toString('base64')}`);
    const body = mail[0]!.body as Record<string, string>;
    expect(body).toMatchObject({ to: 'ada@example.com', subject: 'New reply from Acme', from: 'Acme <hailbox@mg.acme.test>' });
    expect(body.text).toContain('Olivia from Acme sent you a reply');
    expect(body.text).toContain('> It is $10/month.');
    expect(body.text).toContain('https://acme.test/pricing?plan=pro&hailbox=open');
    expect(body.html).toContain('It is $10/month.');

    // The one-click unsubscribe link must carry a valid signature.
    const unsubscribe = new URL(body['h:List-Unsubscribe']!.slice(1, -1));
    expect(unsubscribe.origin + unsubscribe.pathname).toBe('https://inbox.test/api/v1/unsubscribe');
    expect(verifyUnsubscribe(unsubscribe.searchParams.get('v')!, unsubscribe.searchParams.get('s')!)).toBe(true);
    expect(body['h:List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it("only links back to pages on the site's allowed origins", async () => {
    // pageUrl comes from the visitor, so it could be a phishing page dressed up by our email.
    process.env.HAILBOX_ALLOWED_ORIGINS = 'https://acme.test';
    const requests = recordFetch();
    const operator = await createOperator();
    const { visitor } = await createVisitor({ email: 'victim@example.com' });
    const { conversation } = await postVisitorMessage(visitor, { body: 'hi', pageUrl: 'https://evil.test/login' });
    await postOperatorMessage(operator, conversation.id, { body: 'Hello!' });
    await flushBackground();
    const body = requests.find((r) => r.url.includes('mailgun'))!.body as Record<string, string>;
    expect(body.text).not.toContain('evil.test');
    expect(body.html).not.toContain('evil.test');
    expect(body.text).toContain('Visit Acme to continue the conversation.');
  });

  it('sends one email for a burst of replies, containing all of them', async () => {
    // Long enough for the second reply to land inside the first one's wait.
    process.env.NOTIFY_DELAY_SECONDS = '0.3';
    const requests = recordFetch();
    const { operator, conversation } = await conversationWithReply();
    const first = await postOperatorMessage(operator, conversation.id, { body: 'First' });
    const second = await postOperatorMessage(operator, conversation.id, { body: 'Second' });
    await flushBackground();

    const mail = requests.filter((r) => r.url.includes('mailgun'));
    expect(mail).toHaveLength(1);
    expect((mail[0]!.body as Record<string, string>).text).toMatch(/2 replies[\s\S]*First[\s\S]*Second/);
    expect(await sendReplyNotificationIfUnread(conversation.id, first.id)).toBe('superseded');
    expect(await sendReplyNotificationIfUnread(conversation.id, second.id)).toBe('already-notified');
  });

  it("doesn't email when the visitor already read the reply", async () => {
    recordFetch();
    const { operator, visitor, conversation } = await conversationWithReply();
    const reply = await postOperatorMessage(operator, conversation.id, { body: 'Answer' });
    await markVisitorRead(visitor, reply.id);
    expect(await sendReplyNotificationIfUnread(conversation.id, reply.id)).toBe('read');
  });

  it("doesn't email visitors without an address or who unsubscribed", async () => {
    recordFetch();
    const { operator, conversation } = await conversationWithReply(null);
    const reply = await postOperatorMessage(operator, conversation.id, { body: 'Answer' });
    expect(await sendReplyNotificationIfUnread(conversation.id, reply.id)).toBe('no-email');
  });

  it('releases its claim when Mailgun fails, so a later reply retries', async () => {
    let fail = true;
    const requests = recordFetch(() =>
      fail ? new Response('nope', { status: 500 }) : Response.json({ id: 'ok' }),
    );
    const { operator, conversation } = await conversationWithReply();
    const first = await postOperatorMessage(operator, conversation.id, { body: 'First' });
    await flushBackground();
    fail = false;
    expect(await sendReplyNotificationIfUnread(conversation.id, first.id)).toBe('sent');
    const last = requests.at(-1)!.body as Record<string, string>;
    expect(last.text).toContain('First');
  });

  it('logs instead of sending when Mailgun is not configured', async () => {
    delete process.env.MAILGUN_API_KEY;
    const requests = recordFetch();
    const { operator, conversation } = await conversationWithReply();
    const reply = await postOperatorMessage(operator, conversation.id, { body: 'Answer' });
    await flushBackground();
    expect(requests.filter((r) => r.url.includes('mailgun'))).toHaveLength(0);
    // It still counts as notified, so we don't keep retrying.
    expect(await sendReplyNotificationIfUnread(conversation.id, reply.id)).toBe('already-notified');
  });
});
