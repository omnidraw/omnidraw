import { baseCanvasOs } from './procedure-builder';

const apiCanvasEvents = baseCanvasOs.events.handler(async function* ({ context, input }) {
  yield* context.canvas.subscribe(input);
});

export { apiCanvasEvents };
