import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Client } from 'pg';
import { getPool } from './db';
import { directDatabaseUrl } from './env';

/**
 * Pub/sub between whoever handles a request (e.g. an operator posting a reply) and whichever
 * function instances hold the relevant WebSockets. Vercel pins each socket to the instance
 * that accepted it, so events go out with Postgres NOTIFY, and every instance with sockets
 * holds one connection that LISTENs and forwards them. Sockets on the publishing instance get
 * events directly, without the round trip.
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

/** The Postgres channel every event goes out on; instances route by `Envelope.channel`. */
const PG_CHANNEL = 'hailbox';
/** Postgres rejects NOTIFY payloads of this many bytes or more. */
const MAX_NOTIFY_BYTES = 8000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface Envelope {
  /** The publishing broker, which has already delivered the event to its own sockets. */
  origin: string;
  channel: Channel;
  payload: unknown;
}

export class PostgresBroker implements Broker {
  private readonly origin = randomUUID();
  private readonly emitter = new EventEmitter().setMaxListeners(0);
  private subscribers = 0;
  /** The LISTEN connection (open, or opening) while anything is subscribed. */
  private connection: Promise<Client> | null = null;

  constructor(private readonly url: string) {}

  async publish(channel: Channel, payload: unknown) {
    this.emitter.emit(channel, payload);
    let message = JSON.stringify({ origin: this.origin, channel, payload } satisfies Envelope);
    // A long chat message can push a frame past NOTIFY's limit. Other instances get a "ready"
    // instead, which makes their clients re-fetch from the database.
    if (Buffer.byteLength(message) >= MAX_NOTIFY_BYTES) {
      message = JSON.stringify({ origin: this.origin, channel, payload: { type: 'ready' } } satisfies Envelope);
    }
    await getPool().query('select pg_notify($1, $2)', [PG_CHANNEL, message]);
  }

  async subscribe(channel: Channel, listener: Listener) {
    this.subscribers++;
    try {
      await this.listen();
    } catch (err) {
      this.release();
      throw err;
    }
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
      this.release();
    };
  }

  private listen(): Promise<Client> {
    if (this.connection) return this.connection;
    const connection = this.connect();
    this.connection = connection;
    connection.then(
      (client) => client.on('end', () => this.dropped(connection)),
      () => {
        // Let the next subscriber try again.
        if (this.connection === connection) this.connection = null;
      },
    );
    return connection;
  }

  private async connect(): Promise<Client> {
    const client = new Client({
      connectionString: this.url,
      connectionTimeoutMillis: 5_000,
      keepAlive: true,
      application_name: 'hailbox-broker',
    });
    client.on('error', (err) => console.error('[hailbox] broker connection error:', err.message));
    client.on('notification', ({ payload }) => this.receive(payload));
    try {
      await client.connect();
      await client.query(`listen ${PG_CHANNEL}`);
    } catch (err) {
      client.end().catch(() => {});
      throw err;
    }
    return client;
  }

  private receive(message: string | undefined) {
    try {
      const { origin, channel, payload } = JSON.parse(message ?? '') as Envelope;
      if (origin !== this.origin) this.emitter.emit(channel, payload);
    } catch (err) {
      console.error('[hailbox] bad broker message', err);
    }
  }

  private dropped(connection: Promise<Client>) {
    // We closed it ourselves.
    if (this.connection !== connection) return;
    this.connection = null;
    console.warn('[hailbox] broker connection lost; reconnecting');
    this.reconnect(0);
  }

  /**
   * Anything published while the connection was down is gone. Once it's back, a synthetic
   * "ready" makes every client on this instance re-fetch, which recovers it.
   */
  private reconnect(delay: number) {
    setTimeout(() => {
      if (this.subscribers === 0) return;
      this.listen().then(
        () => {
          for (const channel of this.emitter.eventNames()) this.emitter.emit(channel, { type: 'ready' });
        },
        (err: Error) => {
          console.error('[hailbox] broker reconnect failed:', err.message);
          this.reconnect(Math.min(Math.max(delay * 2, 1_000), MAX_RECONNECT_DELAY_MS));
        },
      );
    }, delay);
  }

  private release() {
    if (--this.subscribers > 0) return;
    // An instance with no sockets doesn't need the connection.
    const connection = this.connection;
    this.connection = null;
    connection?.then((client) => client.end()).catch(() => {});
  }
}

const globalForBroker = globalThis as typeof globalThis & { __hailboxBroker?: Broker };

export function getBroker(): Broker {
  if (!globalForBroker.__hailboxBroker) {
    const url = directDatabaseUrl();
    if (url.includes('-pooler.')) {
      console.warn(
        '[hailbox] Realtime updates need a direct database connection; LISTEN does not work through a pooler. DATABASE_URL_UNPOOLED looks pooled.',
      );
    }
    globalForBroker.__hailboxBroker = new PostgresBroker(url);
  }
  return globalForBroker.__hailboxBroker;
}
