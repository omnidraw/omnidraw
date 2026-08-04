import { ORPCError } from '@orpc/contract';
import { baseCanvasOs } from './orpc';

const apiCreateCanvas = baseCanvasOs.create.handler(async ({ context, input }) => {
  const existingCanvas = await context.db.canvas.findByName({ name: input.name });
  if (existingCanvas)
    throw new ORPCError('ALREADY_EXISTS', { message: 'Canvas already exists' });

  return context.db.canvas.create({
    id: crypto.randomUUID(),
    name: input.name,
  });
});

export { apiCreateCanvas };
