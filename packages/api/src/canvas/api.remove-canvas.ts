import { ORPCError } from '@orpc/contract';
import { baseCanvasOs } from './orpc';

const apiRemoveCanvas = baseCanvasOs.remove.handler(async ({ context, input }) => {
  const canvas = await context.db.canvas.findById(context.tenant, input.params);
  if (!canvas) {
    throw new ORPCError('NOT_FOUND', { message: 'Canvas not found' });
  }

  await context.automerge.deleteDocument(context.tenant, canvas.automerge_url)
  const result = await context.db.canvas.deleteById(context.tenant, input.params);
  if (result.length === 0) {
    throw new ORPCError('NOT_FOUND', { message: 'Canvas not found' });
  }
  return result[0];
});

export { apiRemoveCanvas };
