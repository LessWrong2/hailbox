# Hailbox

An embeddable chat widget for talking with your site's visitors, plus a self-hosted inbox for
answering them. Think a small, self-hosted Intercom for Next.js sites on Vercel.

- **Widget** (`hailbox` on npm): a floating button that opens a chat panel. Drop `<Hailbox />`
  into your app's layout.
- **Inbox** (`apps/inbox`): a separate Next.js app on Vercel, where your team signs in and replies.
  It also hosts the API the widget talks to.
- **Returning visitors** see replies that arrived while they were away: an unread badge and a
  preview on the launcher, and the full conversation when they open it.
- **Email notifications** via Mailgun, if the visitor leaves an address and hasn't seen a reply
  within a minute.
- **Slack forwarding**: one thread per conversation, including your team's replies.
- **Realtime** over Vercel's WebSocket support, with Redis fanning events out across instances.

## Layout

```
packages/hailbox   The widget (React), plus hailbox/protocol (wire types) and hailbox/client (headless API client)
apps/inbox         Operator inbox + API + WebSockets (Next.js, Postgres via Drizzle, Redis)
apps/demo          A stand-in "customer site" that embeds the widget
e2e                Playwright tests that drive the demo and the inbox together
```

## Local development

You need Node 20+, pnpm, and a local Postgres server. Redis is optional locally.

```sh
pnpm install
pnpm --filter hailbox build      # the apps consume the widget's build output
pnpm -C apps/inbox db:migrate    # creates the `hailbox` database if needed
pnpm dev                         # widget (watch), inbox on :3000, demo site on :3001
```

Open http://localhost:3001 and send a message from the widget, then reply from the inbox at
http://localhost:3000. Without Mailgun configured, the sign-in page shows the magic link on
screen and outgoing emails are printed to the inbox's console. Without `OPERATOR_EMAILS`, any
email address can sign in. That only applies in development; in production an empty
allowlist locks everyone out.

The inbox's `pnpm dev` runs `dev-server.ts` rather than `next dev`. It provides the request
context that `upgradeWebSocket()` needs, so the WebSocket routes work locally. Vercel's docs
suggest `vercel dev` instead, but that needs a linked project.

### Tests

```sh
pnpm test        # unit + integration tests (the inbox's run against a scratch `hailbox_test` database)
pnpm test:e2e    # Playwright: a visitor and an operator chatting in real browsers (uses your installed Chrome)
```

## Adding the widget to a site

```sh
pnpm add hailbox
```

```tsx
// app/layout.tsx
import { Hailbox } from 'hailbox';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Hailbox
          apiUrl="https://inbox.example.com"
          title="Talk to us"
          subtitle="We usually reply within a few hours."
          greeting="Hi! What can we help with?"
        />
      </body>
    </html>
  );
}
```

`<Hailbox />` is a client component, so you can render it from a server layout. See
[packages/hailbox/README.md](packages/hailbox/README.md) for all props, `openHailbox()`, and
the headless client.

## Deploying the inbox to Vercel

1. **Create a Vercel project** from this repository with **Root Directory** set to
   `apps/inbox`. `apps/inbox/vercel.json` builds the widget package, applies database
   migrations, and builds the app. Migrations run only for production deploys, unless you set
   `HAILBOX_MIGRATE_PREVIEWS=1` because each preview has its own database branch.
2. **Add storage** from the Vercel Marketplace and connect it to the project:
   - **Postgres** (e.g. Neon). This sets `DATABASE_URL`.
   - **Redis** (Redis Cloud, or Upstash with its `rediss://` URL). Set `REDIS_URL`. Without it,
     a reply only reaches visitors whose socket happens to be on the same function instance.
3. **Set environment variables** (all are listed in `apps/inbox/.env.example`):
   - `HAILBOX_SECRET`: a long random string (`openssl rand -base64 32`).
   - `OPERATOR_EMAILS`: comma-separated addresses allowed to sign in.
   - `HAILBOX_ALLOWED_ORIGINS`: your site's origin(s), e.g. `https://example.com`. Reply emails
     only link back to pages on these origins, because visitors report their own page URL.
   - `HAILBOX_SITE_NAME`: shown in emails, e.g. `Acme`.
   - `HAILBOX_INBOX_URL`: the inbox's public URL, if it's not the Vercel production URL.
