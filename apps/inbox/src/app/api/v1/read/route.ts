import { z } from 'zod';
import { markVisitorRead } from '@/server/chat';
import { preflight, readJson, visitorRoute } from '@/server/http';

const Body = z.object({ lastMessageId: z.number().int().nonnegative() });

export const OPTIONS = preflight;

export const POST = visitorRoute(async (request, visitor) => {
  const { lastMessageId } = await readJson(request, Body);
  await markVisitorRead(visitor, lastMessageId);
  return { ok: true };
});
