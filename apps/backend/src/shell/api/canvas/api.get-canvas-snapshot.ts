import { baseCanvasOs } from './procedure-builder';

const apiGetCanvasSnapshot = baseCanvasOs.snapshot.handler(
  ({ context, input }) => context.canvas.getSnapshot(input),
);

export { apiGetCanvasSnapshot };
