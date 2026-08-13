import { baseCanvasOs } from './procedure-builder';

const apiExecuteCanvasCommand = baseCanvasOs.execute.handler(
  ({ context, input }) => context.canvas.execute(input),
);

export { apiExecuteCanvasCommand };
