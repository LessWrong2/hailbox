import type { ConversationListResponse } from '@/lib/inbox-protocol';
import { listConversations } from '@/server/chat';
import { HttpError, operatorRoute } from '@/server/http';

export const GET = operatorRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  const status = params.get('status') ?? 'open';
  if (status !== 'open' && status !== 'closed') throw new HttpError(400, 'Unknown status');
  const beforeParam = params.get('before');
  const before = beforeParam ? new Date(beforeParam) : undefined;
  if (before && Number.isNaN(before.getTime())) throw new HttpError(400, '`before` must be a date');
  return { conversations: await listConversations({ status, before }) } satisfies ConversationListResponse;
});
