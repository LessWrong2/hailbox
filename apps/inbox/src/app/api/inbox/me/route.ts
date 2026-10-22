import { z } from 'zod';
import { updateOperatorName } from '@/server/auth';
import { operatorRoute, readJson } from '@/server/http';
import { toOperatorInfo } from '@/server/serialize';

export const GET = operatorRoute(async (_request, operator) => ({ operator: toOperatorInfo(operator) }));

const Patch = z.object({ name: z.string().nullable() });

export const PATCH = operatorRoute(async (request, operator) => {
  const { name } = await readJson(request, Patch);
  return { operator: toOperatorInfo(await updateOperatorName(operator, name)) };
});
