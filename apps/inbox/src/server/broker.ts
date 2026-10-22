import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { isProduction, redisUrl } from './env';

/**
 * Pub/sub between whoever handles a request (e.g. an operator posting a reply) and whichever
 * function instances hold the relevant WebSockets. Vercel pins each socket to the instance
 * that accepted it, so cross-instance delivery needs Redis; without REDIS_URL we fall back
 * to an in-process emitter, which is only correct when there's a single process (local dev).
 *
 * Delivery is best-effort: clients re-fetch from the database whenever they (re)connect, so
 * the database stays the source of truth.
 */
export type Channel = 'inbox' | `visitor:${string}`;
type Listener = (payload: unknown) => void;

export interface Broker {
  publish(channel: Channel, payload: unknown): Promise<void>;
  /** Resolves once the subscription is live, with a function that ends it. */
  subscribe(channel: Channel, listener: Listener): Promise<() => void>;
}

class LocalBroker implements Broker {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  async publish(channel: Channel, payload: unknown) {
    this.emit(channel, payload);
  }

  emit(channel: string, payload: unknown) {
    this.emitter.emit(channel, payload);
  }

  async subscribe(channel: Channel, listener: Listener) {
    this.emitter.on(channel, listener);
    return () => void this.emitter.off(channel, listener);
  }
}

const PREFIX = 'hailbox:';

class RedisBroker implements Broker {
  private readonly local = new LocalBroker();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly refCounts = new Map<string, number>();
  private readonly pendingSubscribes = new Map<string, Promise<unknown>>();

  constructor(url: string) {
    this.publisher = new Redis(url, { maxRetriesPerRequest: 3 });
    this.subscriber = new Redis(url);
    for (const client of [this.publisher, this.subscriber]) {
      client.on('error', (err) => console.error('[hailbox] redis error:', err.message));
    }
    // ioredis resubscribes after a reconnect, but anything published during the gap is gone.
    // A synthetic "ready" makes every connected client re-fetch, which recovers it.
    let connectedBefore = false;
    this.subscriber.on('ready', () => {
      if (connectedBefore) {
        for (const key of this.refCounts.keys()) this.local.emit(key.slice(PREFIX.length), { type: 'ready' });
      }
      connectedBefore = true;
    });
    this.subscriber.on('message', (channel: string, message: string) => {
      if (!channel.startsWith(PREFIX)) return;
      try {
        this.local.emit(channel.slice(PREFIX.length), JSON.parse(message));
      } catch (err) {
        console.error('[hailbox] bad broker message', err);
      }
    });
  }

  async publish(channel: Channel, payload: unknown) {
    await this.publisher.publish(PREFIX + channel, JSON.stringify(payload));
  }

  async subscribe(channel: Channel, listener: Listener) {
    const key = PREFIX + channel;
    const count = this.refCounts.get(key) ?? 0;
    this.refCounts.set(key, count + 1);
    if (count === 0) this.pendingSubscribes.set(key, this.subscriber.subscribe(key));
    try {
      await this.pendingSubscribes.get(key);
    } catch (err) {
      this.release(key);
      throw err;
    }
    const off = await this.local.subscribe(channel, listener);
    return () => {
      off();
      this.release(key);
    };
  }

  private release(key: string) {
    const remaining = (this.refCounts.get(key) ?? 1) - 1;
    if (remaining > 0) {
      this.refCounts.set(key, remaining);
      return;
    }
    this.refCounts.delete(key);
    this.pendingSubscribes.delete(key);
    this.subscriber.unsubscribe(key).catch(() => {});
  }
}

const globalForBroker = globalThis as typeof globalThis & { __hailboxBroker?: Broker };

export function getBroker(): Broker {
  if (!globalForBroker.__hailboxBroker) {
    const url = redisUrl();
    if (!url && isProduction() && process.env.VERCEL) {
      console.warn(
        '[hailbox] REDIS_URL is not set: realtime updates will only reach sockets on the same instance.',
      );
    }
    globalForBroker.__hailboxBroker = url ? new RedisBroker(url) : new LocalBroker();
  }
  return globalForBroker.__hailboxBroker;
}
