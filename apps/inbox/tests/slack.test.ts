import { describe, expect, it } from 'vitest';
import { flushBackground } from '@/server/background';
import { createVisitor, postOperatorMessage, postVisitorMessage } from '@/server/chat';
import { getDb } from '@/server/db';
import { conversations } from '@/server/db/schema';
import { forwardMessageToSlack } from '@/server/slack';
import { createOperator, recordFetch } from './helpers';

function useBot() {
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_CHANNEL_ID = 'C123';
}

describe('Slack forwarding', () => {
  it('threads a conversation under one parent message', async () => {
    useBot();
    const requests = recordFetch();
    const operator = await createOperator();
    const { visitor } = await createVisitor({ email: 'ada@example.com' });
    const { conversation } = await postVisitorMessage(visitor, {
      body: 'Is <this> & that free?',
      pageUrl: 'https://acme.test/pricing',
    });
    await flushBackground();
    await postVisitorMessage(visitor, { body: 'Second question' });
    await flushBackground();
    await postOperatorMessage(operator, conversation.id, { body: 'Yes!' });
    await flushBackground();

    const slack = requests.filter((r) => r.url === 'https://slack.com/api/chat.postMessage');
    expect(slack).toHaveLength(3);
    expect(slack[0]!.headers.get('authorization')).toBe('Bearer xoxb-test');
    const [parent, followUp, reply] = slack.map((r) => r.body as Record<string, string>);
    expect(parent).toMatchObject({ channel: 'C123' });
    expect(parent!.thread_ts).toBeUndefined();
    expect(parent!.text).toContain('*ada@example.com* started a conversation on <https://acme.test/pricing|acme.test/pricing>');
    expect(parent!.text).toContain('>Is &lt;this&gt; &amp; that free?');
    expect(parent!.text).toContain(`<https://inbox.test/?c=${conversation.id}|Open in inbox>`);
    expect(followUp).toMatchObject({ thread_ts: 'ts-1', text: '*ada@example.com:*\nSecond question' });
    expect(reply).toMatchObject({ thread_ts: 'ts-1' });
    expect(reply!.text).toContain('*Olivia* replied:\nYes!');
  });

  it("keeps a visitor's page URL from injecting a Slack link label", async () => {
    useBot();
    const requests = recordFetch();
    const { visitor } = await createVisitor({});
    await postVisitorMessage(visitor, { body: 'hi', pageUrl: 'https://acme.test/a|Click here for a refund' });
    await flushBackground();
    const text = (requests[0]!.body as Record<string, string>).text!;
    expect(text).toContain('<https://acme.test/a%7CClick%20here%20for%20a%20refund|acme.test/a¦Click%20here%20for%20a%20refund>');
  });

  it('creates only one parent when messages are forwarded concurrently', async () => {
    useBot();
    const requests = recordFetch(async (_request, index) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return Response.json({ ok: true, ts: `ts-${index + 1}` });
    });
    const { visitor } = await createVisitor({});
    const a = await postVisitorMessage(visitor, { body: 'a' });
    const b = await postVisitorMessage(visitor, { body: 'b' });
    await flushBackground();
    // postVisitorMessage already forwarded both in the background; forward again concurrently.
    await Promise.all([forwardMessageToSlack(a.message.id), forwardMessageToSlack(b.message.id)]);

    const parents = requests.filter((r) => !(r.body as Record<string, unknown>).thread_ts);
    expect(parents).toHaveLength(1);
    const [row] = await getDb().select().from(conversations);
    expect(row!.slackThreadTs).toBe('ts-1');
  });

  it('frees the thread slot if posting the parent fails', async () => {
    useBot();
    recordFetch(() => Response.json({ ok: false, error: 'channel_not_found' }));
    const { visitor } = await createVisitor({});
    await postVisitorMessage(visitor, { body: 'hello' });
    await flushBackground();
    const [row] = await getDb().select().from(conversations);
    expect(row!.slackThreadTs).toBeNull();
  });

  it('posts flat messages to an incoming webhook', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/abc';
    const requests = recordFetch(() => new Response('ok'));
    const { visitor } = await createVisitor({ name: 'Ada' });
    const { conversation } = await postVisitorMessage(visitor, { body: 'hello' });
    await flushBackground();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://hooks.slack.test/abc');
    expect(requests[0]!.body).toEqual({
      text: `*Ada:*\nhello\n<https://inbox.test/?c=${conversation.id}|Open in inbox>`,
    });
  });

  it('does nothing when Slack is not configured', async () => {
    const requests = recordFetch();
    const { visitor } = await createVisitor({});
    await postVisitorMessage(visitor, { body: 'hello' });
    await flushBackground();
    expect(requests).toHaveLength(0);
  });
});
