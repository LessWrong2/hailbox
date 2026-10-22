import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { secret } from './env';

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sign(purpose: string, value: string): string {
  return createHmac('sha256', secret()).update(`${purpose}:${value}`).digest('base64url');
}

export function signUnsubscribe(visitorId: string): string {
  return sign('unsubscribe', visitorId);
}

export function verifyUnsubscribe(visitorId: string, signature: string): boolean {
  const expected = Buffer.from(signUnsubscribe(visitorId));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
