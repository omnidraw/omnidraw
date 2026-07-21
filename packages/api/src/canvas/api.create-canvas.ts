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
  try {
    const result = await context.db.canvas.create(canvas, { accountId: context.accountId });
    await context.automerge.notifyDocumentRegistered(handle.url);
    return result;
  } catch (error) {
    context.automerge.failDocumentRegistration(handle.url, error);
    throw error;
  }
});

export { apiCreateCanvas };
