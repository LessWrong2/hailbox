import { describe, expect, it, vi } from 'vitest';
import { PostgresBroker, type Channel } from '@/server/broker';
import { getPool } from '@/server/db';
import { directDatabaseUrl } from '@/server/env';

/** Each broker stands in for a separate function instance. */
const instance = () => new PostgresBroker(directDatabaseUrl());

async function collect(broker: PostgresBroker, channel: Channel) {
  const frames: unknown[] = [];
  const off = await broker.subscribe(channel, (frame) => frames.push(frame));
  return { frames, off };
}

describe('PostgresBroker', () => {
  it('delivers across instances, and once to the publishing instance', async () => {
    const a = instance();
    const b = instance();
    const onA = await collect(a, 'inbox');
    const onB = await collect(b, 'inbox');

    await b.publish('inbox', { n: 1 });
    // Notifications arrive in commit order, so once B hears A's, it has heard (and skipped) its own.
    await a.publish('inbox', { n: 2 });
    await vi.waitFor(() => expect(onB.frames).toEqual([{ n: 1 }, { n: 2 }]));
    await vi.waitFor(() => expect(onA.frames).toEqual([{ n: 2 }, { n: 1 }]));
    onA.off();
    onB.off();
  });

  it('routes by channel', async () => {
    const a = instance();
    const b = instance();
    const visitor = await collect(a, 'visitor:one');
    const inbox = await collect(a, 'inbox');

    await b.publish('visitor:two', { skip: true });
    await b.publish('visitor:one', { n: 1 });
    await vi.waitFor(() => expect(visitor.frames).toEqual([{ n: 1 }]));
    expect(inbox.frames).toEqual([]);
    visitor.off();
    inbox.off();
  });

  it('sends a re-fetch prompt when the frame is too big for NOTIFY', async () => {
    const a = instance();
    const b = instance();
    const onA = await collect(a, 'inbox');
    const onB = await collect(b, 'inbox');

    const big = { type: 'message', body: '字'.repeat(3000) };
    await b.publish('inbox', big);
    expect(onB.frames).toEqual([big]);
    await vi.waitFor(() => expect(onA.frames).toEqual([{ type: 'ready' }]));
    onA.off();
    onB.off();
  });

  it('reconnects after losing its connection, then prompts clients to re-fetch', async () => {
    const a = instance();
    const b = instance();
    const onA = await collect(a, 'inbox');

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rowCount } = await getPool().query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where application_name = 'hailbox-broker' and datname = current_database()`,
    );
    expect(rowCount).toBe(1);
    await vi.waitFor(() => expect(onA.frames).toEqual([{ type: 'ready' }]));

    await b.publish('inbox', { n: 1 });
    await vi.waitFor(() => expect(onA.frames).toEqual([{ type: 'ready' }, { n: 1 }]));
    onA.off();
  });

  it('closes its connection when the last subscriber leaves', async () => {
    const a = instance();
    const first = await collect(a, 'inbox');
    const second = await collect(a, 'visitor:one');
    const connections = async () =>
      (
        await getPool().query(
          `select 1 from pg_stat_activity where application_name = 'hailbox-broker' and datname = current_database()`,
        )
      ).rowCount;

    expect(await connections()).toBe(1);
    first.off();
    expect(await connections()).toBe(1);
    second.off();
    await vi.waitFor(async () => expect(await connections()).toBe(0));
  });
});
