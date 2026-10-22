import type { CreateVisitorResponse } from 'hailbox/protocol';
import { z } from 'zod';
import { createVisitor } from '@/server/chat';
import { preflight, publicVisitorRoute, readJson, requestContext } from '@/server/http';
import { toWireVisitor } from '@/server/serialize';

const Body = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  pageUrl: z.string().optional(),
});

export const OPTIONS = preflight;

export const POST = publicVisitorRoute(async (request) => {
  const input = await readJson(request, Body);
  const { visitor, token } = await createVisitor(input, requestContext(request));
  return { visitor: toWireVisitor(visitor), token } satisfies CreateVisitorResponse;
});
