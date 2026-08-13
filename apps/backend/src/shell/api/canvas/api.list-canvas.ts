import { baseCanvasOs } from './procedure-builder';

const apiListCanvas = baseCanvasOs.list.handler(async ({ context }) => {
  return await context.db.canvas.listAll();
});

export { apiListCanvas };