4. **Mailgun**: set `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and optionally `MAILGUN_FROM` (default
   `<site name> <hailbox@<domain>>`) and `MAILGUN_API_BASE` (`https://api.eu.mailgun.net` for EU
   domains). The same setup sends operator sign-in links and visitor reply notifications.
5. **Slack** (optional). Pick one:
   - Create a Slack app with the `chat:write` bot scope, install it, invite the bot to your
     channel, and set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID`. You get one thread per
     conversation.
   - Or set `SLACK_WEBHOOK_URL` to an incoming webhook. Messages are posted flat, without threads.
6. Deploy, sign in at the inbox's URL, set your display name ("Edit name"), and point your
   site's `<Hailbox apiUrl>` at it.

WebSocket routes set `maxDuration = 300` (the Hobby maximum). On Pro you can raise it to 800 in
`apps/inbox/src/app/api/*/ws/route.ts` so sockets reconnect less often.

## How it works

- **Visitors are anonymous.** The first message creates a visitor and returns a random bearer
  token, which the widget keeps in `localStorage` (keyed by inbox URL) and sends on every
  request. The database stores only the token's SHA-256. There are no third-party cookies, so
  it works across origins and in browsers that block them. If you pass `user={{ email }}`,
  the stored conversation is tied to that user. When someone else signs in on the same
  browser, or you pass `user={null}` on sign-out, the widget starts fresh.
- **Writes go over REST and pushes over WebSockets.** Sending, reading and updating the email
  are plain `fetch` calls. The socket only delivers events. It authenticates with its first
  frame, so the token never appears in a URL. Whenever a socket (re)connects, the client fetches
  everything after the last message id it has. The database stays the source of truth, a
  dropped socket loses nothing, and the routine reconnect at `maxDuration` is harmless. If
  sockets can't connect at all, the open panel falls back to polling.
- **Ordering.** Posting a message locks the conversation row first, so message ids within a
  conversation commit in order and `after=<id>` is a safe cursor.
- **Fan-out.** Vercel pins each socket to the instance that accepted it. Whoever handles a
  write publishes to Redis (`hailbox:visitor:<id>`, `hailbox:inbox`), and every instance
  forwards matching events to its own sockets.
- **Email notifications** are scheduled with `waitUntil` after an operator replies. After
  `NOTIFY_DELAY_SECONDS` (default 60) the inbox checks whether the visitor has read the reply.
  If not, it emails all unread replies in one message. A burst of replies produces one email,
  and a conditional update stops two checks from both sending. The emails carry a signed
  one-click unsubscribe link (RFC 8058). If the conversation started on one of
  `HAILBOX_ALLOWED_ORIGINS`, they also carry a "Continue the conversation" link back to that
  page, with `?hailbox=open` so the widget opens itself.
- **Slack.** The first message of a conversation becomes the thread's parent message, with a
  link to the conversation in the inbox. Later messages from either side are posted as thread
  replies.
- **Operator sign-in** uses one-time magic links (15 minutes) that open a confirmation page
  rather than signing in on GET, because mail scanners prefetch links. Sessions last 30 days and
  are revoked when someone is removed from `OPERATOR_EMAILS`.

## Not built yet

- Replying from Slack or by email (Slack Events API / Mailgun inbound routes).
- Verified identity for logged-in users (an HMAC-signed user id from the host site), which
  would let a conversation follow someone across devices. Today a visitor is per-browser.
- Typing indicators, attachments, multiple concurrent conversations per visitor, and
  multi-site inboxes.
- Abuse controls beyond the built-in limits (20 messages a minute per visitor, 20 new visitors
  an hour per IP). Consider Vercel Firewall rate limits on `/api/v1/*` as well.
