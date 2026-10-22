import type { UpdateVisitorResponse } from 'hailbox/protocol';
import { z } from 'zod';
import { getVisitorState, updateVisitor } from '@/server/chat';
import { HttpError, preflight, readJson, visitorRoute } from '@/server/http';
import { toWireVisitor } from '@/server/serialize';

export const OPTIONS = preflight;

export const GET = visitorRoute(async (request, visitor) => {
  const raw = new URL(request.url).searchParams.get('after');
  const after = raw === null ? undefined : Number(raw);
  if (after !== undefined && !(Number.isSafeInteger(after) && after >= 0)) {
    throw new HttpError(400, '`after` must be a message id');
  }
  return getVisitorState(visitor, after);
});

const Patch = z.object({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  notifyByEmail: z.boolean().optional(),
});

export const PATCH = visitorRoute(async (request, visitor) => {
  const updated = await updateVisitor(visitor, await readJson(request, Patch));
  return { visitor: toWireVisitor(updated) } satisfies UpdateVisitorResponse;
});
