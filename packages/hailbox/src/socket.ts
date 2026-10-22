/** Close code the server uses when the visitor token is rejected; reconnecting won't help. */
export const CLOSE_UNAUTHORIZED = 4001;

export interface ReconnectingSocketOptions<ServerFrame> {
  url: string;
  /** Called on every (re)connect, before any frames arrive. Use it to send auth. */
  onOpen: (send: (frame: unknown) => void) => void;
  onFrame: (frame: ServerFrame) => void;
  /** Called whenever the connection drops, including before each reconnect attempt. */
  onDisconnect?: () => void;
  /** Called when the server rejects us permanently; no further reconnects happen. */
  onUnauthorized?: () => void;
  pingIntervalMs?: number;
}

/**
 * A WebSocket that keeps itself connected. Vercel closes sockets when the function hits
 * its max duration, so reconnecting is the normal case rather than an error path.
 */
export class ReconnectingSocket<ServerFrame> {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private lastFrameAt = 0;

  constructor(private readonly options: ReconnectingSocketOptions<ServerFrame>) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.teardown();
  }

  private connect(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    const send = (frame: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    };

    ws.onopen = () => {
      this.lastFrameAt = Date.now();
      this.options.onOpen(send);
      const interval = this.options.pingIntervalMs ?? 25_000;
      this.pingTimer = setInterval(() => {
        // No frame (not even a pong) for two intervals: assume the connection is dead.
        if (Date.now() - this.lastFrameAt > interval * 2 + 5_000) {
          ws.close();
          return;
        }
        send({ type: 'ping' });
      }, interval);
    };

    ws.onmessage = (event) => {
      this.lastFrameAt = Date.now();
      this.attempts = 0;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(event.data)) as ServerFrame;
      } catch {
        return;
      }
      this.options.onFrame(frame);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.teardown();
      if (this.stopped) return;
      this.options.onDisconnect?.();
      if (event.code === CLOSE_UNAUTHORIZED) {
        this.stopped = true;
        this.options.onUnauthorized?.();
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    // Exponential backoff with jitter, capped at 30s. The first retry is quick because
    // max-duration closes are routine.
    const base = Math.min(30_000, 500 * 2 ** this.attempts);
    this.attempts++;
    this.retryTimer = setTimeout(() => this.connect(), base / 2 + Math.random() * (base / 2));
  }

  private teardown(): void {
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
  }
}
