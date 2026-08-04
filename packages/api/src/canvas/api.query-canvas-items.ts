import { baseCanvasOs } from './orpc';

const apiQueryCanvasItems = baseCanvasOs.query.handler(
  ({ context, input }) => context.canvas.queryItems(input),
);

export { apiQueryCanvasItems };
