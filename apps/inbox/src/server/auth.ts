import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { normalizeEmail } from './chat';
import { getDb } from './db';
import { loginTokens, operators, sessions, type Operator } from './db/schema';
import { emailButton, emailLayout, escapeHtml, sendEmail } from './email';
import { inboxUrl, isProduction, operatorEmails, siteName } from './env';
import { HttpError } from './errors';
import { hashToken, newToken } from './tokens';

export const SESSION_COOKIE = 'hailbox_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
const LOGIN_REQUESTS_PER_WINDOW = 5;

export function isOperatorEmail(email: string): boolean {
  const allowed = operatorEmails();
  return allowed === 'anyone' || allowed.includes(email.toLowerCase());
}

/**
 * Emails a sign-in link if the address is allowed. Callers must not reveal whether it was,
 * so the result only carries the link itself in development without Mailgun.
 */
export async function requestLogin(rawEmail: string): Promise<{ devLink?: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new HttpError(400, 'Enter your email address');
  if (!isOperatorEmail(email)) return {};

  const db = getDb();
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginTokens)
    .where(and(eq(loginTokens.email, email), gt(loginTokens.expiresAt, new Date())));
  if ((recent?.count ?? 0) >= LOGIN_REQUESTS_PER_WINDOW) return {};

  const token = newToken();
  await db.insert(loginTokens).values({
    tokenHash: hashToken(token),
    email,
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
  });

  const link = `${inboxUrl()}/login/verify?token=${token}`;
  const site = siteName();
  const delivered = await sendEmail({
    to: email,
    subject: `Sign in to the ${site} inbox`,
    text: `Use this link to sign in to the ${site} inbox. It expires in 15 minutes.\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: emailLayout(
      `<p style="margin:0 0 20px;">Use this button to sign in to the ${escapeHtml(site)} inbox. It expires in 15 minutes.</p>
<p style="margin:0 0 20px;">${emailButton(link, 'Sign in')}</p>
<p style="margin:0;font-size:13px;color:#6b7280;">If you didn't ask for this, you can ignore this email.</p>`,
    ),
  });
  return !delivered && !isProduction() ? { devLink: link } : {};
}

/** Exchanges a sign-in link token for a new session token. Each link works once. */
export async function completeLogin(token: string): Promise<{ sessionToken: string; operator: Operator }> {
  const db = getDb();
  const [login] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(loginTokens.tokenHash, hashToken(token)),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!login) throw new HttpError(400, 'This sign-in link is invalid or has expired.');
  if (!isOperatorEmail(login.email)) throw new HttpError(403, 'This address is no longer allowed to sign in.');

  const now = new Date();
  const [operator] = await db
    .insert(operators)
    .values({ email: login.email, lastLoginAt: now })
    .onConflictDoUpdate({ target: operators.email, set: { lastLoginAt: now } })
    .returning();

  const sessionToken = newToken();
  await db.insert(sessions).values({
    tokenHash: hashToken(sessionToken),
    operatorId: operator!.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { sessionToken, operator: operator! };
}

export async function operatorFromSessionToken(token: string): Promise<Operator | null> {
  const [row] = await getDb()
    .select({ operator: operators })
    .from(sessions)
    .innerJoin(operators, eq(operators.id, sessions.operatorId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  // Re-checking the allowlist means removing someone from OPERATOR_EMAILS revokes their sessions.
  if (!row || !isOperatorEmail(row.operator.email)) return null;
  return row.operator;
}

export async function endSession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export async function updateOperatorName(operator: Operator, name: string | null): Promise<Operator> {
  const [updated] = await getDb()
    .update(operators)
    .set({ name: name?.trim().slice(0, 100) || null })
    .where(eq(operators.id, operator.id))
    .returning();
  return updated!;
}
