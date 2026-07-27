import { baseCanvasOs } from './orpc';

const apiGetCanvasSnapshot = baseCanvasOs.snapshot.handler(
  ({ context, input }) => context.canvas.getSnapshot(context.tenant, input),
);

export { apiGetCanvasSnapshot };
