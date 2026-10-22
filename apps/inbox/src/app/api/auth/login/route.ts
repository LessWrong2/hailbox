import { z } from 'zod';
import { requestLogin } from '@/server/auth';
import { formRoute, readJson } from '@/server/http';

const Body = z.object({ email: z.string() });

export const POST = formRoute(async (request) => {
  const { email } = await readJson(request, Body);
  const { devLink } = await requestLogin(email);
  return { ok: true, devLink };
});
