import { ORPCError } from '@orpc/contract';
import { baseCanvasOs } from './orpc';

const apiCreateCanvas = baseCanvasOs.create.handler(async ({ context, input }) => {
  const existingCanvas = await context.db.canvas.findByName({ name: input.name }, { accountId: context.accountId });
  if (existingCanvas)
    throw new ORPCError('ALREADY_EXISTS', { message: 'Canvas already exists' });

  const id = crypto.randomUUID();

  const handle = context.automerge.repo.create({
    id,
    elements: {},
    groups: {},
  })

  const canvas = { id: crypto.randomUUID(), name: input.name, created_at: new Date(), automerge_url: handle.url };
  const result = await context.db.canvas.create(canvas, { accountId: context.accountId });
  return result;
});

export { apiCreateCanvas };
