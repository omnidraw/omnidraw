import { ORPCError } from '@orpc/contract';
import { baseCanvasOs } from './orpc';

const apiRemoveCanvas = baseCanvasOs.remove.handler(async ({ context, input }) => {
  const canvas = await context.db.canvas.findById(input.params);
  if (!canvas) {
    throw new ORPCError('NOT_FOUND', { message: 'Canvas not found' });
  }

  const result = await context.db.canvas.deleteById(input.params);
  if (result.length === 0) {
    throw new ORPCError('NOT_FOUND', { message: 'Canvas not found' });
  }
  await context.canvas.release({ canvasId: canvas.id });
  return result[0];
});

export { apiRemoveCanvas };
