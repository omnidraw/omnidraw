import { ORPCError } from '@orpc/server';
import { baseCanvasOs } from './orpc';

const apiUpdateCanvas = baseCanvasOs.update.handler(async ({ input, context }) => {
  if (input.body.name === undefined) {
    const canvas = await context.db.canvas.findById(context.tenant, { id: input.params.id });
    if (!canvas) {
      throw new ORPCError('NOT_FOUND', { message: 'Canvas not found' });
    }

    return canvas;
  }

  const canvas = await context.db.canvas.renameById(context.tenant, {
    id: input.params.id,
    name: input.body.name,
  });

  if (!canvas) {
    throw new ORPCError('NOT_FOUND', { message: 'Canvas not found' });
  }

  return canvas;
});

export { apiUpdateCanvas };
