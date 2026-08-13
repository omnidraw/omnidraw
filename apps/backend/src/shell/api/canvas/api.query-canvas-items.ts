import { baseCanvasOs } from './procedure-builder';

const apiQueryCanvasItems = baseCanvasOs.query.handler(
  ({ context, input }) => context.canvas.queryItems(input),
);

export { apiQueryCanvasItems };
