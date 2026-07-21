import { baseCanvasOs } from './orpc';

const apiGetCanvas = baseCanvasOs.get.handler(async ({ input, context }) => {
  const canvas = await context.db.canvas.findById(context.tenant, { id: input.params.id });
  if (!canvas) throw new Error('Canvas not found');

  return {
    canvas: [canvas],
  };
});

export { apiGetCanvas };
