import { baseCanvasOs } from './orpc';

const apiCanvasEvents = baseCanvasOs.events.handler(async function* ({ context, input }) {
  yield* context.canvas.subscribe(context.tenant, input);
});

export { apiCanvasEvents };
