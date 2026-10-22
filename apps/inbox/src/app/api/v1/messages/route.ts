import { z } from 'zod';
import { postVisitorMessage } from '@/server/chat';
import { preflight, readJson, visitorRoute } from '@/server/http';

const Body = z.object({
  body: z.string(),
  clientId: z.string().optional(),
  pageUrl: z.string().optional(),
});

// Long enough for background work (Slack forwarding) to finish after the response.
export const maxDuration = 60;

export const OPTIONS = preflight;

export const POST = visitorRoute(async (request, visitor) => {
  return postVisitorMessage(visitor, await readJson(request, Body));
});
