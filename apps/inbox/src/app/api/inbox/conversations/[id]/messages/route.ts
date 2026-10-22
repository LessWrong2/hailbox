import { z } from 'zod';
import { postOperatorMessage } from '@/server/chat';
import { operatorRoute, parseConversationId, readJson } from '@/server/http';

const Body = z.object({ body: z.string() });

// The visitor's email notification waits (NOTIFY_DELAY_SECONDS, max 240) inside this function.
export const maxDuration = 300;

export const POST = operatorRoute<{ id: string }>(async (request, operator, { id }) => {
  const { body } = await readJson(request, Body);
  return { message: await postOperatorMessage(operator, parseConversationId(id), { body }) };
});
