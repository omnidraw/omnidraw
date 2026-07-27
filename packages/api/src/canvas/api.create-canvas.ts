import { ORPCError } from '@orpc/contract';
import { baseCanvasOs } from './orpc';

const apiCreateCanvas = baseCanvasOs.create.handler(async ({ context, input }) => {
  const existingCanvas = await context.db.canvas.findByName(context.tenant, { name: input.name });
  if (existingCanvas)
    throw new ORPCError('ALREADY_EXISTS', { message: 'Canvas already exists' });

  return context.db.canvas.create(context.tenant, {
    id: crypto.randomUUID(),
    name: input.name,
  });
});

export { apiCreateCanvas };
