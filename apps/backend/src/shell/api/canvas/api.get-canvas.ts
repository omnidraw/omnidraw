import { baseCanvasOs } from './procedure-builder';

const apiGetCanvas = baseCanvasOs.get.handler(async ({ input, context }) => {
  const canvas = await context.db.canvas.findById({ id: input.params.id });
  if (!canvas) throw new Error('Canvas not found');

  return {
    canvas: [canvas],
  };
});

export { apiGetCanvas };
