import { cookies } from 'next/headers';
import { endSession, SESSION_COOKIE } from '@/server/auth';
import { formRoute } from '@/server/http';

export const POST = formRoute(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await endSession(token);
  jar.delete(SESSION_COOKIE);
  return { ok: true };
});
