import { z } from 'zod';
import type { ConversationDetailResponse } from '@/lib/inbox-protocol';
import { getConversationDetail, setConversationStatus } from '@/server/chat';
import { HttpError, operatorRoute, parseConversationId, readJson } from '@/server/http';

export const GET = operatorRoute<{ id: string }>(async (_request, _operator, { id }) => {
  const detail = await getConversationDetail(parseConversationId(id));
  if (!detail) throw new HttpError(404, 'Conversation not found');
  return detail satisfies ConversationDetailResponse;
});

const Patch = z.object({ status: z.enum(['open', 'closed']) });

export const PATCH = operatorRoute<{ id: string }>(async (request, _operator, { id }) => {
  const { status } = await readJson(request, Patch);
  return { conversation: await setConversationStatus(parseConversationId(id), status) };
});
