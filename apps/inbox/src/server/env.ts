// All configuration is read lazily so tests (and Next's build step) can import modules freely.

export const isProduction = () => process.env.NODE_ENV === 'production';

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function databaseUrl(): string {
  return process.env.DATABASE_URL || 'postgres://localhost/hailbox';
}

/**
 * For the realtime broker's LISTEN connection, which doesn't work through a transaction-mode
 * pooler. Neon's Vercel integration sets DATABASE_URL_UNPOOLED alongside the pooled DATABASE_URL.
 */
export function directDatabaseUrl(): string {
  return process.env.DATABASE_URL_UNPOOLED || databaseUrl();
}

export function inboxUrl(): string {
  const configured = process.env.HAILBOX_INBOX_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  const deployment = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function siteName(): string {
  return process.env.HAILBOX_SITE_NAME || 'Hailbox';
}

const DEV_SECRET = 'hailbox-development-secret-do-not-use-in-production';

export function secret(): string {
  const value = process.env.HAILBOX_SECRET;
  if (value) return value;
  if (isProduction()) throw new Error('HAILBOX_SECRET must be set in production');
  return DEV_SECRET;
}

/** Origins allowed to call the visitor API. "*" (the default) allows any. */
export function allowedOrigins(): string[] {
  const origins = list(process.env.HAILBOX_ALLOWED_ORIGINS);
  return origins.length ? origins.map((o) => o.replace(/\/+$/, '')) : ['*'];
}

/**
 * Emails allowed to sign in. When unset in development anyone may sign in, which keeps local
 * setup to zero steps; in production an empty list locks everyone out.
 */
export function operatorEmails(): string[] | 'anyone' {
  const emails = list(process.env.OPERATOR_EMAILS).map((e) => e.toLowerCase());
  if (emails.length === 0 && !isProduction()) return 'anyone';
  return emails;
}

export function notifyDelayMs(): number {
  const raw = Number(process.env.NOTIFY_DELAY_SECONDS);
  const seconds = Number.isFinite(raw) && process.env.NOTIFY_DELAY_SECONDS ? raw : 60;
  // The wait happens inside the request's function, so it must finish well within maxDuration.
  return Math.min(Math.max(seconds, 0), 240) * 1000;
}

export interface MailgunConfig {
  apiKey: string;
  domain: string;
  from: string;
  apiBase: string;
}

export function mailgunConfig(): MailgunConfig | null {
  const { MAILGUN_API_KEY: apiKey, MAILGUN_DOMAIN: domain } = process.env;
  if (!apiKey || !domain) return null;
  return {
    apiKey,
    domain,
    from: process.env.MAILGUN_FROM || `${siteName()} <hailbox@${domain}>`,
    apiBase: (process.env.MAILGUN_API_BASE || 'https://api.mailgun.net').replace(/\/+$/, ''),
  };
}

export type SlackConfig =
  | { kind: 'bot'; token: string; channel: string }
  | { kind: 'webhook'; url: string };

export function slackConfig(): SlackConfig | null {
  const { SLACK_BOT_TOKEN: token, SLACK_CHANNEL_ID: channel, SLACK_WEBHOOK_URL: url } = process.env;
  if (token && channel) return { kind: 'bot', token, channel };
  if (url) return { kind: 'webhook', url };
  return null;
}
