import { cookies } from 'next/headers';
import { z } from 'zod';
import { completeLogin, SESSION_COOKIE, sessionCookieOptions } from '@/server/auth';
import { formRoute, readJson } from '@/server/http';

const Body = z.object({ token: z.string().min(1) });

export const POST = formRoute(async (request) => {
  const { token } = await readJson(request, Body);
  const { sessionToken } = await completeLogin(token);
  (await cookies()).set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  return { ok: true };
});
