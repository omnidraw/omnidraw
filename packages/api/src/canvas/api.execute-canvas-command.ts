import { baseCanvasOs } from './orpc';

const apiExecuteCanvasCommand = baseCanvasOs.execute.handler(
  ({ context, input }) => context.canvas.execute(input),
);

export { apiExecuteCanvasCommand };
