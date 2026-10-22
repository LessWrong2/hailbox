import { z } from 'zod';
import { markOperatorRead } from '@/server/chat';
import { operatorRoute, parseConversationId, readJson } from '@/server/http';

const Body = z.object({ lastMessageId: z.number().int().nonnegative() });

export const POST = operatorRoute<{ id: string }>(async (request, _operator, { id }) => {
  const { lastMessageId } = await readJson(request, Body);
  await markOperatorRead(parseConversationId(id), lastMessageId);
  return { ok: true };
});
