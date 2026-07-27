import { baseCanvasOs } from './orpc';

const apiExecuteCanvasCommand = baseCanvasOs.execute.handler(
  ({ context, input }) => context.canvas.execute(context.tenant, input),
);

export { apiExecuteCanvasCommand };
